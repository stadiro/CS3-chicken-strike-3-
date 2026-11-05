import './style.css';
import { BOMB } from '../../shared/config';
import { BUY, isEconomyMode } from '../../shared/economy';
import { FY_SAND_MAP, getMapById, type ArenaMap } from '../../shared/map';
import { clamp, distance, type Vec3 } from '../../shared/math';
import {
  type JoinRequest,
  type LobbyState,
  type MatchPhase,
  type PlayerSnapshot,
  type RoundEndEvent,
  type Snapshot,
} from '../../shared/protocol';
import { computeRecoilKick } from '../../shared/recoil';
import { hasLineOfSight } from '../../shared/visibility';
import { getWeapon, isScopedWeapon, type WeaponId } from '../../shared/weapons';
import { SoundSystem } from './audio/sound';
import { ArmorPickupView } from './game/armorPickupView';
import { BombView } from './game/bombView';
import { EffectSystem } from './game/effects';
import { GrenadeView } from './game/grenadeView';
import { PickupView } from './game/pickupView';
import { PlayerView } from './game/playerView';
import { createArenaScene } from './game/scene';
import {
  aliveTeammates,
  BOMB_CAM_DEFAULT_ELEVATION,
  BOMB_CAM_MAX_ELEVATION,
  BOMB_CAM_MIN_ELEVATION,
  chooseSpectatorView,
  computeBombCamera,
  cycleSpectatorTarget,
  SPECTATE_FADE_IN_MS,
  SPECTATE_FADE_OUT_MS,
  spectatorFadeAlpha,
  spectatorSubjectKey,
  type SpectatorView,
} from './game/spectator';
import { configureViewmodelRenderer, Viewmodel } from './game/viewmodel';
import { installBrowserShortcutGuard } from './input/browserShortcutGuard';
import { InputController } from './input/inputController';
import { connectToGameServer } from './net/socket';
import { loadSettings, type GameSettings } from './settings';
import {
  clearSession,
  loadPlayerName,
  loadSession,
  savePlayerName,
  saveSession,
  type StoredSession,
} from './net/session';
import { SnapshotBuffer, type SampledFrame } from './net/snapshotBuffer';
import { createHud } from './ui/hud';

const app = document.getElementById('app');
if (app === null) {
  throw new Error('Missing #app container');
}

const storedMapId = window.sessionStorage.getItem('wow-map');
let currentMap: ArenaMap = getMapById(storedMapId ?? '') ?? FY_SAND_MAP;
const arena = createArenaScene(app, currentMap);
configureViewmodelRenderer(arena.renderer);
const viewmodel = new Viewmodel(window.innerWidth / window.innerHeight);
const effects = new EffectSystem(arena.scene);
const sound = new SoundSystem();
const buffer = new SnapshotBuffer();

const SCOPE_FOV = 30;
const AWP_SCOPE_RECOVER_MS = 1_200;
const INPUT_SEND_INTERVAL = 1 / 120;
const RECOIL_RESET_MS = 350;

let settings = loadSettings();

const remotePlayers = new Map<string, PlayerView>();
const footstepTrackers = new Map<string, { x: number; z: number; distance: number }>();
const pickupViews = new Map<string, PickupView>();
const armorPickupViews = new Map<string, ArmorPickupView>();
const grenadeViews = new Map<string, GrenadeView>();
const bombView = new BombView();
arena.scene.add(bombView.root);
let nextBombBeepAt = 0;

let currentName = loadPlayerName();
let currentSession: StoredSession | null = loadSession();
let localPlayerId: string | null = null;
let joined = false;
let joinInFlight = false;
let currentPhase: MatchPhase = 'lobby';
let wasAlive = false;
let lastLocalWeapon: WeaponId | null = null;
let wasReloading = false;
let wasReloadingUntil: number | null = null;
let scoreboardVisible = false;
let resultsVisible = false;
let buyMenuOpen = false;
let lastBuyInZone = false;
let cameraShake = 0;
let recoilSprayWeapon: WeaponId | null = null;
let recoilSprayShot = 0;
let lastRecoilAt = 0;
let scoped = false;
let scopeRequested = false;
let scopeRecoverUntil = 0;
let latestLocalPlayer: PlayerSnapshot | null = null;
let latestSnapshot: Snapshot | null = null;
let latestLobby: LobbyState | null = null;
let disposed = false;

// Spectator state (economy rounds only). `logical` is what the spectator logic
// wants to show, `displayed` is what the camera renders; they differ while the
// screen fades to black between subjects.
let spectatorLogical: SpectatorView | null = null;
let spectatorLogicalSince = 0;
let spectatorDisplayed: SpectatorView | null = null;
let spectatorFadeStartedAt: number | null = null;
let spectatorFadeSwapped = false;
let spectatorHudKey = '';
let spectatorScoped = false;
let spectatedLastPosition: Vec3 | null = null;
let hiddenPlayerId: string | null = null;
let localKillerName: string | null = null;
let bombOrbitYaw = 0;
let bombOrbitElevation = BOMB_CAM_DEFAULT_ELEVATION;
let lastBombPosition: Vec3 | null = null;

sound.setVolumes(settings.masterVolume, settings.effectsVolume);
arena.camera.fov = settings.fov;
arena.camera.updateProjectionMatrix();

const hud = createHud({
  onJoin: (name, roomId) => {
    currentName = name;
    savePlayerName(name);
    const sessionToUse =
      currentSession !== null && currentSession.name === name ? currentSession : null;
    void attemptJoin(name, sessionToUse, false, roomId);
  },
  onCreateRoom: (roomName, mapId, roomMode, playerName) => {
    const chosenName = playerName?.trim() || currentName || loadPlayerName() || 'Игрок';
    currentName = chosenName;
    savePlayerName(chosenName);
    connection
      .createRoom({ name: roomName, mapId, roomMode })
      .then((result) => {
        if (result.ok && result.roomId !== undefined) {
          hud.showCreateRoom(false);
          void attemptJoin(chosenName, null, false, result.roomId);
        } else {
          hud.showToast(result.error ?? 'Ошибка создания комнаты', 'error');
        }
      })
      .catch((err) => {
        hud.showToast(err instanceof Error ? err.message : 'Ошибка создания комнаты', 'error');
      });
  },
  onChooseTeam: (team) => {
    connection.chooseTeam(team);
  },
  onSetReady: (ready) => {
    connection.setReady(ready);
  },
  onRefreshRooms: () => {
    connection
      .listRooms()
      .then((rooms) => hud.setRooms(rooms))
      .catch(() => {});
  },
  onRematch: () => {
    connection.socket.emit('rematch');
  },
  onResume: () => {
    sound.resume();
    input.requestPointerLock();
  },
  onLeave: () => {
    leaveGame();
  },
  onSettingsChange: (next) => applySettings(next),
  onBuy: (itemId) => {
    if (connection.socket.connected) {
      connection.socket.emit('buy', { itemId });
    }
  },
  onRefund: (itemId) => {
    if (connection.socket.connected) {
      connection.socket.emit('refund', { itemId });
    }
  },
  onCloseBuy: () => closeBuyMenu(),
});

const input = new InputController(arena.renderer.domElement, {
  onPointerLockChange: () => {
    sound.resume();
    updateInputState();
  },
  onActivity: () => sound.resume(),
  onAction: () => sendInputFrame(),
  onSecondary: (down) => handleSecondary(down),
  onPrimary: () => {
    if (spectatorLogical !== null) {
      cycleSpectator(1);
    }
  },
  onInspect: () => {
    if (joined && spectatorLogical === null && latestLocalPlayer?.alive) {
      viewmodel.triggerInspect();
    }
  },
});

const disposeShortcutGuard = installBrowserShortcutGuard(
  () => joined && (input.isPointerLocked() || buyMenuOpen),
);

input.setToggleWalk(settings.toggleWalk);
input.setToggleScope(settings.toggleScope);
input.setSensitivityMultiplier(settings.sensitivity);

const connection = connectToGameServer({
  onStateChange: (state) => {
    hud.setConnection(state.connected, state.pingMs);
    hud.setNetwork(state.pingMs, state.jitterMs, state.lossPercent);
    if (state.connected) {
      hud.setReconnecting(false);
      connection
        .listRooms()
        .then((rooms) => hud.setRooms(rooms))
        .catch(() => {});
      if (!joined && !joinInFlight && currentSession !== null) {
        const sessionToResume = currentSession;
        window.setTimeout(() => {
          if (connection.socket.connected && !joined && !joinInFlight) {
            void attemptJoin(sessionToResume.name, sessionToResume, true);
          }
        }, 180);
      }
    } else {
      const wasJoined = joined;
      joined = false;
      joinInFlight = false;
      input.setEnabled(false);
      input.releasePointerLock();
      viewmodel.setVisible(false);
      latestLocalPlayer = null;
      latestSnapshot = null;
      wasAlive = false;
      wasReloading = false;
      wasReloadingUntil = null;
      lastLocalWeapon = null;
      scopeRequested = false;
      scopeRecoverUntil = 0;
      setScoped(false);
      buffer.clear();
      clearWorld();
      buyMenuOpen = false;
      hud.showBuy(false);
      hud.setBuyZoneNotice(false);
      hud.showPause(false);
      hud.showScoreboard(false);
      hud.hideRoundWin();
      scoreboardVisible = false;
      if (wasJoined) {
        hud.setReconnecting(true, 'ПЕРЕПОДКЛЮЧЕНИЕ...');
        hud.showToast('Соединение потеряно. Пытаемся восстановить сессию.', 'error');
      }
    }
  },
  onHello: (hello) => {
    hud.setProtocolInfo(`PROTOCOL V${hello.protocolVersion} · ${hello.tickRate} HZ`);
  },
  onError: (message) => {
    hud.showError(message);
  },
});

hud.setConnection(false, null);
hud.setLocalPlayer(null);
hud.setMapInfo(currentMap);
hud.showStart(currentName);

connection.socket.on('rooms_update', (rooms) => {
  hud.setRooms(rooms);
});

connection.socket.on('lobby', (state) => {
  latestLobby = state;
  currentPhase = state.phase;
  hud.updateLobby(state, localPlayerId);
  if (
    state.phase === 'countdown' ||
    state.phase === 'live' ||
    state.phase === 'round_over' ||
    state.phase === 'lobby'
  ) {
    hud.hideResults();
    resultsVisible = false;
  }
  if (state.phase === 'lobby' || state.phase === 'paused' || state.phase === 'ended') {
    hud.hideRoundWin();
    input.releasePointerLock();
  }
  updateInputState();
});

connection.socket.on('countdown', (state) => {
  currentPhase = 'countdown';
  hud.hideResults();
  resultsVisible = false;
  hud.showCountdown(state);
  sound.countdown(state.seconds);
  updateInputState();
});

connection.socket.on('snapshot', (snapshot) => {
  if (!joined) {
    return;
  }
  buffer.push(snapshot, performance.now());
  latestSnapshot = snapshot;
  const previousPhase = currentPhase;
  currentPhase = snapshot.match.phase;
  hud.updateSnapshot(snapshot, localPlayerId);
  if (previousPhase !== 'live' && currentPhase === 'live') {
    hud.showLive();
  }
  handleLocalSnapshot(snapshot);
  syncBuyMenu(snapshot);
  updateBuyZoneNotice(snapshot);
  if (
    snapshot.match.phase === 'live' ||
    snapshot.match.phase === 'countdown' ||
    snapshot.match.phase === 'round_over'
  ) {
    hud.hideResults();
    resultsVisible = false;
  }
  if (snapshot.match.phase === 'ended' && !resultsVisible) {
    const winner = snapshot.players.find((player) => player.id === snapshot.match.winnerId);
    presentResults({
      winnerId: snapshot.match.winnerId,
      winnerName: winner?.name ?? null,
      scores: snapshot.match.scores,
      reason: snapshot.match.endReason ?? 'time',
    });
  }
  updateInputState();
});

connection.socket.on('hit', (event) => {
  if (!joined) {
    return;
  }
  if (event.shooterId === localPlayerId && event.source !== 'fall') {
    sound.hit(event.headshot);
  }
  if (event.victimId === localPlayerId) {
    hud.showDamage(
      event.source === 'fall' ? null : relativeAngle(event.sourcePosition),
      event.damage,
    );
    sound.damage();
    cameraShake = Math.min(0.07, cameraShake + 0.012 + event.damage * 0.00025);
  }
  effects.spawnImpact(
    event.hitPoint,
    event.headshot ? 0xffd166 : event.victimId === localPlayerId ? 0xff5d73 : 0xff8b5c,
    event.headshot ? 10 : 6,
  );
});

connection.socket.on('explosion', (event) => {
  if (!joined) {
    return;
  }
  const local = latestLocalPlayer;
  const dist =
    local === null
      ? 0
      : distance(
          { x: local.position.x, y: local.position.y, z: local.position.z } satisfies Vec3,
          event.position,
        );
  if (event.type === 'smokegrenade') {
    effects.spawnSmoke(event.position, event.durationMs, event.radius);
  } else if (event.type === 'molotov' || event.type === 'incendiary') {
    effects.spawnExplosion(event.position, 0xff7a3d);
    effects.spawnFire(event.position, event.durationMs, event.radius);
    sound.explosion(dist);
  } else if (event.type === 'flashbang') {
    effects.spawnFlash(event.position);
    sound.explosion(dist * 1.8);
  } else {
    effects.spawnExplosion(event.position);
    sound.explosion(dist);
  }
  if (dist < event.radius * 1.4 && event.type !== 'smokegrenade') {
    cameraShake = Math.min(0.12, cameraShake + 0.04);
  }
});

connection.socket.on('buy_result', (event) => {
  if (!joined) {
    return;
  }
  hud.showBuyResult(event, localPlayerId);
  if (event.playerId === localPlayerId && event.ok) {
    sound.pickup();
  }
});

connection.socket.on('grenade_thrown', (event) => {
  if (!joined) {
    return;
  }
  effects.spawnMuzzle(event.position, 0x9bd36b);
});

connection.socket.on('shot', (event) => {
  if (!joined) {
    return;
  }
  const localShot = event.shooterId === localPlayerId;
  // While spectating a teammate in first person their shots play as "own".
  const spectatedShot =
    !localShot &&
    spectatorDisplayed?.kind === 'player' &&
    spectatorDisplayed.playerId === event.shooterId;
  const shotDistance =
    localShot || spectatedShot
      ? 0
      : distance(
          {
            x: arena.camera.position.x,
            y: arena.camera.position.y,
            z: arena.camera.position.z,
          } satisfies Vec3,
          event.from,
        );
  sound.shot(event.weapon, shotDistance);
  if (spectatedShot) {
    if (event.weapon === 'knife') {
      viewmodel.triggerKnifeSlash();
    } else {
      viewmodel.triggerFire();
      cameraShake = Math.min(0.07, cameraShake + getWeapon(event.weapon).recoil * 0.25);
    }
  } else if (!localShot) {
    if (event.weapon !== 'knife') {
      effects.spawnMuzzle(event.from, 0xffcf66);
    }
    const cameraPosition = {
      x: arena.camera.position.x,
      y: arena.camera.position.y,
      z: arena.camera.position.z,
    } satisfies Vec3;
    const closest = closestPointOnSegment(cameraPosition, event.from, event.to);
    const missDistance = distance(cameraPosition, closest);
    if (missDistance < 9 && event.weapon !== 'knife') {
      sound.whiz(missDistance, panForPoint(closest));
    }
    if (event.weapon !== 'knife') {
      const shooter = latestSnapshot?.players.find((player) => player.id === event.shooterId);
      const observer = latestLocalPlayer;
      if (shooter && observer && shooter.team !== observer.team) {
        hud.registerRadarShot(event.from);
      }
    }
  } else {
    if (event.weapon === 'knife') {
      viewmodel.triggerKnifeSlash();
    } else {
      viewmodel.triggerFire();
      applyRecoil(event.weapon);
      if (isScopedWeapon(event.weapon)) {
        scopeRecoverUntil = performance.now() + AWP_SCOPE_RECOVER_MS;
        setScoped(false);
      }
    }
  }
  // A knife swing that misses reports the end of its short range, not a wall
  // hit. Do not leave a bullet mark floating in the air for it.
  if (event.hitPlayerId === null && event.weapon !== 'knife') {
    const dx = event.to.x - event.from.x;
    const dy = event.to.y - event.from.y;
    const dz = event.to.z - event.from.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    effects.spawnBulletMark(event.to, { x: dx / length, y: dy / length, z: dz / length });
    effects.spawnImpact(event.to, 0xff5d5d, 3);
  }
});

connection.socket.on('kill', (event) => {
  if (!joined) {
    return;
  }
  hud.addKill(event, localPlayerId);
  if (event.victimId === localPlayerId) {
    localKillerName = event.killerId === event.victimId ? null : event.killerName;
  }
  if (event.killerId !== event.victimId && !isEconomyMode(latestSnapshot?.match.mode ?? 'arena')) {
    const killerPlayer = latestSnapshot?.players.find((player) => player.id === event.killerId);
    const localPlayer = latestSnapshot?.players.find((player) => player.id === localPlayerId);
    const localWon =
      killerPlayer && localPlayer
        ? killerPlayer.team === localPlayer.team
        : event.killerId === localPlayerId;
    hud.showRoundWin(event.killerName, localWon);
  }
  if (event.killerId === localPlayerId) {
    sound.kill();
    hud.showToast(`ВЫ УСТРАНИЛИ ${event.victimName.toUpperCase()}`, 'success');
  }
});

connection.socket.on('round_summary', (event) => {
  if (!joined) {
    return;
  }
  hud.updateRoundStats(event, localPlayerId);
  if (isEconomyMode(latestSnapshot?.match.mode ?? 'arena') && event.winnerId !== null) {
    const winningPlayer = event.players.find((player) => player.playerId === event.winnerId);
    const localPlayerStats = event.players.find((player) => player.playerId === localPlayerId);
    const localWon =
      winningPlayer && localPlayerStats
        ? winningPlayer.team === localPlayerStats.team
        : event.winnerId === localPlayerId;
    hud.showRoundWin(event.winnerName ?? '', localWon, event.reason);
  }
});

connection.socket.on('bomb_event', (event) => {
  if (!joined) {
    return;
  }
  const cameraPos: Vec3 = {
    x: arena.camera.position.x,
    y: arena.camera.position.y,
    z: arena.camera.position.z,
  };
  const dist = event.playerId === localPlayerId ? 0 : distance(cameraPos, event.position);
  const pan = event.playerId === localPlayerId ? 0 : panForPoint(event.position);
  if (event.kind === 'plant_started') {
    if (dist <= BOMB.soundRadius) {
      sound.bombPlantStart(dist, pan);
    }
  } else if (event.kind === 'planted') {
    if (dist <= BOMB.soundRadius) {
      sound.bombPlanted(dist, pan);
    }
    hud.showBombPlanted(event.siteId ?? 'A');
    nextBombBeepAt = 0;
  } else if (event.kind === 'defuse_started') {
    if (dist <= BOMB.soundRadius) {
      sound.bombDefuseStart(dist, pan, event.hasKit === true);
    }
  } else if (event.kind === 'defused') {
    sound.bombDefused();
    hud.hideBombAlert();
    nextBombBeepAt = 0;
  } else if (event.kind === 'exploded') {
    sound.bombExplosion(dist);
    hud.hideBombAlert();
    effects.spawnExplosion(event.position, 0xff4d2e);
    if (dist < BOMB.explosionRadius * 1.4) {
      cameraShake = Math.min(0.16, cameraShake + 0.08);
    }
    nextBombBeepAt = 0;
  } else if (event.kind === 'picked_up') {
    if (event.playerId === localPlayerId) {
      hud.showPickup('C4');
      sound.pickup();
    }
  } else if (event.kind === 'dropped') {
    if (event.playerId === localPlayerId) {
      hud.showToast('БОМБА СБРОШЕНА', 'info');
    }
  }
});

connection.socket.on('pickup', (event) => {
  if (!joined || event.playerId !== localPlayerId) {
    return;
  }
  hud.showPickup(getWeapon(event.weapon).name);
  sound.pickup();
});

connection.socket.on('armor_pickup', (event) => {
  if (!joined || event.playerId !== localPlayerId) {
    return;
  }
  hud.showPickup(`БРОНЯ +${event.amount}`);
  sound.pickup();
});

connection.socket.on('map_changed', (event) => {
  window.sessionStorage.setItem('wow-map', event.mapId);
  window.location.reload();
});

connection.socket.on('announce', (event) => {
  hud.showToast(event.text, event.tone);
});

connection.socket.on('round_end', (event) => {
  if (!joined) {
    return;
  }
  currentPhase = 'ended';
  presentResults(event);
});

connection.socket.on('server_error', (message) => {
  hud.showError(message);
});

connection.socket.on('disconnect', () => {
  if (currentSession !== null) {
    hud.setReconnecting(true, 'ПЕРЕПОДКЛЮЧЕНИЕ...');
  }
});

const onKeyDown = (event: KeyboardEvent): void => {
  const target = event.target;
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
  if (typing && !buyMenuOpen) {
    return;
  }
  if (event.code === 'KeyB' && joined && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (buyMenuOpen) {
      closeBuyMenu();
    } else {
      openBuyMenu();
    }
    return;
  }
  if (event.code === 'Escape' && buyMenuOpen) {
    event.preventDefault();
    closeBuyMenu();
    return;
  }
  if (event.code === 'Tab' && !event.metaKey && !event.altKey && joined && !buyMenuOpen) {
    event.preventDefault();
    if (!scoreboardVisible) {
      scoreboardVisible = true;
      hud.showScoreboard(true);
    }
  }
};

const onKeyUp = (event: KeyboardEvent): void => {
  if (event.code === 'Tab' && scoreboardVisible) {
    scoreboardVisible = false;
    hud.showScoreboard(false);
  }
};

const onVisibilityChange = (): void => {
  if (document.hidden) {
    scoreboardVisible = false;
    hud.showScoreboard(false);
    closeBuyMenu(false);
    input.setEnabled(false);
  } else {
    updateInputState();
  }
};

const onResize = (): void => {
  viewmodel.resize(window.innerWidth / window.innerHeight);
};

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
document.addEventListener('visibilitychange', onVisibilityChange);
window.addEventListener('resize', onResize);

function attemptJoin(
  name: string,
  existingSession: StoredSession | null,
  silent: boolean,
  roomId?: string,
): Promise<void> {
  if (joinInFlight || joined) {
    return Promise.resolve();
  }
  if (!connection.socket.connected) {
    if (!silent) {
      hud.showError('Нет соединения с сервером');
    }
    return Promise.resolve();
  }

  joinInFlight = true;
  hud.setJoinBusy(true);
  if (!silent) {
    hud.showStart(name);
  }

  const request: JoinRequest = existingSession
    ? {
        name,
        roomId,
        playerId: existingSession.playerId,
        sessionToken: existingSession.sessionToken,
      }
    : { name, roomId };

  return connection
    .join(request)
    .then((result) => {
      if (!result.ok) {
        joined = false;
        hud.showStart(name, result.error ?? 'Не удалось войти');
        return;
      }

      joined = true;
      localPlayerId = result.playerId ?? null;
      currentName = result.name ?? name;

      if (result.mapId !== undefined && result.mapId !== currentMap.id) {
        const nextMap = getMapById(result.mapId);
        if (nextMap !== undefined) {
          currentMap = nextMap;
          window.sessionStorage.setItem('wow-map', nextMap.id);
          arena.switchMap(nextMap);
          hud.setMapInfo(nextMap);
        }
      }

      if (result.playerId !== undefined && result.sessionToken !== undefined) {
        currentSession = {
          playerId: result.playerId,
          sessionToken: result.sessionToken,
          name: currentName,
        };
        saveSession(currentSession);
      }
      savePlayerName(currentName);

      hud.setLocalPlayer(localPlayerId);
      hud.hideStart();
      hud.setReconnecting(false);
      hud.showToast(result.resumed ? 'СЕССИЯ ВОССТАНОВЛЕНА' : 'ВЫ ВОШЛИ В ЛОББИ', 'success');
      sound.resume();
      buffer.clear();
      updateInputState();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Не удалось войти';
      if (connection.socket.connected) {
        hud.showStart(name, message);
      } else if (!silent) {
        hud.showError(message);
      }
    })
    .finally(() => {
      joinInFlight = false;
      hud.setJoinBusy(false);
    });
}

function leaveGame(): void {
  if (joined) {
    connection.socket.emit('leave');
  }
  clearSession();
  currentSession = null;
  joined = false;
  joinInFlight = false;
  localPlayerId = null;
  wasAlive = false;
  wasReloading = false;
  wasReloadingUntil = null;
  lastLocalWeapon = null;
  latestLocalPlayer = null;
  latestSnapshot = null;
  latestLobby = null;
  currentPhase = 'lobby';
  resultsVisible = false;
  scopeRequested = false;
  scopeRecoverUntil = 0;
  setScoped(false);
  closeBuyMenu(false);
  buffer.clear();
  clearWorld();
  input.setEnabled(false);
  input.releasePointerLock();
  viewmodel.setVisible(false);
  hud.hideResults();
  hud.hideRoundWin();
  hud.showPause(false);
  hud.showScoreboard(false);
  hud.setLocalPlayer(null);
  document.body.classList.remove('is-awp');
  hud.showStart(currentName);
  connection
    .listRooms()
    .then((rooms) => hud.setRooms(rooms))
    .catch(() => {});
  scoreboardVisible = false;
}

function isLocalVictory(winnerId: string | null): boolean {
  if (winnerId === null) {
    return false;
  }
  if (winnerId === localPlayerId) {
    return true;
  }
  const localTeam =
    latestSnapshot?.players.find((player) => player.id === localPlayerId)?.team ??
    latestLobby?.players.find((player) => player.id === localPlayerId)?.team ??
    null;
  const winnerTeam =
    latestSnapshot?.players.find((player) => player.id === winnerId)?.team ??
    latestLobby?.players.find((player) => player.id === winnerId)?.team ??
    null;
  return localTeam !== null && winnerTeam !== null && localTeam === winnerTeam;
}

function presentResults(event: RoundEndEvent): void {
  if (resultsVisible) {
    return;
  }
  resultsVisible = true;
  closeBuyMenu(false);
  wasReloading = false;
  wasReloadingUntil = null;
  hud.hideRoundWin();
  hud.showResults(event, localPlayerId);
  sound.roundEnd(isLocalVictory(event.winnerId));
  input.setEnabled(false);
  input.releasePointerLock();
  viewmodel.setVisible(false);
  scopeRequested = false;
  scopeRecoverUntil = 0;
  setScoped(false);
  hud.showPause(false);
  hud.showScoreboard(false);
  hud.setBuyZoneNotice(false);
  scoreboardVisible = false;
}

function updateInputState(): void {
  const playable =
    joined &&
    (currentPhase === 'live' || currentPhase === 'countdown' || currentPhase === 'round_over');
  const interactive = playable && !buyMenuOpen;
  const locked = input.isPointerLocked();
  input.setEnabled(interactive && locked);
  if (!interactive || !locked || (currentPhase !== 'live' && currentPhase !== 'round_over')) {
    scopeRequested = false;
    setScoped(false);
  }
  viewmodel.setVisible(interactive && !scoped);
  hud.showPause(playable && !locked && !buyMenuOpen);
}

function handleLocalSnapshot(snapshot: Snapshot): void {
  const local = snapshot.players.find((player) => player.id === localPlayerId);
  if (local === undefined) {
    wasAlive = false;
    wasReloading = false;
    wasReloadingUntil = null;
    latestLocalPlayer = null;
    scopeRequested = false;
    setScoped(false);
    document.body.classList.remove('is-awp');
    viewmodel.setVisible(false);
    return;
  }
  latestLocalPlayer = local;

  if (local.activeWeapon !== lastLocalWeapon) {
    if (lastLocalWeapon !== null) {
      sound.switchWeapon();
    }
    viewmodel.setWeapon(local.activeWeapon);
    lastLocalWeapon = local.activeWeapon;
    document.body.classList.toggle('is-awp', local.activeWeapon === 'awp');
    if (!isScopedWeapon(local.activeWeapon)) {
      scopeRequested = false;
      scopeRecoverUntil = 0;
      setScoped(false);
    }
  }

  const reloadingUntil = local.reloadingUntil;
  const reloading = reloadingUntil !== null && reloadingUntil > snapshot.serverTime;
  if (reloading && !wasReloading) {
    sound.reload();
  } else if (
    !reloading &&
    wasReloading &&
    wasReloadingUntil !== null &&
    snapshot.serverTime >= wasReloadingUntil &&
    local.alive
  ) {
    sound.reloadFinish();
  }
  wasReloading = reloading;
  wasReloadingUntil = reloading ? reloadingUntil : null;

  if (local.alive && !wasAlive) {
    input.setLook(local.yaw, local.pitch);
    wasAlive = true;
    localKillerName = null;
  } else if (!local.alive) {
    wasAlive = false;
    wasReloading = false;
    wasReloadingUntil = null;
    scopeRequested = false;
    setScoped(false);
  }
}

function localInBuyZone(local: PlayerSnapshot): boolean {
  const spawnTeam = isEconomyMode(currentMap.mode)
    ? local.side === 't'
      ? 'alpha'
      : 'bravo'
    : local.team;
  return currentMap.spawns
    .filter((spawn) => spawn.team === spawnTeam)
    .some(
      (spawn) =>
        distance(
          { x: local.position.x, y: local.position.y, z: local.position.z } satisfies Vec3,
          spawn.position,
        ) <= BUY.buyZoneRadius && Math.abs(local.position.y - spawn.position.y) <= 2.5,
    );
}

function openBuyMenu(): void {
  if (
    !joined ||
    buyMenuOpen ||
    (currentPhase !== 'live' && currentPhase !== 'countdown' && currentPhase !== 'paused') ||
    latestSnapshot === null ||
    !isEconomyMode(latestSnapshot.match.mode) ||
    latestLocalPlayer === null
  ) {
    return;
  }
  if (!latestLocalPlayer.alive) {
    hud.showToast('Мёртвые не могут закупаться', 'error');
    return;
  }
  const remaining = latestSnapshot.match.buyEndsAt;
  if (remaining === null || remaining <= latestSnapshot.serverTime + 50) {
    hud.showToast('Время закупки истекло', 'error');
    return;
  }
  lastBuyInZone = localInBuyZone(latestLocalPlayer);
  if (!lastBuyInZone) {
    hud.setBuyZoneNotice(true);
    hud.showToast('Закупка доступна только на базе', 'error');
    return;
  }
  buyMenuOpen = true;
  scoreboardVisible = false;
  hud.showScoreboard(false);
  hud.showBuy(true);
  if (latestSnapshot !== null) {
    hud.updateBuy(latestSnapshot, localPlayerId, lastBuyInZone);
  }
  input.setEnabled(false);
  input.releasePointerLock();
  updateInputState();
}

function closeBuyMenu(restorePointer = true): void {
  if (!buyMenuOpen) {
    return;
  }
  buyMenuOpen = false;
  hud.showBuy(false);
  if (restorePointer && joined && (currentPhase === 'live' || currentPhase === 'countdown')) {
    input.requestPointerLock();
  }
  updateInputState();
}

function syncBuyMenu(snapshot: Snapshot): void {
  if (!buyMenuOpen) {
    return;
  }
  const local = snapshot.players.find((player) => player.id === localPlayerId);
  if (
    !isEconomyMode(snapshot.match.mode) ||
    local === undefined ||
    !local.alive ||
    (snapshot.match.phase !== 'live' && snapshot.match.phase !== 'countdown')
  ) {
    closeBuyMenu(false);
    return;
  }
  lastBuyInZone = localInBuyZone(local);
  if (!lastBuyInZone) {
    closeBuyMenu(false);
    return;
  }
  hud.updateBuy(snapshot, localPlayerId, lastBuyInZone);
}

function updateBuyZoneNotice(snapshot: Snapshot): void {
  const local = snapshot.players.find((player) => player.id === localPlayerId);
  const buyPhase = snapshot.match.phase === 'live' || snapshot.match.phase === 'countdown' || snapshot.match.phase === 'paused';
  const buying =
    snapshot.match.buyEndsAt !== null && snapshot.match.buyEndsAt > snapshot.serverTime && buyPhase;
  const show =
    isEconomyMode(snapshot.match.mode) &&
    buying &&
    local !== undefined &&
    local.alive &&
    !localInBuyZone(local);
  hud.setBuyZoneNotice(show);
}

function applySettings(next: GameSettings): void {
  settings = next;
  sound.setVolumes(settings.masterVolume, settings.effectsVolume);
  input.setToggleWalk(settings.toggleWalk);
  input.setToggleScope(settings.toggleScope);
  input.setSensitivityMultiplier(scoped ? settings.awpSensitivity : settings.sensitivity);
  if (!scoped) {
    arena.camera.fov = settings.fov;
    arena.camera.updateProjectionMatrix();
  }
}

function relativeAngle(source: Vec3): number {
  const dx = source.x - arena.camera.position.x;
  const dz = source.z - arena.camera.position.z;
  // Camera yaw, not input yaw: spectator cameras look elsewhere than the mouse.
  const yaw = arena.camera.rotation.y;
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  return Math.atan2(right, forward);
}

function panForPoint(point: Vec3): number {
  return clamp(Math.sin(relativeAngle(point)), -0.9, 0.9);
}

function closestPointOnSegment(point: Vec3, start: Vec3, end: Vec3): Vec3 {
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const abz = end.z - start.z;
  const lengthSquared = abx * abx + aby * aby + abz * abz;
  if (lengthSquared <= 1e-9) {
    return { ...start };
  }
  const t = clamp(
    ((point.x - start.x) * abx + (point.y - start.y) * aby + (point.z - start.z) * abz) /
      lengthSquared,
    0,
    1,
  );
  return {
    x: start.x + abx * t,
    y: start.y + aby * t,
    z: start.z + abz * t,
  };
}

function canUseScope(): boolean {
  return (
    joined &&
    (currentPhase === 'live' || currentPhase === 'round_over') &&
    latestLocalPlayer !== null &&
    latestLocalPlayer.alive &&
    isScopedWeapon(latestLocalPlayer.activeWeapon)
  );
}

function handleSecondary(down: boolean): void {
  if (spectatorLogical !== null) {
    if (down) {
      cycleSpectator(-1);
    }
    return;
  }
  if (settings.toggleScope) {
    if (down) {
      toggleScope();
    }
    return;
  }
  if (!down) {
    scopeRequested = false;
    setScoped(false);
    return;
  }
  if (!canUseScope()) {
    return;
  }
  scopeRequested = true;
  setScoped(true);
}

function clearWorld(): void {
  for (const view of remotePlayers.values()) {
    arena.scene.remove(view.root);
    view.dispose();
  }
  remotePlayers.clear();
  footstepTrackers.clear();

  for (const view of pickupViews.values()) {
    arena.scene.remove(view.root);
    view.dispose();
  }
  pickupViews.clear();

  for (const view of armorPickupViews.values()) {
    arena.scene.remove(view.root);
    view.dispose();
  }
  armorPickupViews.clear();

  for (const view of grenadeViews.values()) {
    arena.scene.remove(view.root);
    view.dispose();
  }
  grenadeViews.clear();
  bombView.update(null, 0);
  nextBombBeepAt = 0;
}

function updateFootsteps(frame: SampledFrame): void {
  if (
    frame.match.phase !== 'live' &&
    frame.match.phase !== 'countdown' &&
    frame.match.phase !== 'round_over'
  ) {
    footstepTrackers.clear();
    return;
  }

  const seen = new Set<string>();
  const stride = 1.45;
  for (const player of frame.players) {
    seen.add(player.id);
    let tracker = footstepTrackers.get(player.id);
    if (tracker === undefined) {
      tracker = { x: player.position.x, z: player.position.z, distance: 0 };
      footstepTrackers.set(player.id, tracker);
      continue;
    }

    const moved = Math.hypot(player.position.x - tracker.x, player.position.z - tracker.z);
    tracker.x = player.position.x;
    tracker.z = player.position.z;
    const local = player.id === localPlayerId;
    const silent =
      !player.alive || player.crouching || (local ? input.isWalking() : player.walking);
    if (silent || moved > 2) {
      tracker.distance = 0;
      continue;
    }

    tracker.distance += moved;
    if (tracker.distance >= stride) {
      tracker.distance %= stride;
      const distanceToCamera = local
        ? 0
        : Math.hypot(
            arena.camera.position.x - player.position.x,
            arena.camera.position.y - player.position.y,
            arena.camera.position.z - player.position.z,
          );
      sound.footstep(distanceToCamera, local ? 0 : panForPoint(player.position));
    }
  }

  for (const playerId of footstepTrackers.keys()) {
    if (!seen.has(playerId)) {
      footstepTrackers.delete(playerId);
    }
  }
}

function updateWorld(
  frame: SampledFrame,
  dt: number,
  serverNow: number,
  playFootsteps = true,
  includeLocal = false,
): void {
  if (playFootsteps) {
    updateFootsteps(frame);
  }
  const seenPlayers = new Set<string>();
  for (const player of frame.players) {
    if (player.id === localPlayerId && !includeLocal) {
      continue;
    }
    let view = remotePlayers.get(player.id);
    if (view === undefined) {
      view = new PlayerView(player.id);
      arena.scene.add(view.root);
      remotePlayers.set(player.id, view);
    }
    view.update(player, dt);
    if (player.id === hiddenPlayerId) {
      // First-person spectating: the camera sits inside this model.
      view.root.visible = false;
    }
    seenPlayers.add(player.id);
  }
  for (const [playerId, view] of remotePlayers) {
    if (!seenPlayers.has(playerId)) {
      arena.scene.remove(view.root);
      view.dispose();
      remotePlayers.delete(playerId);
    }
  }

  const seenPickups = new Set<string>();
  for (const pickup of frame.pickups) {
    let view = pickupViews.get(pickup.id);
    if (view === undefined) {
      view = new PickupView(pickup);
      arena.scene.add(view.root);
      pickupViews.set(pickup.id, view);
    }
    view.update(serverNow);
    seenPickups.add(pickup.id);
  }
  for (const [pickupId, view] of pickupViews) {
    if (!seenPickups.has(pickupId)) {
      arena.scene.remove(view.root);
      view.dispose();
      pickupViews.delete(pickupId);
    }
  }

  const seenArmorPickups = new Set<string>();
  for (const pickup of frame.armorPickups) {
    let view = armorPickupViews.get(pickup.id);
    if (view === undefined) {
      view = new ArmorPickupView(pickup);
      arena.scene.add(view.root);
      armorPickupViews.set(pickup.id, view);
    }
    view.update(serverNow);
    seenArmorPickups.add(pickup.id);
  }
  for (const [pickupId, view] of armorPickupViews) {
    if (!seenArmorPickups.has(pickupId)) {
      arena.scene.remove(view.root);
      view.dispose();
      armorPickupViews.delete(pickupId);
    }
  }

  const seenGrenades = new Set<string>();
  for (const grenade of frame.grenades) {
    let view = grenadeViews.get(grenade.id);
    if (view === undefined) {
      view = new GrenadeView(grenade);
      arena.scene.add(view.root);
      grenadeViews.set(grenade.id, view);
    }
    view.update(grenade, serverNow);
    seenGrenades.add(grenade.id);
  }
  for (const [grenadeId, view] of grenadeViews) {
    if (!seenGrenades.has(grenadeId)) {
      arena.scene.remove(view.root);
      view.dispose();
      grenadeViews.delete(grenadeId);
    }
  }

  bombView.update(frame.bomb, serverNow);
  if (
    frame.bomb !== null &&
    frame.bomb.state === 'planted' &&
    frame.bomb.explodeAt !== null &&
    frame.bomb.position !== null &&
    frame.match.phase === 'live'
  ) {
    const nowPerf = performance.now();
    if (nowPerf >= nextBombBeepAt) {
      const remainingMs = Math.max(0, frame.bomb.explodeAt - serverNow);
      const urgency = clamp(1 - remainingMs / BOMB.fuseTimeMs, 0, 1);
      const dist = distance(
        {
          x: arena.camera.position.x,
          y: arena.camera.position.y,
          z: arena.camera.position.z,
        } satisfies Vec3,
        frame.bomb.position,
      );
      sound.bombBeep(urgency, dist, panForPoint(frame.bomb.position));
      nextBombBeepAt = nowPerf + Math.max(150, 950 - urgency * 780);
    }
  } else {
    nextBombBeepAt = 0;
  }
}

function updateCamera(frame: SampledFrame, dt: number, serverNow: number): void {
  const local: PlayerSnapshot | null = frame.local;
  const playable =
    frame.match.phase === 'live' ||
    frame.match.phase === 'countdown' ||
    frame.match.phase === 'round_over';
  const alive = local !== null && local.alive;

  if (alive && playable && local !== null) {
    const eyeHeight = local.crouching ? 1.05 : 1.65;
    arena.camera.position.set(local.position.x, local.position.y + eyeHeight, local.position.z);
    const shakeX = (Math.random() - 0.5) * cameraShake;
    const shakeY = (Math.random() - 0.5) * cameraShake;
    arena.camera.rotation.y = input.yaw + shakeX;
    arena.camera.rotation.x = input.pitch + shakeY;
    arena.camera.rotation.z = (Math.random() - 0.5) * cameraShake * 0.55;

    const reloadingUntil = local.reloadingUntil;
    const reloading = reloadingUntil !== null && reloadingUntil > serverNow;
    const reloadMs = getWeapon(local.activeWeapon).reloadMs;
    const reloadProgress =
      reloading && reloadMs > 0 && reloadingUntil !== null
        ? clamp(1 - (reloadingUntil - serverNow) / reloadMs, 0, 1)
        : 0;

    updateScope(local, reloading);
    viewmodel.setWeapon(local.activeWeapon);
    viewmodel.setVisible(!scoped);
    viewmodel.update(dt, {
      now: serverNow,
      moving: input.isMoving(),
      crouching: local.crouching,
      reloading,
      reloadProgress,
      alive: true,
    });

    return;
  }

  setScoped(false);

  if (spectatorDisplayed !== null && local !== null && !local.alive && playable) {
    renderSpectatorCamera(spectatorDisplayed, frame, local, dt, serverNow);
    return;
  }

  viewmodel.setVisible(false);

  if (local !== null && !local.alive && playable) {
    renderCorpseCamera(local.position);
    return;
  }

  updateCinematicCamera();
}

/** Camera hovering over a dead body, looking where the mouse points. */
function renderCorpseCamera(position: Vec3): void {
  arena.camera.position.set(position.x, position.y + 2.1, position.z);
  arena.camera.rotation.y = input.yaw;
  arena.camera.rotation.x = -0.18;
  arena.camera.rotation.z = 0;
}

function renderSpectatorCamera(
  view: SpectatorView,
  frame: SampledFrame,
  local: PlayerSnapshot,
  dt: number,
  serverNow: number,
): void {
  if (view.kind === 'player') {
    const target = frame.players.find((player) => player.id === view.playerId);
    if (target !== undefined) {
      renderTeammateCamera(target, dt, serverNow);
      return;
    }
  }

  setSpectatorScope(false);
  viewmodel.setVisible(false);
  spectatedLastPosition = null;

  if (view.kind === 'bomb') {
    const bombPosition = frame.bomb?.position ?? lastBombPosition;
    if (bombPosition !== null) {
      lastBombPosition = { ...bombPosition };
      renderBombCamera(bombPosition);
      return;
    }
  }

  if (view.kind === 'corpse') {
    const body = frame.players.find((player) => player.id === view.playerId);
    if (body !== undefined) {
      renderCorpseCamera(body.position);
      return;
    }
  }

  renderCorpseCamera(local.position);
}

/** First-person view through a teammate's eyes, with their viewmodel. */
function renderTeammateCamera(target: PlayerSnapshot, dt: number, serverNow: number): void {
  const eyeHeight = target.crouching ? 1.05 : 1.65;
  arena.camera.position.set(target.position.x, target.position.y + eyeHeight, target.position.z);
  const shakeX = (Math.random() - 0.5) * cameraShake;
  const shakeY = (Math.random() - 0.5) * cameraShake;
  arena.camera.rotation.y = target.yaw + shakeX;
  arena.camera.rotation.x = target.pitch + shakeY;
  arena.camera.rotation.z = 0;

  const moved =
    spectatedLastPosition === null
      ? 0
      : Math.hypot(
          target.position.x - spectatedLastPosition.x,
          target.position.z - spectatedLastPosition.z,
        );
  spectatedLastPosition = { ...target.position };
  const moving = dt > 0 && moved / dt > 0.4;

  const reloadingUntil = target.reloadingUntil;
  const reloading = reloadingUntil !== null && reloadingUntil > serverNow;
  const reloadMs = getWeapon(target.activeWeapon).reloadMs;
  const reloadProgress =
    reloading && reloadMs > 0 && reloadingUntil !== null
      ? clamp(1 - (reloadingUntil - serverNow) / reloadMs, 0, 1)
      : 0;

  const targetScoped = target.scoped && isScopedWeapon(target.activeWeapon);
  setSpectatorScope(targetScoped);
  document.body.classList.toggle('is-awp', target.activeWeapon === 'awp');
  viewmodel.setWeapon(target.activeWeapon);
  viewmodel.setVisible(!targetScoped);
  viewmodel.update(dt, {
    now: serverNow,
    moving,
    crouching: target.crouching,
    reloading,
    reloadProgress,
    alive: true,
  });
}

/** CS2-like overhead orbit around the planted bomb; the mouse rotates it. */
function renderBombCamera(bombPosition: Vec3): void {
  // input.pitch is used as a per-frame delta and reset to 0 so the orbit
  // never sticks at the look-up/look-down limit.
  bombOrbitYaw = input.yaw;
  bombOrbitElevation = clamp(
    bombOrbitElevation - input.pitch,
    BOMB_CAM_MIN_ELEVATION,
    BOMB_CAM_MAX_ELEVATION,
  );
  input.setLook(input.yaw, 0);

  const camera = computeBombCamera(bombPosition, bombOrbitYaw, bombOrbitElevation, currentMap.boxes);
  arena.camera.position.set(camera.position.x, camera.position.y, camera.position.z);
  arena.camera.lookAt(camera.target.x, camera.target.y, camera.target.z);
}

function setSpectatorScope(visible: boolean): void {
  if (spectatorScoped === visible) {
    return;
  }
  spectatorScoped = visible;
  hud.setScope(visible);
  document.body.classList.toggle('is-scoped', visible);
  arena.camera.fov = visible ? SCOPE_FOV : settings.fov;
  arena.camera.updateProjectionMatrix();
}

function sameSpectatorView(a: SpectatorView, b: SpectatorView): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if ((a.kind === 'player' || a.kind === 'corpse') && (b.kind === 'player' || b.kind === 'corpse')) {
    return a.playerId === b.playerId;
  }
  return true;
}

function setSpectatorLogical(view: SpectatorView, nowPerf: number): void {
  spectatorLogical = view;
  spectatorLogicalSince = nowPerf;
}

function onSpectatorDisplayedChange(view: SpectatorView): void {
  spectatedLastPosition = null;
  hiddenPlayerId = view.kind === 'player' ? view.playerId : null;
  if (view.kind === 'bomb') {
    bombOrbitElevation = BOMB_CAM_DEFAULT_ELEVATION;
    input.setLook(input.yaw, 0);
  }
}

function resetSpectator(): void {
  if (spectatorLogical === null && spectatorDisplayed === null && spectatorHudKey === '') {
    return;
  }
  spectatorLogical = null;
  spectatorDisplayed = null;
  spectatorFadeStartedAt = null;
  spectatorFadeSwapped = false;
  spectatorHudKey = '';
  spectatedLastPosition = null;
  hiddenPlayerId = null;
  lastBombPosition = null;
  setSpectatorScope(false);
  hud.setSpectatorFade(0);
  hud.setSpectator(null);
  document.body.classList.toggle('is-awp', lastLocalWeapon === 'awp');
  if (lastLocalWeapon !== null) {
    viewmodel.setWeapon(lastLocalWeapon);
  }
}

/**
 * Advances the spectator state machine for this frame. Spectating only exists
 * in economy rounds, where dead players wait for the next round.
 */
function updateSpectator(frame: SampledFrame, nowPerf: number): void {
  const local = frame.local;
  const phase = frame.match.phase;
  if (
    localPlayerId === null ||
    local === null ||
    local.alive ||
    !isEconomyMode(frame.match.mode) ||
    (phase !== 'live' && phase !== 'round_over')
  ) {
    resetSpectator();
    return;
  }

  if (spectatorLogical === null || spectatorDisplayed === null) {
    const start: SpectatorView = { kind: 'self' };
    setSpectatorLogical(start, nowPerf);
    spectatorDisplayed = start;
    onSpectatorDisplayedChange(start);
  }

  const next = chooseSpectatorView({
    players: frame.players,
    localId: localPlayerId,
    bomb: frame.bomb,
    current: spectatorLogical ?? { kind: 'self' },
    currentSinceMs: nowPerf - spectatorLogicalSince,
  });
  if (next !== null && spectatorLogical !== null && !sameSpectatorView(next, spectatorLogical)) {
    setSpectatorLogical(next, nowPerf);
  }

  const logical = spectatorLogical ?? { kind: 'self' };
  const logicalKey = spectatorSubjectKey(logical, localPlayerId);
  const displayedKey =
    spectatorDisplayed === null ? '' : spectatorSubjectKey(spectatorDisplayed, localPlayerId);

  if (spectatorFadeStartedAt === null) {
    if (logicalKey !== displayedKey) {
      spectatorFadeStartedAt = nowPerf;
      spectatorFadeSwapped = false;
    } else {
      // Same subject (e.g. teammate -> their corpse): no fade needed.
      spectatorDisplayed = logical;
    }
  }

  let fadeAlpha = 0;
  if (spectatorFadeStartedAt !== null) {
    const elapsed = nowPerf - spectatorFadeStartedAt;
    if (!spectatorFadeSwapped && elapsed >= SPECTATE_FADE_OUT_MS) {
      spectatorFadeSwapped = true;
      spectatorDisplayed = logical;
      onSpectatorDisplayedChange(logical);
    } else if (spectatorFadeSwapped && logicalKey !== displayedKey) {
      // Target changed again while fading in: swap under the dark screen.
      spectatorDisplayed = logical;
      onSpectatorDisplayedChange(logical);
    }
    fadeAlpha = spectatorFadeAlpha(elapsed);
    if (elapsed >= SPECTATE_FADE_OUT_MS + SPECTATE_FADE_IN_MS) {
      spectatorFadeStartedAt = null;
      spectatorFadeSwapped = false;
    }
  }
  hud.setSpectatorFade(fadeAlpha);
  syncSpectatorHud(frame);
}

function syncSpectatorHud(frame: SampledFrame): void {
  const view = spectatorDisplayed;
  if (view === null || localPlayerId === null) {
    return;
  }
  const mates = aliveTeammates(frame.players, localPlayerId);
  const target =
    view.kind === 'player' ? frame.players.find((player) => player.id === view.playerId) : undefined;
  const mode = view.kind === 'player' ? 'player' : view.kind === 'bomb' ? 'bomb' : 'self';
  const targetId = target?.id ?? null;
  const canCycle = mates.length > 1 || (mates.length === 1 && view.kind !== 'player');
  const key = `${mode}|${targetId ?? ''}|${target?.name ?? ''}|${localKillerName ?? ''}|${canCycle}`;
  if (key === spectatorHudKey) {
    return;
  }
  spectatorHudKey = key;
  hud.setSpectator({
    mode,
    targetId,
    targetName: target?.name ?? null,
    killerName: localKillerName,
    canCycle,
  });
}

function cycleSpectator(direction: 1 | -1): void {
  if (spectatorLogical === null || latestSnapshot === null || localPlayerId === null) {
    return;
  }
  const currentId = spectatorLogical.kind === 'player' ? spectatorLogical.playerId : null;
  const nextId = cycleSpectatorTarget(latestSnapshot.players, localPlayerId, currentId, direction);
  if (nextId !== null && nextId !== currentId) {
    setSpectatorLogical({ kind: 'player', playerId: nextId }, performance.now());
  }
}

function toggleScope(): void {
  if (!canUseScope()) {
    scopeRequested = false;
    setScoped(false);
    return;
  }

  scopeRequested = !scopeRequested;
  if (!scopeRequested) {
    setScoped(false);
  } else {
    setScoped(true);
  }
}

function updateScope(local: PlayerSnapshot, reloading: boolean): void {
  const canScope =
    (currentPhase === 'live' || currentPhase === 'round_over') &&
    local.alive &&
    isScopedWeapon(local.activeWeapon) &&
    !reloading &&
    performance.now() >= scopeRecoverUntil;
  if (!canScope) {
    if (!local.alive || !isScopedWeapon(local.activeWeapon)) {
      scopeRequested = false;
      scopeRecoverUntil = 0;
    }
    setScoped(false);
    return;
  }
  setScoped(scopeRequested);
}

function setScoped(visible: boolean): void {
  if (scoped === visible) {
    return;
  }
  scoped = visible;
  input.setSensitivityMultiplier(visible ? settings.awpSensitivity : settings.sensitivity);
  hud.setScope(visible);
  document.body.classList.toggle('is-scoped', visible);
  arena.camera.fov = visible ? SCOPE_FOV : settings.fov;
  arena.camera.updateProjectionMatrix();
}

function applyRecoil(weaponId: WeaponId): void {
  const definition = getWeapon(weaponId);
  if (definition.slot === 'knife' || definition.recoil <= 0) {
    return;
  }

  const now = performance.now();
  if (recoilSprayWeapon !== weaponId || now - lastRecoilAt > RECOIL_RESET_MS) {
    recoilSprayShot = 0;
  }
  const kick = computeRecoilKick(definition, recoilSprayShot);
  recoilSprayWeapon = weaponId;
  recoilSprayShot += 1;
  lastRecoilAt = now;

  input.setLook(input.yaw + kick.yaw, input.pitch + kick.pitch);
  cameraShake = Math.min(0.07, cameraShake + definition.recoil * 0.25);
}

function updateCinematicCamera(): void {
  const time = performance.now() * 0.0001;
  arena.camera.position.set(
    Math.cos(time) * 20.5,
    8.2 + Math.sin(time * 1.4) * 1.3,
    Math.sin(time) * 20.5,
  );
  arena.camera.lookAt(0, 1.1, 0);
}

function clearCameraShake(dt: number): void {
  cameraShake = Math.max(0, cameraShake - dt * 0.85);
}

let frameHandle = 0;
let lastFrame = performance.now();
let inputAccumulator = 0;
let lastHudTick = 0;

function sendInputFrame(): void {
  if (!joined || !connection.socket.connected) {
    return;
  }
  const serverTime = connection.getServerTime();
  // Aim at the timestamp used to render remote players, so the server rewinds
  // targets to the same position the shooter saw.
  connection.socket.emit(
    'input',
    input.buildFrame(serverTime, scoped, buffer.getAimTime(serverTime)),
  );
}

function renderLoop(now: number): void {
  if (disposed) {
    return;
  }

  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const serverNow = connection.getServerTime();

  if (!joined || !connection.socket.connected) {
    inputAccumulator = 0;
  } else {
    inputAccumulator = Math.min(inputAccumulator + dt, INPUT_SEND_INTERVAL * 6);
    let sent = 0;
    while (inputAccumulator >= INPUT_SEND_INTERVAL && sent < 6) {
      sendInputFrame();
      inputAccumulator -= INPUT_SEND_INTERVAL;
      sent += 1;
    }
  }

  const sampled: SampledFrame | null = joined ? buffer.sample(serverNow, localPlayerId) : null;
  if (sampled !== null) {
    updateSpectator(sampled, now);
    updateWorld(sampled, dt, serverNow);
    updateCamera(sampled, dt, serverNow);
  } else {
    resetSpectator();
    updateCinematicCamera();
    viewmodel.setVisible(false);
  }

  // Flash blindness follows the eyes we are looking through.
  const blindSource =
    spectatorDisplayed?.kind === 'player' && sampled !== null
      ? (sampled.players.find((player) => player.id === hiddenPlayerId) ?? latestLocalPlayer)
      : latestLocalPlayer;
  hud.setBlind(blindSource === null ? 0 : blindSource.blindUntil - serverNow);
  if (now - lastHudTick >= 80) {
    lastHudTick = now;
    hud.tick(serverNow);
    hud.setNetwork(connection.getPingMs(), connection.getJitterMs(), connection.getLossPercent());
  }

  // Tactical Radar update with CS2 line-of-sight spotting
  const radarObserver =
    spectatorDisplayed?.kind === 'player' && sampled !== null
      ? (sampled.players.find((player) => player.id === hiddenPlayerId) ?? latestLocalPlayer)
      : (sampled?.local ?? latestLocalPlayer);

  if (
    radarObserver &&
    latestSnapshot !== null &&
    (currentPhase === 'live' || currentPhase === 'countdown' || currentPhase === 'round_over')
  ) {
    hud.setRadarVisible(true);

    const activePlayers = sampled ? sampled.players : latestSnapshot.players;
    const teammates = activePlayers.filter((p) => p.team === radarObserver.team && p.alive);
    const enemies = activePlayers.filter((p) => p.team !== radarObserver.team && p.alive);

    for (const enemy of enemies) {
      let isSpotted = false;
      for (const friendly of teammates) {
        const eyeY = friendly.position.y + (friendly.crouching ? 1.05 : 1.65);
        const eyePos = { x: friendly.position.x, y: eyeY, z: friendly.position.z };
        const eyeYaw = friendly.id === localPlayerId ? arena.camera.rotation.y : friendly.yaw;

        if (hasLineOfSight(currentMap, eyePos, eyeYaw, enemy.position)) {
          isSpotted = true;
          break;
        }
      }

      if (isSpotted) {
        hud.setRadarSpotted(enemy.id, enemy.position);
      } else {
        hud.markRadarLostSight(enemy.id);
      }
    }

    hud.updateRadar(radarObserver, latestSnapshot, currentMap, settings);
  } else {
    hud.setRadarVisible(false);
  }

  clearCameraShake(dt);
  effects.update(dt);

  arena.renderer.clear();
  arena.render();
  viewmodel.render(arena.renderer);

  frameHandle = requestAnimationFrame(renderLoop);
}

frameHandle = requestAnimationFrame(renderLoop);

const dispose = (): void => {
  if (disposed) {
    return;
  }
  disposed = true;
  cancelAnimationFrame(frameHandle);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  disposeShortcutGuard();
  connection.dispose();
  input.dispose();
  clearWorld();
  arena.scene.remove(bombView.root);
  bombView.dispose();
  effects.dispose();
  viewmodel.dispose();
  hud.dispose();
  arena.dispose();
  sound.dispose();
};

window.addEventListener('beforeunload', dispose, { once: true });
