import { randomBytes, randomUUID } from 'node:crypto';
import {
  BOMB,
  DEFAULT_MATCH_CONFIG,
  GRENADE,
  GRENADE_EFFECTS,
  NETWORK,
  PLAYER,
  type MatchConfig,
} from '../../shared/config';
import {
  BUY,
  ECONOMY,
  getBuyItem,
  getBuyPrice,
  isEconomyMode,
  type BuyItemId,
  type GrenadeType,
  type MatchMode,
  type Side,
} from '../../shared/economy';
import {
  ARENA_MAP,
  findBombSiteAt,
  getMapById,
  getSpawnsForTeam,
  type ArenaMap,
} from '../../shared/map';
import {
  clamp,
  distance,
  directionFromYawPitch,
  length,
  normalize,
  normalizeAngle,
  sub,
  vec3,
  type Vec3,
} from '../../shared/math';
import type {
  ArmorPickupEvent,
  BombEvent,
  BombSnapshot,
  BuyResultEvent,
  CountdownState,
  DeathCause,
  ExplosionEvent,
  GrenadeSnapshot,
  GrenadeThrownEvent,
  HitEvent,
  InputFrame,
  JoinRequest,
  JoinResult,
  KillEvent,
  LobbyPlayer,
  LobbyState,
  MatchEndReason,
  MatchPhase,
  MatchSnapshot,
  PickupEvent,
  PickupSnapshot,
  PlayerSnapshot,
  RoundEndEvent,
  RoundPlayerStats,
  RoundSummaryEvent,
  ScoreUpdate,
  ShotEvent,
  Snapshot,
  Team,
  RoomGameMode,
} from '../../shared/protocol';
import { damageAtDistance, getWeapon, isScopedWeapon } from '../../shared/weapons';
import { applyDamage, applyFallDamage } from './damage';
import { flashBlindDurationMs } from './flash';
import { recordHistory, trimHistory } from './history';
import {
  addGrenade,
  addWeapon,
  canAddGrenade,
  cancelReload,
  consumeShot,
  createWeaponInstance,
  finishReloadIfDue,
  getActiveWeapon,
  getGrenadeCount,
  removeGrenade,
  startReload,
  switchWeapon,
  syncGrenadeSlot,
} from './inventory';
import { createPlayer, playerEyePosition, resetPlayerForSpawn } from './player';
import { simulatePlayer } from './physics';
import { applySpread, computeSpread, raycastMap, raycastWorld } from './raycast';
import { Rng, randomSeed } from './rng';
import type {
  AreaEffectState,
  ArmorPickupState,
  BombState,
  BuyPurchase,
  GrenadeState,
  PickupState,
  PlayerState,
  WeaponInstance,
} from './types';

export type MatchEvent =
  | { type: 'lobby'; state: LobbyState }
  | { type: 'countdown'; state: CountdownState }
  | { type: 'hit'; event: HitEvent }
  | { type: 'shot'; event: ShotEvent }
  | { type: 'kill'; event: KillEvent }
  | { type: 'pickup'; event: PickupEvent }
  | { type: 'armor_pickup'; event: ArmorPickupEvent }
  | { type: 'grenade_thrown'; event: GrenadeThrownEvent }
  | { type: 'explosion'; event: ExplosionEvent }
  | { type: 'bomb_event'; event: BombEvent }
  | { type: 'buy_result'; event: BuyResultEvent }
  | { type: 'score_update'; event: ScoreUpdate }
  | { type: 'round_summary'; event: RoundSummaryEvent }
  | { type: 'round_end'; event: RoundEndEvent };

export interface MatchOptions {
  map?: ArenaMap;
  mode?: MatchMode;
  roomMode?: RoomGameMode;
  config?: Partial<MatchConfig>;
  seed?: number;
}

export interface JoinOutcome {
  result: JoinResult;
  player: PlayerState | null;
  replacedSocketId?: string;
}

const JUMP_BUFFER_MS = 150;
const SPRAY_RESET_MS = 300;
const PENDING_FIRE_TTL_MS = 250;

const TEAM_RANK: Record<Team, number> = { alpha: 0, bravo: 1 };

export function sanitizeName(raw: string): string {
  const cleaned = Array.from(raw)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  return Array.from(cleaned).slice(0, NETWORK.maxNameLength).join('');
}

function emptyScores(): Record<Team, number> {
  return { alpha: 0, bravo: 0 };
}

export class Match {
  readonly config: MatchConfig;
  readonly roomMode: RoomGameMode;
  mode: MatchMode;
  map: ArenaMap;

  get maxPlayers(): number {
    return this.roomMode === '2v2' ? 4 : 2;
  }

  get maxPerTeam(): number {
    return this.roomMode === '2v2' ? 2 : 1;
  }

  private readonly rng: Rng;
  private readonly players = new Map<string, PlayerState>();
  private readonly pickups = new Map<string, PickupState>();
  private readonly armorPickups = new Map<string, ArmorPickupState>();
  private readonly grenades = new Map<string, GrenadeState>();
  private readonly areaEffects: AreaEffectState[] = [];
  private readonly events: MatchEvent[] = [];

  private phase: MatchPhase = 'lobby';
  private round = 1;
  private roundWins: Record<Team, number> = emptyScores();
  private countdownEndsAt: number | null = null;
  private roundOverEndsAt: number | null = null;
  private matchEndsAt: number | null = null;
  private buyEndsAt: number | null = null;
  private roundEndsAt: number | null = null;
  private pausedBuyRemainingMs: number | null = null;
  private pausedRoundRemainingMs: number | null = null;
  private pausedBombRemainingMs: number | null = null;
  private bomb: BombState | null = null;
  private pauseDeadline: number | null = null;
  private pauseStartedAt: number | null = null;
  private remainingMatchMs: number;
  private winnerId: string | null = null;
  private roundWinnerTeam: Team | null = null;
  private roundEndReason: MatchEndReason | null = null;
  private endReason: MatchEndReason | null = null;
  private pendingMatchEnd: { winnerId: string | null; reason: MatchEndReason } | null = null;
  private tickCount = 0;
  private lastCountdownSecond: number | null = null;

  constructor(options: MatchOptions = {}) {
    this.config = { ...DEFAULT_MATCH_CONFIG, ...options.config };
    this.roomMode = options.roomMode ?? '1v1';
    this.map = options.map ?? ARENA_MAP;
    this.mode = options.mode ?? this.map.mode ?? 'arena';
    this.rng = new Rng(options.seed ?? randomSeed());
    this.remainingMatchMs = this.config.matchDurationMs;
    this.resetPickups(0);
    this.resetArmorPickups();
    this.resetBomb();
  }

  get currentPhase(): MatchPhase {
    return this.phase;
  }

  getPlayer(playerId: string): PlayerState | undefined {
    return this.players.get(playerId);
  }

  getPlayers(): PlayerState[] {
    return [...this.players.values()];
  }

  getPickups(): PickupState[] {
    return [...this.pickups.values()];
  }

  getArmorPickups(): ArmorPickupState[] {
    return [...this.armorPickups.values()];
  }

  getGrenades(): GrenadeState[] {
    return [...this.grenades.values()];
  }

  getAreaEffects(): AreaEffectState[] {
    return this.areaEffects.map((zone) => ({ ...zone, position: { ...zone.position } }));
  }

  getBomb(): BombState | null {
    if (this.bomb === null) {
      return null;
    }
    return {
      ...this.bomb,
      position: this.bomb.position === null ? null : { ...this.bomb.position },
    };
  }

  getMapId(): string {
    return this.map.id;
  }

  getMode(): MatchMode {
    return this.mode;
  }

  findPlayers(query: string): PlayerState[] {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) {
      return [];
    }
    return this.getOrderedPlayers().filter(
      (player) =>
        player.id === query.trim() ||
        player.id.startsWith(query.trim()) ||
        player.name.toLowerCase() === normalized ||
        player.name.toLowerCase().includes(normalized),
    );
  }

  kickPlayer(playerId: string, now: number): boolean {
    if (!this.players.has(playerId)) {
      return false;
    }
    this.players.delete(playerId);
    this.resetToLobby(now);
    return true;
  }

  restart(now: number): void {
    this.resetMatch(now);
    if (this.players.size >= 2) {
      this.startCountdown(now, false);
    } else {
      this.emitLobby();
    }
  }

  forceEnd(now: number): void {
    if (this.phase === 'ended') {
      return;
    }
    this.endMatch(this.scoreLeader(), 'time', now);
  }

  switchMap(mapId: string, now: number): ArenaMap | null {
    const nextMap = getMapById(mapId);
    if (nextMap === undefined) {
      return null;
    }
    this.map = nextMap;
    this.mode = nextMap.mode ?? 'arena';
    this.resetToLobby(now);
    return nextMap;
  }

  drainEvents(): MatchEvent[] {
    return this.events.splice(0, this.events.length);
  }

  join(socketId: string, request: JoinRequest, now: number): JoinOutcome {
    if (request.playerId !== undefined && request.sessionToken !== undefined) {
      const existing = this.players.get(request.playerId);
      if (existing !== undefined && existing.sessionToken === request.sessionToken) {
        const replacedSocketId =
          existing.connected && existing.socketId !== socketId
            ? (existing.socketId ?? undefined)
            : undefined;

        existing.connected = true;
        existing.socketId = socketId;
        existing.disconnectedAt = null;
        existing.lastInput = null;
        existing.lastInputSeq = 0;
        existing.pendingActions = [];
        existing.pendingFire = null;
        existing.lastFireHeld = false;

        if (this.phase === 'paused') {
          const everyoneConnected = this.getPlayers().every((player) => player.connected);
          if (everyoneConnected) {
            this.resumeFromPause(now);
          } else {
            this.pauseDeadline = now + this.config.reconnectWindowMs;
            this.emitLobby();
          }
        } else if (
          this.phase === 'lobby' &&
          this.shouldStartMatch()
        ) {
          this.startNewMatch(now);
        } else {
          this.emitLobby();
        }

        return {
          result: {
            ok: true,
            playerId: existing.id,
            sessionToken: existing.sessionToken,
            name: existing.name,
            team: existing.team,
            side: existing.side,
            resumed: true,
          },
          player: existing,
          replacedSocketId,
        };
      }
    }

    const name = sanitizeName(request.name);
    if (name.length === 0) {
      return {
        result: { ok: false, error: 'Введите имя (1–16 символов)' },
        player: null,
      };
    }

    if (this.players.size >= this.maxPlayers) {
      return {
        result: { ok: false, error: `Сервер заполнен: уже играют ${this.maxPlayers}` },
        player: null,
      };
    }

    const team = this.findFreeTeam();
    if (team === null) {
      return {
        result: { ok: false, error: 'Нет свободного слота' },
        player: null,
      };
    }

    const spawn = this.pickSpawn(team);
    if (spawn === null) {
      return {
        result: { ok: false, error: 'На карте нет точки спавна' },
        player: null,
      };
    }

    const id = randomUUID();
    const sessionToken = randomBytes(24).toString('hex');
    const player = createPlayer(id, sessionToken, name, team, now, spawn.position, spawn.yaw);
    player.socketId = socketId;
    player.ready = this.roomMode === '1v1';
    this.players.set(id, player);
    if (
      isEconomyMode(this.mode) &&
      player.side === 't' &&
      (this.bomb === null || this.bomb.carrierId === null)
    ) {
      this.resetBomb();
    }

    if (this.phase === 'lobby' || this.phase === 'ended') {
      if (this.shouldStartMatch()) {
        this.startNewMatch(now);
      } else {
        this.emitLobby();
      }
    } else {
      this.emitLobby();
    }

    return {
      result: {
        ok: true,
        playerId: id,
        sessionToken,
        name,
        team,
        side: player.side,
        resumed: false,
      },
      player,
    };
  }

  disconnect(playerId: string, now: number, socketId?: string): void {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return;
    }
    if (socketId !== undefined && player.socketId !== socketId) {
      return;
    }

    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = now;
    player.pendingFire = null;
    player.lastFireHeld = false;

    if (this.phase === 'round_over') {
      if (this.pendingMatchEnd !== null) {
        const pending = this.pendingMatchEnd;
        this.endMatch(pending.winnerId, pending.reason, now);
        return;
      }
      this.startNextRound(now);
    }

    if (this.phase === 'countdown') {
      this.cancelPlant(now);
      this.cancelDefuse(now);
      if (this.buyEndsAt !== null) {
        const countdownRemaining =
          this.countdownEndsAt !== null ? Math.max(0, this.countdownEndsAt - now) : 0;
        this.pausedBuyRemainingMs = Math.max(0, this.buyEndsAt - now - countdownRemaining);
      }
      this.phase = 'paused';
      this.countdownEndsAt = null;
      this.roundOverEndsAt = null;
      this.matchEndsAt = null;
      this.buyEndsAt = null;
      this.roundEndsAt = null;
      this.pauseDeadline = now + this.config.reconnectWindowMs;
      this.pauseStartedAt = now;
      this.lastCountdownSecond = null;
      this.emitLobby();
      return;
    }

    if (this.phase === 'live') {
      if (player.alive) {
        if (this.bomb !== null && this.bomb.state === 'carried' && this.bomb.planterId === player.id) {
          this.cancelPlant(now);
        }
        if (this.bomb !== null && this.bomb.defuserId === player.id) {
          this.cancelDefuse(now);
        }
        player.alive = false;
        player.health = 0;
        player.velocity = { x: 0, y: 0, z: 0 };
        player.scoped = false;
        player.deaths += 1;
        if (isEconomyMode(this.mode)) {
          player.respawnAt = null;
        }
        this.dropInventoryOnDeath(player, now);

        const killEvent: KillEvent = {
          killerId: player.id,
          killerName: 'Мир',
          victimId: player.id,
          victimName: player.name,
          weapon: 'fall',
          headshot: false,
          at: now,
        };
        this.events.push({ type: 'kill', event: killEvent });

        const scoreEvent: ScoreUpdate = {
          scores: this.getScores(),
          killerId: player.id,
          victimId: player.id,
          killerKills: player.kills,
          victimDeaths: player.deaths,
        };
        this.events.push({ type: 'score_update', event: scoreEvent });

        if (isEconomyMode(this.mode)) {
          const players = this.getOrderedPlayers();
          const aliveT = players.filter((p) => p.side === 't' && p.alive).length;
          const aliveCT = players.filter((p) => p.side === 'ct' && p.alive).length;
          if (aliveCT === 0) {
            this.resolveRound(this.getTeamForSide('t'), 'frags', now);
          } else if (aliveT === 0 && this.bomb?.state !== 'planted') {
            this.resolveRound(this.getTeamForSide('ct'), 'frags', now);
          }
        } else {
          const aliveAlpha = this.getPlayers().filter((p) => p.team === 'alpha' && p.alive).length;
          const aliveBravo = this.getPlayers().filter((p) => p.team === 'bravo' && p.alive).length;
          if (aliveAlpha === 0) {
            this.roundWinnerTeam = 'bravo';
            this.startRoundOver(now);
          } else if (aliveBravo === 0) {
            this.roundWinnerTeam = 'alpha';
            this.startRoundOver(now);
          }
        }
      }
      this.emitLobby();
      return;
    }

    if (this.phase === 'paused') {
      this.pauseDeadline = now + this.config.reconnectWindowMs;
      this.emitLobby();
      return;
    }

    this.removePlayer(playerId, now, false);
  }

  pause(now: number): void {
    if (this.phase === 'live' || this.phase === 'countdown') {
      this.cancelPlant(now);
      this.cancelDefuse(now);
      if (this.phase === 'live' && this.matchEndsAt !== null) {
        this.remainingMatchMs = Math.max(0, this.matchEndsAt - now);
      }
      if (this.buyEndsAt !== null) {
        const countdownRemaining =
          this.phase === 'countdown' && this.countdownEndsAt !== null
            ? Math.max(0, this.countdownEndsAt - now)
            : 0;
        this.pausedBuyRemainingMs = Math.max(0, this.buyEndsAt - now - countdownRemaining);
      }
      if (this.phase === 'live') {
        this.pausedRoundRemainingMs =
          this.roundEndsAt === null ? null : Math.max(0, this.roundEndsAt - now);
        if (this.bomb !== null && this.bomb.state === 'planted' && this.bomb.explodeAt !== null) {
          this.pausedBombRemainingMs = Math.max(1, this.bomb.explodeAt - now);
          this.bomb.explodeAt = null;
        }
      }
      this.phase = 'paused';
      this.countdownEndsAt = null;
      this.roundOverEndsAt = null;
      this.matchEndsAt = null;
      this.buyEndsAt = null;
      this.roundEndsAt = null;
      this.pauseDeadline = now + this.config.reconnectWindowMs;
      this.pauseStartedAt = now;
      this.lastCountdownSecond = null;
      this.emitLobby();
    }
  }

  leave(playerId: string, now: number): void {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return;
    }

    if (
      this.phase === 'live' ||
      this.phase === 'countdown' ||
      this.phase === 'round_over' ||
      this.phase === 'paused'
    ) {
      this.players.delete(playerId);
      const remainingAlpha = this.getPlayers().filter((p) => p.team === 'alpha' && p.connected);
      const remainingBravo = this.getPlayers().filter((p) => p.team === 'bravo' && p.connected);

      if (remainingAlpha.length === 0 && remainingBravo.length > 0) {
        this.endMatch(remainingBravo[0]?.id ?? null, 'abandon', now);
      } else if (remainingBravo.length === 0 && remainingAlpha.length > 0) {
        this.endMatch(remainingAlpha[0]?.id ?? null, 'abandon', now);
      } else if (remainingAlpha.length === 0 && remainingBravo.length === 0) {
        this.resetToLobby(now);
      } else {
        if (this.phase === 'paused') {
          const everyoneConnected = this.getPlayers().every((p) => p.connected);
          if (everyoneConnected) {
            this.resumeFromPause(now);
          } else {
            this.emitLobby();
          }
        } else {
          this.emitLobby();
        }
      }
      return;
    }

    this.removePlayer(playerId, now, false);
  }

  setInput(playerId: string, input: InputFrame, now: number): boolean {
    const player = this.players.get(playerId);
    if (player === undefined || !player.connected) {
      return false;
    }
    if (!Number.isFinite(input.seq) || input.seq <= player.lastInputSeq) {
      return false;
    }

    const wasFiring = player.lastInput?.fire === true;
    // Live-match and round_over presses can become shots. A tap during
    // countdown/pause must not survive as a queued shot into the next live tick.
    if (
      (this.phase === 'live' || this.phase === 'round_over') &&
      input.fire &&
      !wasFiring &&
      player.alive
    ) {
      player.pendingFire = {
        aimTime: input.aimTime,
        yaw: input.yaw,
        pitch: input.pitch,
        scoped: input.scoped,
        receivedAt: now,
      };
    }

    player.lastInputSeq = input.seq;
    player.lastInput = input;
    player.lastInputReceivedAt = now;
    if (input.switchTo !== null) {
      player.pendingActions.push({ type: 'switch', slot: input.switchTo });
    }
    if (input.reload) {
      player.pendingActions.push({ type: 'reload' });
    }
    if (input.use) {
      player.pendingActions.push({ type: 'use' });
    }
    if (input.drop) {
      player.pendingActions.push({ type: 'drop' });
    }
    if (player.pendingActions.length > 32) {
      player.pendingActions.splice(0, player.pendingActions.length - 32);
    }
    if (input.jump) {
      player.jumpBufferUntil = now + JUMP_BUFFER_MS;
    }

    if (this.phase === 'live' || this.phase === 'countdown' || this.phase === 'round_over') {
      player.yaw = normalizeAngle(input.yaw);
      player.pitch = clamp(input.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      player.walking = input.walk && player.alive;
      const activeWeapon = getActiveWeapon(player);
      player.scoped = input.scoped && isScopedWeapon(activeWeapon.id) && player.alive;
    }

    return true;
  }

  buy(playerId: string, itemId: string, now: number): BuyResultEvent | null {
    const player = this.players.get(playerId);
    if (player === undefined || !player.connected) {
      return null;
    }
    if (!this.canBuy(player, now)) {
      return this.emitBuyResult(
        player,
        itemId as BuyItemId,
        'buy',
        false,
        'Покупки сейчас недоступны',
      );
    }

    const item = getBuyItem(itemId);
    if (item === undefined) {
      return this.emitBuyResult(player, itemId as BuyItemId, 'buy', false, 'Неизвестный товар');
    }
    if (item.side !== 'both' && item.side !== player.side) {
      return this.emitBuyResult(
        player,
        item.id as BuyItemId,
        'buy',
        false,
        'Недоступно для вашей стороны',
      );
    }
    const price = getBuyPrice(item, player.armor, player.helmet);
    if (player.money < price) {
      return this.emitBuyResult(player, item.id as BuyItemId, 'buy', false, 'Недостаточно денег');
    }

    const restore: BuyPurchase['restore'] = {};
    let bought = false;

    if (item.weapon !== undefined) {
      const definition = getWeapon(item.weapon);
      if (definition.slot === 'grenade') {
        const type = item.weapon as GrenadeType;
        if (!canAddGrenade(player, type)) {
          return this.emitBuyResult(player, item.id as BuyItemId, 'buy', false, 'Лимит гранат');
        }
        restore.grenadeCounts = { ...player.grenadeCounts };
        addGrenade(player, type);
        bought = true;
      } else if (definition.slot === 'primary' || definition.slot === 'secondary') {
        const slot = definition.slot;
        const existing = player.inventory[slot];
        if (existing !== null && existing.id === item.weapon) {
          return this.emitBuyResult(player, item.id as BuyItemId, 'buy', false, 'Уже куплено');
        }
        restore[slot] = existing === null ? null : { ...existing };
        player.inventory[slot] = createWeaponInstance(item.weapon);
        player.activeSlot = slot;
        player.sprayShots = 0;
        cancelReload(player);
        bought = true;
      }
    } else if (item.gear === 'kevlar') {
      if (player.armor >= PLAYER.maxArmor) {
        return this.emitBuyResult(player, item.id as BuyItemId, 'buy', false, 'Броня уже куплена');
      }
      restore.armor = player.armor;
      restore.helmet = player.helmet;
      player.armor = PLAYER.maxArmor;
      bought = true;
    } else if (item.gear === 'kevlar_helmet') {
      if (player.armor >= PLAYER.maxArmor && player.helmet) {
        return this.emitBuyResult(player, item.id as BuyItemId, 'buy', false, 'Шлем уже куплен');
      }
      restore.armor = player.armor;
      restore.helmet = player.helmet;
      player.armor = PLAYER.maxArmor;
      player.helmet = true;
      bought = true;
    } else if (item.gear === 'defuse_kit') {
      if (player.defuseKit) {
        return this.emitBuyResult(player, item.id as BuyItemId, 'buy', false, 'Кит уже куплен');
      }
      restore.defuseKit = player.defuseKit;
      player.defuseKit = true;
      bought = true;
    }

    if (!bought) {
      return this.emitBuyResult(player, item.id as BuyItemId, 'buy', false, 'Товар недоступен');
    }

    player.money = clamp(player.money - price, 0, ECONOMY.maxMoney);
    player.purchases.push({
      itemId: item.id as BuyItemId,
      price,
      at: now,
      restore,
    });
    return this.emitBuyResult(player, item.id as BuyItemId, 'buy', true);
  }

  refund(playerId: string, itemId: string, now: number): BuyResultEvent | null {
    const player = this.players.get(playerId);
    if (player === undefined || !player.connected) {
      return null;
    }
    if (!this.canBuy(player, now)) {
      return this.emitBuyResult(
        player,
        itemId as BuyItemId,
        'refund',
        false,
        'Возврат сейчас недоступен',
      );
    }

    const last = player.purchases[player.purchases.length - 1];
    if (last === undefined || last.itemId !== itemId) {
      return this.emitBuyResult(
        player,
        itemId as BuyItemId,
        'refund',
        false,
        'Эту покупку нельзя вернуть',
      );
    }

    const item = getBuyItem(last.itemId);
    if (item === undefined) {
      return this.emitBuyResult(player, itemId as BuyItemId, 'refund', false, 'Неизвестный товар');
    }

    if (item.weapon !== undefined) {
      const definition = getWeapon(item.weapon);
      if (definition.slot === 'grenade') {
        const type = item.weapon as GrenadeType;
        const before = last.restore.grenadeCounts?.[type] ?? 0;
        if (getGrenadeCount(player, type) !== before + 1) {
          return this.emitBuyResult(
            player,
            item.id as BuyItemId,
            'refund',
            false,
            'Граната уже использована',
          );
        }
        if (before <= 0) {
          delete player.grenadeCounts[type];
        } else {
          player.grenadeCounts[type] = before;
        }
        syncGrenadeSlot(player);
      } else if (definition.slot === 'primary' || definition.slot === 'secondary') {
        const slot = definition.slot;
        if (player.inventory[slot]?.id !== item.weapon || player.roundShots > 0) {
          return this.emitBuyResult(
            player,
            item.id as BuyItemId,
            'refund',
            false,
            'Оружие уже использовано',
          );
        }
        player.inventory[slot] = last.restore[slot] ?? null;
        if (player.activeSlot === slot && player.inventory[slot] === null) {
          player.activeSlot =
            player.inventory.primary !== null
              ? 'primary'
              : player.inventory.secondary !== null
                ? 'secondary'
                : player.inventory.grenade !== null
                  ? 'grenade'
                  : 'knife';
        }
      }
    } else if (item.gear === 'kevlar') {
      if (player.armor < PLAYER.maxArmor) {
        return this.emitBuyResult(
          player,
          item.id as BuyItemId,
          'refund',
          false,
          'Броня уже повреждена',
        );
      }
      player.armor = last.restore.armor ?? 0;
      player.helmet = last.restore.helmet ?? false;
    } else if (item.gear === 'kevlar_helmet') {
      if (player.armor < PLAYER.maxArmor || !player.helmet) {
        return this.emitBuyResult(
          player,
          item.id as BuyItemId,
          'refund',
          false,
          'Шлем уже повреждён',
        );
      }
      player.armor = last.restore.armor ?? 0;
      player.helmet = last.restore.helmet ?? false;
    } else if (item.gear === 'defuse_kit') {
      if (!player.defuseKit) {
        return this.emitBuyResult(player, item.id as BuyItemId, 'refund', false, 'Кита нет');
      }
      player.defuseKit = last.restore.defuseKit ?? false;
    }

    player.purchases.pop();
    player.money = clamp(player.money + last.price, 0, ECONOMY.maxMoney);
    return this.emitBuyResult(player, item.id as BuyItemId, 'refund', true);
  }

  private canBuy(player: PlayerState, now: number): boolean {
    return (
      isEconomyMode(this.mode) &&
      (this.phase === 'live' || this.phase === 'countdown' || this.phase === 'paused') &&
      player.alive &&
      this.buyEndsAt !== null &&
      now < this.buyEndsAt &&
      this.isInBuyZone(player)
    );
  }

  private spawnTeamForPlayer(player: PlayerState): Team {
    if (isEconomyMode(this.mode)) {
      return player.side === 't' ? 'alpha' : 'bravo';
    }
    return player.team;
  }

  private isInBuyZone(player: PlayerState): boolean {
    return getSpawnsForTeam(this.map, this.spawnTeamForPlayer(player)).some(
      (spawn) =>
        distance(player.position, spawn.position) <= BUY.buyZoneRadius &&
        Math.abs(player.position.y - spawn.position.y) <= 2.5,
    );
  }

  private emitBuyResult(
    player: PlayerState,
    itemId: BuyItemId,
    action: BuyResultEvent['action'],
    ok: boolean,
    error?: string,
  ): BuyResultEvent {
    const event: BuyResultEvent = {
      playerId: player.id,
      itemId,
      action,
      ok,
      money: player.money,
      ...(error === undefined ? {} : { error }),
    };
    this.events.push({ type: 'buy_result', event });
    return event;
  }

  voteRematch(playerId: string, now: number): boolean {
    if (this.phase !== 'ended') {
      return false;
    }
    const player = this.players.get(playerId);
    if (player === undefined || !player.connected) {
      return false;
    }

    player.rematchVote = true;
    this.emitLobby();

    const connected = this.getPlayers().filter((candidate) => candidate.connected);
    if (connected.length === this.maxPlayers && connected.every((candidate) => candidate.rematchVote)) {
      this.startNewMatch(now);
    }
    return true;
  }

  tick(now: number, dt: number): void {
    this.tickCount += 1;
    this.handleTimeouts(now);

    if (this.phase === 'countdown') {
      this.tickCountdownActions(now);
      this.emitCountdown(now, false);
      if (this.countdownEndsAt !== null && now >= this.countdownEndsAt) {
        this.phase = 'live';
        this.countdownEndsAt = null;
        this.roundOverEndsAt = null;
        this.lastCountdownSecond = null;
        if (isEconomyMode(this.mode)) {
          this.roundEndsAt =
            this.pausedRoundRemainingMs === null
              ? now + BUY.roundTimeMs
              : now + this.pausedRoundRemainingMs;
          if (this.buyEndsAt === null) {
            this.buyEndsAt = now + BUY.buyTimeMs;
          }
          if (
            this.pausedBombRemainingMs !== null &&
            this.bomb !== null &&
            this.bomb.state === 'planted'
          ) {
            this.bomb.explodeAt = now + this.pausedBombRemainingMs;
          }
          this.pausedBombRemainingMs = null;
          this.pausedRoundRemainingMs = null;
          this.matchEndsAt = null;
        } else {
          this.buyEndsAt = null;
          this.roundEndsAt = null;
          this.matchEndsAt = now + this.remainingMatchMs;
        }
        this.emitLobby();
      }
      return;
    }

    if (this.phase === 'round_over') {
      if (this.roundOverEndsAt !== null && now >= this.roundOverEndsAt) {
        if (this.pendingMatchEnd !== null) {
          const pending = this.pendingMatchEnd;
          this.endMatch(pending.winnerId, pending.reason, now);
        } else {
          this.startNextRound(now);
        }
        return;
      }
      this.tickRoundOver(now, dt);
      return;
    }

    const phaseBeforeKillResolution: MatchPhase = this.phase;
    if (phaseBeforeKillResolution !== 'live') {
      return;
    }

    if (isEconomyMode(this.mode)) {
      if (this.roundEndsAt !== null && now >= this.roundEndsAt && this.bomb?.state !== 'planted') {
        this.resolveRound(this.getTeamForSide('ct'), 'time', now);
        return;
      }
    } else if (this.matchEndsAt !== null && now >= this.matchEndsAt) {
      this.endMatch(this.scoreLeader(), 'time', now);
      return;
    }

    const ordered = this.getOrderedPlayers();
    for (const player of ordered) {
      if (this.phase !== 'live') {
        break;
      }
      if (!player.connected) {
        continue;
      }

      if (!player.alive) {
        player.pendingActions = [];
        cancelReload(player);
        // Economy rounds have no mid-round respawn: the dead player spectates
        // until the next round spawns everyone at base.
        if (isEconomyMode(this.mode)) {
          player.respawnAt = null;
        } else if (player.respawnAt !== null && now >= player.respawnAt) {
          this.spawnPlayerAtBase(player, now);
        }
        continue;
      }

      const input =
        player.lastInput !== null && now - player.lastInputReceivedAt <= 250
          ? player.lastInput
          : this.idleInput(player, now);

      this.updatePlayerBombInteraction(player, input, now);
      const lockedByBomb = this.isPlantingOrDefusing(player);

      const actionFlags = this.processPendingActions(player, now);
      if (!isScopedWeapon(getActiveWeapon(player).id)) {
        player.scoped = false;
      }
      if (!actionFlags.use && !actionFlags.drop && !lockedByBomb) {
        this.tryPickup(player, now);
      }

      if (lockedByBomb) {
        player.jumpBufferUntil = 0;
        player.velocity.x = 0;
        player.velocity.z = 0;
      }
      const wantsJump = !lockedByBomb && (input.jump || player.jumpBufferUntil > now);
      const effectiveInput: InputFrame = lockedByBomb
        ? { ...input, forward: 0, strafe: 0, jump: false, fire: false }
        : wantsJump && !input.jump
          ? { ...input, jump: true }
          : input;
      const simulation = simulatePlayer(player, effectiveInput, dt, this.map, now);
      if (simulation.jumped) {
        player.jumpBufferUntil = 0;
      }
      if (simulation.fallSpeed > 0) {
        this.tryFallDamage(player, simulation.fallSpeed, now);
      }

      this.validatePlayerBombInteractionAfterMove(player, effectiveInput, now);

      const queuedFire = player.pendingFire;
      player.pendingFire = null;
      const pendingFire =
        !lockedByBomb && queuedFire !== null && now - queuedFire.receivedAt <= PENDING_FIRE_TTL_MS
          ? queuedFire
          : null;

      const active = getActiveWeapon(player);
      const definition = getWeapon(active.id);
      const firePressed = effectiveInput.fire && !player.lastFireHeld;
      if (!lockedByBomb) {
        if (getWeapon(active.id).slot === 'grenade') {
          if (effectiveInput.fire || pendingFire !== null) {
            this.tryThrowGrenade(player, now);
          }
        } else if (pendingFire !== null) {
          this.tryFire(
            player,
            now,
            pendingFire.aimTime,
            pendingFire.yaw,
            pendingFire.pitch,
            pendingFire.scoped,
          );
        } else if (effectiveInput.fire && (definition.automatic || firePressed)) {
          this.tryFire(
            player,
            now,
            effectiveInput.aimTime,
            effectiveInput.yaw,
            effectiveInput.pitch,
            effectiveInput.scoped,
          );
        }
      }
      player.lastFireHeld = effectiveInput.fire;

      finishReloadIfDue(player, now);
    }

    this.updateBomb(now);
    if (this.phase !== 'live') {
      for (const player of ordered) {
        recordHistory(player, now);
        trimHistory(player, now, this.config.historyRetentionMs);
      }
      return;
    }

    this.updateGrenades(now, dt);
    this.updateAreaEffects(now, dt);

    if (this.mode === 'arena') {
      for (const player of ordered) {
        if (this.phase === 'live' && player.kills >= this.config.fragLimit) {
          this.endMatch(player.id, 'frags', now);
          break;
        }
      }
    }

    for (const armorPickup of this.armorPickups.values()) {
      if (!armorPickup.available) {
        continue;
      }
      for (const player of ordered) {
        if (!player.connected || !player.alive || player.armor >= PLAYER.maxArmor) {
          continue;
        }
        if (distance(player.position, armorPickup.position) > 1.5) {
          continue;
        }
        if (Math.abs(player.position.y - armorPickup.position.y) > 1.2) {
          continue;
        }

        player.armor = Math.min(PLAYER.maxArmor, player.armor + armorPickup.amount);
        armorPickup.available = false;
        const event: ArmorPickupEvent = {
          playerId: player.id,
          amount: armorPickup.amount,
          pickupId: armorPickup.id,
        };
        this.events.push({ type: 'armor_pickup', event });
        break;
      }
    }

    for (const player of ordered) {
      recordHistory(player, now);
      trimHistory(player, now, this.config.historyRetentionMs);
    }
  }

  getLobbyState(): LobbyState {
    return {
      mapId: this.map.id,
      mapName: this.map.name,
      mode: this.mode,
      roomMode: this.roomMode,
      maxPlayers: this.maxPlayers,
      phase: this.phase,
      round: this.round,
      players: this.getOrderedPlayers().map((player) => this.toLobbyPlayer(player)),
      scores: this.getScores(),
      countdownEndsAt: this.countdownEndsAt,
      roundOverEndsAt: this.roundOverEndsAt,
      matchEndsAt: this.matchEndsAt,
      buyEndsAt: this.buyEndsAt,
      roundEndsAt: this.roundEndsAt,
      pauseDeadline: this.pauseDeadline,
      winnerId: this.winnerId,
      endReason: this.endReason,
      fragLimit: this.fragLimit(),
      roundsToWin: BUY.roundsToWin,
      sideSwapAfterRound: BUY.sideSwapAfterRound,
    };
  }

  getSnapshot(now: number): Snapshot {
    const scores = this.getScores();
    const match: MatchSnapshot = {
      mode: this.mode,
      phase: this.phase,
      round: this.round,
      scores,
      timeRemainingMs: isEconomyMode(this.mode)
        ? this.phase === 'live' && this.roundEndsAt !== null
          ? Math.max(0, this.roundEndsAt - now)
          : BUY.roundTimeMs
        : this.phase === 'live' && this.matchEndsAt !== null
          ? Math.max(0, this.matchEndsAt - now)
          : this.remainingMatchMs,
      countdownEndsAt: this.countdownEndsAt,
      roundOverEndsAt: this.roundOverEndsAt,
      matchEndsAt: this.matchEndsAt,
      buyEndsAt: this.buyEndsAt,
      roundEndsAt: this.roundEndsAt,
      pauseDeadline: this.pauseDeadline,
      rematchVotes: this.getOrderedPlayers()
        .filter((player) => player.rematchVote)
        .map((player) => player.id),
      winnerId: this.winnerId,
      endReason: this.endReason,
      fragLimit: this.fragLimit(),
      roundsToWin: BUY.roundsToWin,
      sideSwapAfterRound: BUY.sideSwapAfterRound,
    };

    return {
      tick: this.tickCount,
      serverTime: now,
      mapId: this.map.id,
      match,
      players: this.getOrderedPlayers().map((player) => this.toPlayerSnapshot(player)),
      pickups: this.getPickups()
        .filter((pickup) => pickup.available)
        .map((pickup) => this.toPickupSnapshot(pickup)),
      armorPickups: this.getArmorPickups()
        .filter((pickup) => pickup.available)
        .map((pickup) => this.toArmorPickupSnapshot(pickup)),
      grenades: this.getGrenades().map((grenade) => this.toGrenadeSnapshot(grenade)),
      bomb: this.toBombSnapshot(now),
    };
  }

  private findFreeTeam(): Team | null {
    const alphaCount = this.getPlayers().filter((player) => player.team === 'alpha').length;
    const bravoCount = this.getPlayers().filter((player) => player.team === 'bravo').length;

    if (alphaCount < this.maxPerTeam && bravoCount < this.maxPerTeam) {
      return alphaCount <= bravoCount ? 'alpha' : 'bravo';
    }
    if (alphaCount < this.maxPerTeam) {
      return 'alpha';
    }
    if (bravoCount < this.maxPerTeam) {
      return 'bravo';
    }
    return null;
  }

  chooseTeam(playerId: string, team: Team, _now: number): boolean {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return false;
    }
    if (this.phase !== 'lobby') {
      return false;
    }
    if (player.team === team) {
      return true;
    }
    const otherInTeam = this.getPlayers().filter((p) => p.id !== playerId && p.team === team);
    if (otherInTeam.length >= this.maxPerTeam) {
      return false;
    }
    player.team = team;
    player.side = team === 'alpha' ? 't' : 'ct';
    if (this.roomMode === '2v2') {
      player.ready = false;
    }
    const spawn = this.pickSpawn(team, player.id);
    if (spawn !== null) {
      player.position = { ...spawn.position };
      player.yaw = spawn.yaw;
    }
    this.emitLobby();
    return true;
  }

  setReady(playerId: string, ready: boolean, now: number): boolean {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return false;
    }
    if (this.phase !== 'lobby') {
      return false;
    }
    player.ready = ready;
    this.emitLobby();
    if (this.shouldStartMatch()) {
      this.startNewMatch(now);
    }
    return true;
  }

  private shouldStartMatch(): boolean {
    if (this.players.size !== this.maxPlayers) {
      return false;
    }
    const players = this.getPlayers();
    if (!players.every((player) => player.connected && player.ready)) {
      return false;
    }
    const alphaCount = players.filter((player) => player.team === 'alpha').length;
    const bravoCount = players.filter((player) => player.team === 'bravo').length;
    return alphaCount === this.maxPerTeam && bravoCount === this.maxPerTeam;
  }

  private getOrderedPlayers(): PlayerState[] {
    return [...this.players.values()].sort((a, b) => {
      const teamDelta = TEAM_RANK[a.team] - TEAM_RANK[b.team];
      if (teamDelta !== 0) {
        return teamDelta;
      }
      return a.joinedAt - b.joinedAt;
    });
  }

  private fragLimit(): number {
    return isEconomyMode(this.mode) ? BUY.roundsToWin : this.config.fragLimit;
  }

  private getScores(): Record<Team, number> {
    if (isEconomyMode(this.mode)) {
      return { ...this.roundWins };
    }
    const scores = emptyScores();
    for (const player of this.players.values()) {
      scores[player.team] += player.kills;
    }
    return scores;
  }

  private getTeamForSide(side: Side): Team | null {
    return this.getOrderedPlayers().find((player) => player.side === side)?.team ?? null;
  }

  private scoreLeader(): string | null {
    const ordered = this.getOrderedPlayers();
    if (isEconomyMode(this.mode)) {
      if (this.roundWins.alpha === this.roundWins.bravo) {
        return null;
      }
      const leaderTeam = this.roundWins.alpha > this.roundWins.bravo ? 'alpha' : 'bravo';
      return ordered.find((player) => player.team === leaderTeam)?.id ?? null;
    }
    const alpha = ordered.find((player) => player.team === 'alpha');
    const bravo = ordered.find((player) => player.team === 'bravo');
    if (alpha === undefined || bravo === undefined) {
      return alpha?.id ?? bravo?.id ?? null;
    }
    if (alpha.kills === bravo.kills) {
      return null;
    }
    return alpha.kills > bravo.kills ? alpha.id : bravo.id;
  }

  private findConnectedOpponent(player: PlayerState): PlayerState | null {
    for (const candidate of this.players.values()) {
      if (candidate.id !== player.id && candidate.connected) {
        return candidate;
      }
    }
    return null;
  }

  private pickSpawn(team: Team, forPlayerId?: string): { position: Vec3; yaw: number } | null {
    const spawns = getSpawnsForTeam(this.map, team);
    if (spawns.length === 0) {
      return null;
    }

    const occupied = this.getPlayers().filter(
      (player) => player.id !== forPlayerId && player.team === team && player.alive,
    );
    const freeSpawns = spawns.filter(
      (spawn) => !occupied.some((other) => distance(spawn.position, other.position) < 1.2),
    );
    const candidateSpawns = freeSpawns.length > 0 ? freeSpawns : spawns;

    const enemy =
      this.getPlayers().find((player) => player.team !== team && player.alive) ??
      this.getPlayers().find((player) => player.team !== team);
    if (enemy === undefined) {
      const chosen = this.rng.pick(candidateSpawns);
      return chosen === null ? null : { position: chosen.position, yaw: chosen.yaw };
    }

    let best = candidateSpawns[0];
    let bestDistance = -1;
    for (const spawn of candidateSpawns) {
      const currentDistance = distance(spawn.position, enemy.position);
      if (currentDistance > bestDistance) {
        best = spawn;
        bestDistance = currentDistance;
      }
    }
    return best === undefined ? null : { position: best.position, yaw: best.yaw };
  }

  private spawnPlayerAtBase(player: PlayerState, now: number, preserveLoadout = false): void {
    const spawn = this.pickSpawn(this.spawnTeamForPlayer(player), player.id);
    if (spawn === null) {
      return;
    }
    resetPlayerForSpawn(player, spawn.position, spawn.yaw, now, preserveLoadout);
    player.rematchVote = false;
    recordHistory(player, now);
  }

  private idleInput(player: PlayerState, now: number): InputFrame {
    return {
      seq: player.lastInputSeq,
      clientTime: now,
      aimTime: now,
      forward: 0,
      strafe: 0,
      yaw: player.yaw,
      pitch: player.pitch,
      jump: false,
      crouch: player.crouching,
      walk: false,
      fire: false,
      scoped: false,
      reload: false,
      use: false,
      useHeld: false,
      drop: false,
      switchTo: null,
    };
  }

  private tryFire(
    player: PlayerState,
    now: number,
    aimTime: number,
    yaw: number,
    pitch: number,
    scoped: boolean,
  ): void {
    if ((this.phase !== 'live' && this.phase !== 'round_over') || !player.alive) {
      return;
    }

    const weapon = getActiveWeapon(player);
    const definition = getWeapon(weapon.id);
    if (player.reloadingUntil !== null) {
      return;
    }
    if (definition.magazine > 0 && weapon.ammo <= 0) {
      if (weapon.reserve > 0) {
        startReload(player, now);
      }
      return;
    }

    const previousShotAt = player.lastFireAt;
    const shot = consumeShot(player, now);
    if (!shot.ok) {
      return;
    }

    const sprayIndex = now - previousShotAt > SPRAY_RESET_MS ? 0 : player.sprayShots;
    player.sprayShots = sprayIndex + 1;
    player.roundShots += 1;
    player.matchShots += 1;

    const shotTime = Number.isFinite(aimTime)
      ? clamp(aimTime, now - this.config.lagCompensationMs, now)
      : now;
    const origin = playerEyePosition(player);
    const aim = directionFromYawPitch(yaw, pitch);
    const horizontalSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    const spread = computeSpread(
      definition,
      horizontalSpeed,
      player.crouching,
      player.grounded,
      scoped,
      sprayIndex,
    );
    const direction = applySpread(aim, spread, this.rng);
    const worldHit = raycastWorld(
      this.map,
      this.getPlayers(),
      player,
      origin,
      direction,
      definition.range,
      shotTime,
    );

    const shotEvent: ShotEvent = {
      shooterId: player.id,
      weapon: weapon.id,
      from: origin,
      to: worldHit.point,
      hitPlayerId: worldHit.type === 'player' ? worldHit.playerHit.player.id : null,
      headshot: worldHit.type === 'player' && worldHit.playerHit.zone === 'head',
    };
    this.events.push({ type: 'shot', event: shotEvent });

    if (worldHit.type !== 'player') {
      return;
    }

    const victim = worldHit.playerHit.player;
    const baseDamage = damageAtDistance(definition, worldHit.distance);
    const result = applyDamage(
      victim,
      player,
      baseDamage,
      worldHit.playerHit.zone,
      now,
      this.config.respawnMs,
      { armorRatio: definition.armorRatio },
    );

    if (result.damage <= 0 && !result.killed) {
      return;
    }

    player.roundHits += 1;
    player.roundDamage += result.damage;
    player.matchHits += 1;
    player.matchDamage += result.damage;
    if (result.headshot) {
      player.roundHeadshots += 1;
      player.matchHeadshots += 1;
    }

    const hitEvent: HitEvent = {
      shooterId: player.id,
      victimId: victim.id,
      damage: result.damage,
      headshot: result.headshot,
      zone: result.zone,
      healthAfter: result.healthAfter,
      armorAfter: result.armorAfter,
      hitPoint: worldHit.point,
      sourcePosition: { ...origin },
      source: 'weapon',
    };
    this.events.push({ type: 'hit', event: hitEvent });

    if (result.killed) {
      this.handleKill(player, victim, weapon.id, result.headshot, now);
    }
  }

  private tryFallDamage(player: PlayerState, speed: number, now: number): void {
    if ((this.phase !== 'live' && this.phase !== 'round_over') || !player.alive) {
      return;
    }
    const result = applyFallDamage(player, speed, now, this.config.respawnMs);
    if (result.damage <= 0 && !result.killed) {
      return;
    }

    const hitEvent: HitEvent = {
      shooterId: player.id,
      victimId: player.id,
      damage: result.damage,
      headshot: false,
      zone: 'body',
      healthAfter: result.healthAfter,
      armorAfter: result.armorAfter,
      hitPoint: { ...player.position },
      sourcePosition: { ...player.position },
      source: 'fall',
    };
    this.events.push({ type: 'hit', event: hitEvent });

    if (result.killed) {
      this.handleKill(player, player, 'fall', false, now);
    }
  }

  private tryThrowGrenade(player: PlayerState, now: number): void {
    if ((this.phase !== 'live' && this.phase !== 'round_over') || !player.alive) {
      return;
    }
    const weapon = player.inventory.grenade;
    if (weapon === null || getWeapon(weapon.id).slot !== 'grenade') {
      return;
    }
    const type = weapon.id as GrenadeType;
    if (getGrenadeCount(player, type) <= 0) {
      return;
    }
    if (now - player.lastFireAt < 350) {
      return;
    }

    const effect = GRENADE_EFFECTS[type];
    player.lastFireAt = now;
    player.roundGrenadesThrown += 1;
    const origin = playerEyePosition(player);
    const aim = directionFromYawPitch(player.yaw, player.pitch);
    const velocity: Vec3 = {
      x: aim.x * GRENADE.throwSpeed + player.velocity.x * GRENADE.playerVelocityFactor,
      y: aim.y * GRENADE.throwSpeed + GRENADE.throwLift,
      z: aim.z * GRENADE.throwSpeed + player.velocity.z * GRENADE.playerVelocityFactor,
    };
    const grenade: GrenadeState = {
      id: `grenade:${randomUUID()}`,
      ownerId: player.id,
      team: player.team,
      type,
      position: {
        x: origin.x + aim.x * 0.4,
        y: origin.y + aim.y * 0.4,
        z: origin.z + aim.z * 0.4,
      },
      velocity,
      fuseAt: now + effect.fuseMs,
    };
    this.grenades.set(grenade.id, grenade);

    removeGrenade(player, type);
    player.scoped = false;

    const event: GrenadeThrownEvent = {
      playerId: player.id,
      grenadeId: grenade.id,
      type,
      position: { ...grenade.position },
      velocity: { ...grenade.velocity },
    };
    this.events.push({ type: 'grenade_thrown', event });
  }

  private updateGrenades(now: number, dt: number): void {
    for (const grenade of [...this.grenades.values()]) {
      if (grenade.type === 'smokegrenade') {
        const groundHit = raycastMap(this.map, grenade.position, { x: 0, y: -1, z: 0 }, 0.35);
        if (groundHit !== null && !grenade.hasTouchedGround) {
          grenade.hasTouchedGround = true;
          grenade.groundTouchedAt = now;
        }

        if (grenade.hasTouchedGround) {
          const speed = Math.hypot(grenade.velocity.x, grenade.velocity.y, grenade.velocity.z);
          const timeOnGround = now - (grenade.groundTouchedAt ?? now);
          const shouldExplode =
            (now >= grenade.fuseAt && (speed < 1.5 || timeOnGround > 500)) ||
            timeOnGround >= 1500;
          if (shouldExplode) {
            if (groundHit !== null) {
              grenade.position.y = groundHit.point.y + 0.1;
            }
            this.explodeGrenade(grenade, now);
            continue;
          }
        } else if (now >= grenade.fuseAt + 12000) {
          this.grenades.delete(grenade.id);
          continue;
        }
      } else {
        if (now >= grenade.fuseAt) {
          this.explodeGrenade(grenade, now);
          continue;
        }
      }

      const old = { ...grenade.position };
      grenade.velocity.y -= GRENADE.gravity * dt;
      const next: Vec3 = {
        x: grenade.position.x + grenade.velocity.x * dt,
        y: grenade.position.y + grenade.velocity.y * dt,
        z: grenade.position.z + grenade.velocity.z * dt,
      };

      // Arena bounds.
      const limitX = this.map.size / 2 - 0.15;
      const limitZ = this.map.sizeZ / 2 - 0.15;
      if (next.x < -limitX || next.x > limitX) {
        next.x = clamp(next.x, -limitX, limitX);
        grenade.velocity.x *= -GRENADE.bounceDamping;
      }
      if (next.z < -limitZ || next.z > limitZ) {
        next.z = clamp(next.z, -limitZ, limitZ);
        grenade.velocity.z *= -GRENADE.bounceDamping;
      }

      this.moveGrenade(grenade, old, next, now);
    }
  }

  private moveGrenade(grenade: GrenadeState, old: Vec3, next: Vec3, now: number): void {
    const radius = 0.13;
    const delta = sub(next, old);
    const travel = length(delta);
    if (travel < 1e-6) {
      grenade.position = next;
      return;
    }

    const hit = raycastMap(this.map, old, normalize(delta), travel + radius);
    if (hit === null) {
      grenade.position = next;
      return;
    }

    const box = this.map.boxes.find((candidate) => candidate.id === hit.boxId);
    if (box === undefined) {
      grenade.position = next;
      return;
    }

    // Find the face nearest to the impact point to recover a usable normal.
    const faces: ReadonlyArray<{ axis: 'x' | 'y' | 'z'; sign: -1 | 1; gap: number }> = [
      { axis: 'x', sign: -1, gap: Math.abs(hit.point.x - box.min.x) },
      { axis: 'x', sign: 1, gap: Math.abs(hit.point.x - box.max.x) },
      { axis: 'y', sign: -1, gap: Math.abs(hit.point.y - box.min.y) },
      { axis: 'y', sign: 1, gap: Math.abs(hit.point.y - box.max.y) },
      { axis: 'z', sign: -1, gap: Math.abs(hit.point.z - box.min.z) },
      { axis: 'z', sign: 1, gap: Math.abs(hit.point.z - box.max.z) },
    ];
    let normal = faces[0] ?? { axis: 'y' as const, sign: 1 as const, gap: 0 };
    for (const face of faces) {
      if (face.gap < normal.gap) {
        normal = face;
      }
    }

    const normalVec: Vec3 = { x: 0, y: 0, z: 0 };
    normalVec[normal.axis] = normal.sign;
    const impactSpeed =
      grenade.velocity.x * normalVec.x +
      grenade.velocity.y * normalVec.y +
      grenade.velocity.z * normalVec.z;

    grenade.position = {
      x: hit.point.x + normalVec.x * (radius + 0.001),
      y: hit.point.y + normalVec.y * (radius + 0.001),
      z: hit.point.z + normalVec.z * (radius + 0.001),
    };

    if (impactSpeed < 0) {
      const bounce = (1 + GRENADE.bounceDamping) * impactSpeed;
      grenade.velocity.x -= normalVec.x * bounce;
      grenade.velocity.y -= normalVec.y * bounce;
      grenade.velocity.z -= normalVec.z * bounce;
    }
    if (normal.axis === 'y') {
      grenade.velocity.x *= 0.72;
      grenade.velocity.z *= 0.72;
      if (normal.sign === 1) {
        grenade.hasTouchedGround = true;
        if (grenade.groundTouchedAt === undefined) {
          grenade.groundTouchedAt = now;
        }
      }
    }
  }

  private explodeGrenade(grenade: GrenadeState, now: number): void {
    this.grenades.delete(grenade.id);
    const owner = this.players.get(grenade.ownerId) ?? null;
    const effect = GRENADE_EFFECTS[grenade.type];
    const explosion: ExplosionEvent = {
      grenadeId: grenade.id,
      ownerId: grenade.ownerId,
      type: grenade.type,
      position: { ...grenade.position },
      radius: effect.radius,
      damage: effect.damage,
      durationMs: effect.durationMs,
    };
    this.events.push({ type: 'explosion', event: explosion });

    if (grenade.type === 'flashbang') {
      const burstSamples: Vec3[] = [
        grenade.position,
        { x: grenade.position.x, y: grenade.position.y + 0.45, z: grenade.position.z },
      ];
      for (const victim of this.getOrderedPlayers()) {
        if (!victim.alive) {
          continue;
        }
        const eye = playerEyePosition(victim);
        const toFlash = sub(grenade.position, eye);
        const flashDistance = length(toFlash);
        if (flashDistance < 0.001) {
          victim.blindUntil = Math.max(victim.blindUntil, now + effect.durationMs);
          continue;
        }
        const direction = normalize(toFlash);
        const aim = directionFromYawPitch(victim.yaw, victim.pitch);
        const angle = Math.acos(
          clamp(aim.x * direction.x + aim.y * direction.y + aim.z * direction.z, -1, 1),
        );
        const blocked = burstSamples.every((sample) => {
          const toSample = sub(sample, eye);
          const sampleDist = length(toSample);
          if (sampleDist < 0.25) {
            return false;
          }
          const sampleDir = normalize(toSample);
          return raycastMap(this.map, eye, sampleDir, Math.max(0, sampleDist - 0.25)) !== null;
        });
        const blindMs = flashBlindDurationMs({
          distance: flashDistance,
          angle,
          blocked,
        });
        if (blindMs > 0) {
          victim.blindUntil = Math.max(victim.blindUntil, now + blindMs);
        }
      }
      return;
    }

    if (grenade.type === 'smokegrenade') {
      this.areaEffects.push({
        id: `smoke:${randomUUID()}`,
        ownerId: grenade.ownerId,
        type: 'smokegrenade',
        position: { ...grenade.position },
        radius: effect.radius,
        endAt: now + effect.durationMs,
        nextTickAt: now + effect.durationMs,
        tickMs: effect.durationMs,
        damage: 0,
      });
      this.extinguishFiresNear(grenade.position, effect.radius);
      return;
    }

    if (grenade.type === 'molotov' || grenade.type === 'incendiary') {
      if (this.hasSmokeOverlap(grenade.position, effect.radius)) {
        return;
      }
      this.areaEffects.push({
        id: `fire:${randomUUID()}`,
        ownerId: grenade.ownerId,
        type: grenade.type,
        position: { ...grenade.position },
        radius: effect.radius,
        endAt: now + effect.durationMs,
        nextTickAt: now,
        tickMs: effect.tickMs ?? 500,
        damage: effect.damage,
      });
      return;
    }

    for (const victim of this.getOrderedPlayers()) {
      if (!victim.alive) {
        continue;
      }
      const center: Vec3 = {
        x: victim.position.x,
        y: victim.position.y + (victim.crouching ? 0.6 : 0.9),
        z: victim.position.z,
      };
      const dist = distance(grenade.position, center);
      if (dist > effect.radius) {
        continue;
      }

      const falloff = Math.max(GRENADE.minDamageFraction, 1 - dist / effect.radius);
      const result = applyDamage(
        victim,
        owner,
        effect.damage * falloff,
        'body',
        now,
        this.config.respawnMs,
        {
          armorRatio: 0.5,
          allowSelf: true,
          allowTeam: true,
        },
      );
      if (result.damage <= 0 && !result.killed) {
        continue;
      }

      if (owner !== null && owner.id !== victim.id) {
        owner.roundHits += 1;
        owner.roundDamage += result.damage;
        owner.matchHits += 1;
        owner.matchDamage += result.damage;
      }

      const hitEvent: HitEvent = {
        shooterId: grenade.ownerId,
        victimId: victim.id,
        damage: result.damage,
        headshot: false,
        zone: 'body',
        healthAfter: result.healthAfter,
        armorAfter: result.armorAfter,
        hitPoint: { ...center },
        sourcePosition: { ...grenade.position },
        source: 'grenade',
      };
      this.events.push({ type: 'hit', event: hitEvent });

      if (result.killed) {
        this.handleKill(owner ?? victim, victim, 'hegrenade', false, now);
      }
    }
  }

  private updateAreaEffects(now: number, _dt: number): void {
    for (let index = this.areaEffects.length - 1; index >= 0; index -= 1) {
      const zone = this.areaEffects[index];
      if (zone === undefined) {
        continue;
      }
      if (now >= zone.endAt) {
        this.areaEffects.splice(index, 1);
        continue;
      }
      if (zone.type !== 'smokegrenade' && this.hasSmokeOverlap(zone.position, zone.radius)) {
        this.areaEffects.splice(index, 1);
        continue;
      }
      if (zone.type === 'smokegrenade' || now < zone.nextTickAt) {
        continue;
      }
      zone.nextTickAt = Math.min(zone.endAt, now + zone.tickMs);
      const owner = this.players.get(zone.ownerId) ?? null;
      for (const victim of this.getOrderedPlayers()) {
        if ((this.phase !== 'live' && this.phase !== 'round_over') || !victim.alive) {
          continue;
        }
        const center: Vec3 = {
          x: victim.position.x,
          y: victim.position.y,
          z: victim.position.z,
        };
        if (distance(zone.position, center) > zone.radius) {
          continue;
        }
        const result = applyDamage(victim, owner, zone.damage, 'body', now, this.config.respawnMs, {
          armorRatio: 0.5,
          allowSelf: true,
          allowTeam: true,
        });
        if (result.damage <= 0 && !result.killed) {
          continue;
        }
        if (owner !== null && owner.id !== victim.id) {
          owner.roundHits += 1;
          owner.roundDamage += result.damage;
          owner.matchHits += 1;
          owner.matchDamage += result.damage;
        }
        const hitEvent: HitEvent = {
          shooterId: zone.ownerId,
          victimId: victim.id,
          damage: result.damage,
          headshot: false,
          zone: 'body',
          healthAfter: result.healthAfter,
          armorAfter: result.armorAfter,
          hitPoint: { ...center },
          sourcePosition: { ...zone.position },
          source: 'grenade',
        };
        this.events.push({ type: 'hit', event: hitEvent });
        if (result.killed) {
          this.handleKill(owner ?? victim, victim, zone.type, false, now);
        }
      }
    }
  }

  private hasSmokeOverlap(position: Vec3, radius: number): boolean {
    return this.areaEffects.some(
      (zone) =>
        zone.type === 'smokegrenade' && distance(zone.position, position) <= zone.radius + radius,
    );
  }

  private extinguishFiresNear(position: Vec3, radius: number): void {
    for (let index = this.areaEffects.length - 1; index >= 0; index -= 1) {
      const zone = this.areaEffects[index];
      if (
        zone !== undefined &&
        zone.type !== 'smokegrenade' &&
        distance(zone.position, position) <= zone.radius + radius
      ) {
        this.areaEffects.splice(index, 1);
      }
    }
  }

  private dropInventoryOnDeath(victim: PlayerState, now: number): void {
    const dropped: WeaponInstance[] = [];
    if (victim.inventory.primary !== null) {
      dropped.push(victim.inventory.primary);
    }
    if (victim.inventory.secondary !== null) {
      dropped.push(victim.inventory.secondary);
    }
    for (const [type, count] of Object.entries(victim.grenadeCounts) as Array<
      [GrenadeType, number]
    >) {
      for (let grenade = 0; grenade < count; grenade += 1) {
        dropped.push({ id: type, ammo: 1, reserve: 0 });
      }
    }

    victim.inventory.grenade = null;
    victim.inventory.grenadeCounts = {};
    victim.grenadeCounts = {};
    cancelReload(victim);

    for (let index = 0; index < dropped.length; index += 1) {
      const weapon = dropped[index];
      if (weapon === undefined) {
        continue;
      }
      const angle = (index / Math.max(1, dropped.length)) * Math.PI * 2;
      const offset = vec3(Math.cos(angle) * 0.45, 0, Math.sin(angle) * 0.45);
      this.createDroppedPickup(victim, weapon, now, offset);
    }

    if (this.bomb !== null && this.bomb.state === 'carried' && this.bomb.planterId === victim.id) {
      this.cancelPlant(now);
    }
    if (this.bomb !== null && this.bomb.defuserId === victim.id) {
      this.cancelDefuse(now);
    }
    if (this.bomb !== null && this.bomb.state === 'carried' && this.bomb.carrierId === victim.id) {
      this.bomb.state = 'dropped';
      this.bomb.carrierId = null;
      this.bomb.position = { ...victim.position };
      this.events.push({
        type: 'bomb_event',
        event: {
          kind: 'dropped',
          playerId: victim.id,
          siteId: null,
          position: { ...victim.position },
          explodeAt: null,
        },
      });
    }
  }

  private handleKill(
    killer: PlayerState,
    victim: PlayerState,
    weapon: DeathCause,
    headshot: boolean,
    now: number,
  ): void {
    const suicide = killer.id === victim.id;
    if (!suicide) {
      killer.kills += 1;
      if (headshot) {
        killer.matchHeadshotKills += 1;
      }
      if (isEconomyMode(this.mode)) {
        const reward = weapon === 'fall' || weapon === 'c4' ? 0 : (ECONOMY.killReward[weapon] ?? 0);
        this.awardMoney(killer, reward);
      }
    }
    victim.deaths += 1;
    if (isEconomyMode(this.mode)) {
      victim.respawnAt = null;
    }
    this.dropInventoryOnDeath(victim, now);

    const killEvent: KillEvent = {
      killerId: killer.id,
      killerName: suicide ? 'Мир' : killer.name,
      victimId: victim.id,
      victimName: victim.name,
      weapon,
      headshot,
      at: now,
    };
    this.events.push({ type: 'kill', event: killEvent });

    const scoreEvent: ScoreUpdate = {
      scores: this.getScores(),
      killerId: killer.id,
      victimId: victim.id,
      killerKills: killer.kills,
      victimDeaths: victim.deaths,
    };
    this.events.push({ type: 'score_update', event: scoreEvent });

    const phaseBeforeKillResolution: MatchPhase = this.phase;
    if (phaseBeforeKillResolution !== 'live') {
      return;
    }

    if (isEconomyMode(this.mode)) {
      const players = this.getOrderedPlayers();
      const aliveT = players.filter((player) => player.side === 't' && player.alive).length;
      const aliveCT = players.filter((player) => player.side === 'ct' && player.alive).length;
      if (aliveCT === 0) {
        this.resolveRound(this.getTeamForSide('t'), 'frags', now);
      } else if (aliveT === 0 && this.bomb?.state !== 'planted') {
        this.resolveRound(this.getTeamForSide('ct'), 'frags', now);
      }
      return;
    }

    const aliveAlpha = this.getPlayers().filter((player) => player.team === 'alpha' && player.alive).length;
    const aliveBravo = this.getPlayers().filter((player) => player.team === 'bravo' && player.alive).length;

    if (aliveAlpha === 0) {
      this.roundWinnerTeam = 'bravo';
    } else if (aliveBravo === 0) {
      this.roundWinnerTeam = 'alpha';
    } else {
      return;
    }

    if (!suicide && killer.kills >= this.config.fragLimit) {
      this.startRoundOver(now);
      if (this.phase === 'round_over') {
        this.pendingMatchEnd = { winnerId: killer.id, reason: 'frags' };
      }
      return;
    }

    this.startRoundOver(now);
  }

  private resolveRound(winnerTeam: Team | null, reason: MatchEndReason, now: number): void {
    const phaseBeforeKillResolution: MatchPhase = this.phase;
    if (phaseBeforeKillResolution !== 'live') {
      return;
    }
    this.roundWinnerTeam = winnerTeam;
    this.roundEndReason = reason;
    this.cancelPlant(now);
    this.cancelDefuse(now);

    if (isEconomyMode(this.mode)) {
      const winReward =
        reason === 'bomb' || reason === 'defuse' ? ECONOMY.bombWinReward : ECONOMY.winReward;
      if (winnerTeam !== null) {
        this.roundWins[winnerTeam] += 1;
        const winner = this.getOrderedPlayers().find((player) => player.team === winnerTeam);
        for (const player of this.getOrderedPlayers()) {
          if (player.team === winnerTeam) {
            player.lossStreak = 0;
            this.awardMoney(player, winReward);
          } else {
            const tier = Math.min(player.lossStreak, ECONOMY.lossBonus.length - 1);
            this.awardMoney(player, ECONOMY.lossBonus[tier] ?? 0);
            player.lossStreak = Math.min(ECONOMY.lossBonus.length - 1, player.lossStreak + 1);
          }
        }

        const finalReason: MatchEndReason =
          reason === 'time' || reason === 'bomb' || reason === 'defuse' ? reason : 'rounds';
        if (this.roundWins[winnerTeam] >= BUY.roundsToWin) {
          this.pendingMatchEnd = { winnerId: winner?.id ?? null, reason: finalReason };
        } else if (this.round >= BUY.regulationRounds) {
          this.pendingMatchEnd = { winnerId: this.scoreLeader(), reason: finalReason };
        }
      } else if (this.round >= BUY.regulationRounds) {
        this.pendingMatchEnd = { winnerId: null, reason: reason === 'time' ? 'time' : 'rounds' };
      }
    }

    this.startRoundOver(now);
  }

  private awardMoney(player: PlayerState, amount: number): void {
    player.money = clamp(player.money + amount, 0, ECONOMY.maxMoney);
  }

  private startRoundOver(now: number): void {
    const phaseBeforeKillResolution: MatchPhase = this.phase;
    if (phaseBeforeKillResolution !== 'live') {
      return;
    }
    if (this.mode === 'arena') {
      if (this.matchEndsAt !== null) {
        this.remainingMatchMs = Math.max(0, this.matchEndsAt - now);
      }
      if (this.remainingMatchMs <= 0) {
        this.endMatch(this.scoreLeader(), 'time', now);
        return;
      }
    }

    this.phase = 'round_over';
    this.roundOverEndsAt = now + this.config.roundResetMs;
    this.countdownEndsAt = null;
    this.matchEndsAt = null;
    this.buyEndsAt = null;
    this.roundEndsAt = null;
    this.pauseDeadline = null;
    this.pauseStartedAt = null;
    this.lastCountdownSecond = null;
    this.winnerId = null;
    this.endReason = this.roundEndReason;

    for (const player of this.players.values()) {
      if (!player.alive) {
        cancelReload(player);
      }
    }

    this.events.push({ type: 'round_summary', event: this.buildRoundSummary() });
    this.emitLobby();
  }

  private buildRoundSummary(): RoundSummaryEvent {
    const winner =
      this.roundWinnerTeam === null
        ? null
        : (this.getOrderedPlayers().find((player) => player.team === this.roundWinnerTeam) ?? null);
    const players: RoundPlayerStats[] = this.getOrderedPlayers().map((player) => ({
      playerId: player.id,
      name: player.name,
      team: player.team,
      side: player.side,
      damage: Math.round(player.roundDamage),
      hits: player.roundHits,
      shots: player.roundShots,
      headshots: player.roundHeadshots,
      matchDamage: Math.round(player.matchDamage),
      matchHits: player.matchHits,
      matchShots: player.matchShots,
      matchHeadshots: player.matchHeadshots,
      matchHeadshotKills: player.matchHeadshotKills,
      kills: player.kills,
      deaths: player.deaths,
    }));

    return {
      round: this.round,
      winnerId: winner?.id ?? null,
      winnerName: winner?.name ?? null,
      ...(this.roundEndReason === null ? {} : { reason: this.roundEndReason }),
      players,
    };
  }

  private startNextRound(now: number): void {
    if (this.mode === 'arena' && this.remainingMatchMs <= 0) {
      this.endMatch(this.scoreLeader(), 'time', now);
      return;
    }

    this.round += 1;
    this.countdownEndsAt = null;
    this.roundOverEndsAt = null;
    this.matchEndsAt = null;
    this.buyEndsAt = null;
    this.roundEndsAt = null;
    this.pauseDeadline = null;
    this.pauseStartedAt = null;
    this.lastCountdownSecond = null;
    this.winnerId = null;
    this.roundEndReason = null;
    this.endReason = null;
    this.pendingMatchEnd = null;

    if (isEconomyMode(this.mode)) {
      const halftime = this.round === BUY.sideSwapAfterRound + 1;
      if (halftime) {
        this.swapSides();
      }
      this.roundWinnerTeam = null;
      for (const player of this.getOrderedPlayers()) {
        player.pendingFire = null;
        player.lastFireHeld = false;
        if (halftime) {
          player.money = ECONOMY.startMoney;
          player.lossStreak = 0;
        }
        const preserve = !halftime && player.alive;
        this.spawnPlayerAtBase(player, now, preserve);
      }
      this.resetPickups(now);
      this.resetArmorPickups();
      this.resetBomb();
      const hasDisconnected = this.getPlayers().some((p) => !p.connected);
      if (hasDisconnected) {
        this.phase = 'paused';
        this.countdownEndsAt = null;
        this.roundOverEndsAt = null;
        this.matchEndsAt = null;
        this.buyEndsAt = now + BUY.buyTimeMs;
        this.roundEndsAt = null;
        this.pauseDeadline = now + this.config.reconnectWindowMs;
        this.pauseStartedAt = now;
        this.lastCountdownSecond = null;
        this.emitLobby();
        return;
      }

      this.phase = 'countdown';
      this.countdownEndsAt = now + this.config.countdownMs;
      this.buyEndsAt = now + this.config.countdownMs + BUY.buyTimeMs;
      this.emitLobby();
      this.emitCountdown(now, false);
      return;
    }

    this.phase = 'live';
    this.matchEndsAt = now + this.remainingMatchMs;

    const winnerTeam = this.roundWinnerTeam;
    this.roundWinnerTeam = null;
    for (const player of this.getOrderedPlayers()) {
      this.spawnPlayerAtBase(player, now, winnerTeam !== null && player.team === winnerTeam);
    }
    this.resetPickups(now);
    this.resetArmorPickups();
    this.resetBomb();

    const hasDisconnected = this.getPlayers().some((p) => !p.connected);
    if (hasDisconnected) {
      this.phase = 'paused';
      this.pauseDeadline = now + this.config.reconnectWindowMs;
      this.pauseStartedAt = now;
      this.emitLobby();
      return;
    }

    this.emitLobby();
  }

  private swapSides(): void {
    for (const player of this.getOrderedPlayers()) {
      player.side = player.side === 't' ? 'ct' : 't';
    }
  }

  private tickCountdownActions(now: number): void {
    for (const player of this.getOrderedPlayers()) {
      if (!player.connected || !player.alive) {
        player.pendingActions = [];
        continue;
      }
      const actions = player.pendingActions;
      player.pendingActions = [];
      for (const action of actions) {
        if (action.type === 'switch') {
          switchWeapon(player, action.slot);
        } else if (action.type === 'reload') {
          startReload(player, now);
        }
      }
      finishReloadIfDue(player, now);
    }
  }

  private tickRoundOver(now: number, dt: number): void {
    const ordered = this.getOrderedPlayers();
    for (const player of ordered) {
      if (!player.connected) {
        continue;
      }
      if (!player.alive) {
        player.pendingActions = [];
        cancelReload(player);
        continue;
      }

      const input =
        player.lastInput !== null && now - player.lastInputReceivedAt <= 250
          ? player.lastInput
          : this.idleInput(player, now);
      const actionFlags = this.processPendingActions(player, now);
      if (!isScopedWeapon(getActiveWeapon(player).id)) {
        player.scoped = false;
      }
      if (!actionFlags.use && !actionFlags.drop) {
        this.tryPickup(player, now);
      }
      const wantsJump = input.jump || player.jumpBufferUntil > now;
      const effectiveInput: InputFrame =
        wantsJump && !input.jump ? { ...input, jump: true } : input;
      const simulation = simulatePlayer(player, effectiveInput, dt, this.map, now);
      if (simulation.jumped) {
        player.jumpBufferUntil = 0;
      }
      if (simulation.fallSpeed > 0) {
        this.tryFallDamage(player, simulation.fallSpeed, now);
      }

      const queuedFire = player.pendingFire;
      player.pendingFire = null;
      const pendingFire =
        queuedFire !== null && now - queuedFire.receivedAt <= PENDING_FIRE_TTL_MS
          ? queuedFire
          : null;

      const active = getActiveWeapon(player);
      const definition = getWeapon(active.id);
      const firePressed = effectiveInput.fire && !player.lastFireHeld;
      if (definition.slot === 'grenade') {
        if (effectiveInput.fire || pendingFire !== null) {
          this.tryThrowGrenade(player, now);
        }
      } else if (pendingFire !== null) {
        this.tryFire(
          player,
          now,
          pendingFire.aimTime,
          pendingFire.yaw,
          pendingFire.pitch,
          pendingFire.scoped,
        );
      } else if (effectiveInput.fire && (definition.automatic || firePressed)) {
        this.tryFire(
          player,
          now,
          effectiveInput.aimTime,
          effectiveInput.yaw,
          effectiveInput.pitch,
          effectiveInput.scoped,
        );
      }
      player.lastFireHeld = effectiveInput.fire;

      finishReloadIfDue(player, now);
    }

    this.updateGrenades(now, dt);
    this.updateAreaEffects(now, dt);

    for (const armorPickup of this.armorPickups.values()) {
      if (!armorPickup.available) {
        continue;
      }
      for (const player of ordered) {
        if (!player.connected || !player.alive || player.armor >= PLAYER.maxArmor) {
          continue;
        }
        if (distance(player.position, armorPickup.position) > 1.5) {
          continue;
        }
        if (Math.abs(player.position.y - armorPickup.position.y) > 1.2) {
          continue;
        }

        player.armor = Math.min(PLAYER.maxArmor, player.armor + armorPickup.amount);
        armorPickup.available = false;
        const event: ArmorPickupEvent = {
          playerId: player.id,
          amount: armorPickup.amount,
          pickupId: armorPickup.id,
        };
        this.events.push({ type: 'armor_pickup', event });
        break;
      }
    }

    for (const player of ordered) {
      recordHistory(player, now);
      trimHistory(player, now, this.config.historyRetentionMs);
    }
  }

  private processPendingActions(player: PlayerState, now: number): { use: boolean; drop: boolean } {
    const actions = player.pendingActions;
    player.pendingActions = [];
    let used = false;
    let dropped = false;

    for (const action of actions) {
      if (action.type === 'switch') {
        switchWeapon(player, action.slot);
      } else if (action.type === 'reload') {
        startReload(player, now);
      } else if (action.type === 'use') {
        used = true;
        this.tryUse(player, now);
      } else {
        dropped = true;
        this.tryDrop(player, now);
      }
    }

    return { use: used, drop: dropped };
  }

  private tryUse(player: PlayerState, now: number): void {
    if ((this.phase !== 'live' && this.phase !== 'round_over') || !player.alive) {
      return;
    }
    if (this.isPlantingOrDefusing(player) || this.canStartBombAction(player)) {
      return;
    }
    if (now - player.lastUseAt < this.config.useCooldownMs) {
      return;
    }

    if (this.tryPickupDroppedBomb(player, now)) {
      return;
    }

    const nearest = this.findNearestPickup(player);
    if (nearest !== null) {
      const result = addWeapon(player, nearest.weapon, nearest.ammo, nearest.reserve);
      if (!result.added) {
        return;
      }

      player.lastUseAt = now;
      if (result.replaced !== null) {
        this.createDroppedPickup(player, result.replaced, now);
      }
      this.consumePickup(nearest, now);

      const event: PickupEvent = {
        playerId: player.id,
        weapon: nearest.weapon,
        pickupId: nearest.id,
        replacedWeapon: result.replaced?.id ?? null,
      };
      this.events.push({ type: 'pickup', event });
      return;
    }
  }

  private tryDrop(player: PlayerState, now: number): void {
    if ((this.phase !== 'live' && this.phase !== 'round_over') || !player.alive) {
      return;
    }
    if (now - player.lastUseAt < this.config.useCooldownMs) {
      return;
    }

    if (
      isEconomyMode(this.mode) &&
      this.bomb !== null &&
      this.bomb.state === 'carried' &&
      this.bomb.carrierId === player.id &&
      (player.activeSlot === 'knife' || player.inventory.primary === null)
    ) {
      this.cancelPlant(now);
      this.bomb.state = 'dropped';
      this.bomb.carrierId = null;
      this.bomb.position = { ...player.position };
      player.lastUseAt = now;
      this.events.push({
        type: 'bomb_event',
        event: {
          kind: 'dropped',
          playerId: player.id,
          siteId: null,
          position: { ...player.position },
          explodeAt: null,
        },
      });
      return;
    }

    const active = getActiveWeapon(player);
    if (active.id === 'knife') {
      return;
    }

    const slot = getWeapon(active.id).slot;
    if (slot === 'primary') {
      player.inventory.primary = null;
    } else if (slot === 'secondary') {
      player.inventory.secondary = null;
    } else if (slot === 'grenade') {
      if (isEconomyMode(this.mode)) {
        removeGrenade(player, active.id as GrenadeType);
      } else {
        player.inventory.grenade = null;
      }
    }
    cancelReload(player);
    if (player.activeSlot === slot && player.inventory[slot] === null) {
      player.activeSlot =
        player.inventory.primary !== null
          ? 'primary'
          : player.inventory.secondary !== null
            ? 'secondary'
            : player.inventory.grenade !== null
              ? 'grenade'
              : 'knife';
    }
    player.lastUseAt = now;
    this.createDroppedPickup(
      player,
      slot === 'grenade' ? { id: active.id, ammo: 1, reserve: 0 } : active,
      now,
    );
  }

  private tryPickup(player: PlayerState, now: number): void {
    if ((this.phase !== 'live' && this.phase !== 'round_over') || !player.alive) {
      return;
    }
    if (now - player.lastUseAt < this.config.useCooldownMs) {
      return;
    }

    if (this.tryPickupDroppedBomb(player, now)) {
      return;
    }

    const nearest = this.findNearestPickup(player, true, !isEconomyMode(this.mode), now);
    if (nearest === null) {
      return;
    }

    const result = addWeapon(player, nearest.weapon, nearest.ammo, nearest.reserve);
    if (!result.added) {
      return;
    }
    player.lastUseAt = now;
    this.consumePickup(nearest, now);

    const event: PickupEvent = {
      playerId: player.id,
      weapon: nearest.weapon,
      pickupId: nearest.id,
      replacedWeapon: result.replaced?.id ?? null,
    };
    this.events.push({ type: 'pickup', event });
  }

  private findNearestPickup(
    player: PlayerState,
    emptySlotOnly = false,
    spawnOnly = false,
    now = Number.POSITIVE_INFINITY,
  ): PickupState | null {
    let nearest: PickupState | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const pickup of this.pickups.values()) {
      if (!pickup.available || getWeapon(pickup.weapon).slot === 'knife') {
        continue;
      }
      if (spawnOnly && pickup.kind !== 'spawn') {
        continue;
      }
      if (emptySlotOnly && pickup.kind === 'dropped' && now - pickup.createdAt < 400) {
        continue;
      }
      const slot = getWeapon(pickup.weapon).slot;
      if (emptySlotOnly) {
        if (slot === 'grenade') {
          if (
            isEconomyMode(this.mode)
              ? !canAddGrenade(player, pickup.weapon as GrenadeType)
              : player.inventory.grenade !== null
          ) {
            continue;
          }
        } else if (player.inventory[slot] !== null) {
          continue;
        }
      }
      const currentDistance = distance(player.position, pickup.position);
      if (currentDistance > 1.6) {
        continue;
      }
      if (Math.abs(player.position.y - pickup.position.y) > 1.2) {
        continue;
      }
      if (currentDistance < nearestDistance) {
        nearest = pickup;
        nearestDistance = currentDistance;
      }
    }
    return nearest;
  }

  private consumePickup(pickup: PickupState, _now: number): void {
    if (pickup.kind === 'spawn') {
      pickup.available = false;
    } else {
      this.pickups.delete(pickup.id);
    }
  }

  private createDroppedPickup(
    player: PlayerState,
    weapon: WeaponInstance,
    now: number,
    offset: Vec3 = vec3(),
  ): PickupState {
    const dropped = [...this.pickups.values()]
      .filter((pickup) => pickup.kind === 'dropped')
      .sort((a, b) => a.createdAt - b.createdAt);
    const limit = Math.max(1, this.config.maxDroppedWeapons);
    while (dropped.length >= limit) {
      const oldest = dropped.shift();
      if (oldest !== undefined) {
        this.pickups.delete(oldest.id);
      }
    }

    const pickup: PickupState = {
      id: `drop:${randomUUID()}`,
      weapon: weapon.id,
      position: {
        x: player.position.x + offset.x,
        y: player.position.y + 0.9,
        z: player.position.z + offset.z,
      },
      kind: 'dropped',
      ammo: weapon.ammo,
      reserve: weapon.reserve,
      available: true,
      createdAt: now,
    };
    this.pickups.set(pickup.id, pickup);
    return pickup;
  }

  private resetArmorPickups(): void {
    this.armorPickups.clear();
    if (isEconomyMode(this.mode)) {
      return;
    }
    for (const spawn of this.map.armorSpawns) {
      this.armorPickups.set(spawn.id, {
        id: spawn.id,
        amount: spawn.amount,
        position: { ...spawn.position },
        available: true,
      });
    }
  }

  private resetPickups(now: number): void {
    this.pickups.clear();
    this.grenades.clear();
    this.areaEffects.length = 0;
    if (isEconomyMode(this.mode)) {
      return;
    }
    for (const spawn of this.map.weaponSpawns) {
      const definition = getWeapon(spawn.weapon);
      const pickup: PickupState = {
        id: `spawn:${spawn.id}`,
        weapon: spawn.weapon,
        position: { ...spawn.position },
        kind: 'spawn',
        ammo: definition.magazine,
        reserve: definition.reserve,
        available: true,
        createdAt: now,
      };
      this.pickups.set(pickup.id, pickup);
    }
  }

  private resetMatch(now: number): void {
    this.phase = 'lobby';
    this.round = 1;
    this.roundWins = emptyScores();
    this.countdownEndsAt = null;
    this.roundOverEndsAt = null;
    this.matchEndsAt = null;
    this.buyEndsAt = null;
    this.roundEndsAt = null;
    this.pausedBuyRemainingMs = null;
    this.pausedRoundRemainingMs = null;
    this.pausedBombRemainingMs = null;
    this.pauseDeadline = null;
    this.pauseStartedAt = null;
    this.remainingMatchMs = this.config.matchDurationMs;
    this.winnerId = null;
    this.roundWinnerTeam = null;
    this.roundEndReason = null;
    this.endReason = null;
    this.pendingMatchEnd = null;
    this.lastCountdownSecond = null;
    this.tickCount = 0;

    for (const player of this.players.values()) {
      player.kills = 0;
      player.deaths = 0;
      player.matchShots = 0;
      player.matchHits = 0;
      player.matchDamage = 0;
      player.matchHeadshots = 0;
      player.matchHeadshotKills = 0;
      player.rematchVote = false;
      player.side = player.team === 'alpha' ? 't' : 'ct';
      player.money = ECONOMY.startMoney;
      player.lossStreak = 0;
      player.helmet = false;
      player.defuseKit = false;
      player.grenadeCounts = {};
      this.spawnPlayerAtBase(player, now);
    }

    this.resetPickups(now);
    this.areaEffects.length = 0;
    this.resetArmorPickups();
    this.resetBomb();
  }

  private startNewMatch(now: number): void {
    if (this.players.size < this.maxPlayers) {
      this.phase = 'lobby';
      this.emitLobby();
      return;
    }
    this.resetMatch(now);
    this.startCountdown(now, false);
  }

  private startCountdown(now: number, resumed: boolean): void {
    if ((!resumed && this.players.size < this.maxPlayers) || (resumed && this.players.size < 2)) {
      this.phase = 'lobby';
      this.emitLobby();
      return;
    }

    this.phase = 'countdown';
    this.countdownEndsAt = now + this.config.countdownMs;
    this.roundOverEndsAt = null;
    this.matchEndsAt = null;
    this.buyEndsAt = isEconomyMode(this.mode)
      ? now + this.config.countdownMs + (this.pausedBuyRemainingMs ?? BUY.buyTimeMs)
      : null;
    this.pausedBuyRemainingMs = null;
    this.roundEndsAt = null;
    this.pauseDeadline = null;
    this.pauseStartedAt = null;
    this.lastCountdownSecond = null;
    if (!resumed) {
      this.winnerId = null;
      this.roundEndReason = null;
      this.endReason = null;
      this.remainingMatchMs = this.config.matchDurationMs;
      this.resetBomb();
    }
    for (const player of this.players.values()) {
      player.pendingFire = null;
      player.lastFireHeld = false;
    }

    this.emitLobby();
    this.emitCountdown(now, resumed);
  }

  private resumeFromPause(now: number): void {
    if (this.phase !== 'paused') {
      return;
    }

    const pausedDuration = this.pauseStartedAt === null ? 0 : now - this.pauseStartedAt;
    for (const player of this.players.values()) {
      if (player.respawnAt !== null) {
        player.respawnAt += pausedDuration;
      }
      if (player.reloadingUntil !== null) {
        player.reloadingUntil += pausedDuration;
      }
      if (player.blindUntil > 0) {
        player.blindUntil += pausedDuration;
      }
    }
    if (this.buyEndsAt !== null) {
      this.buyEndsAt += pausedDuration;
    }
    if (this.roundEndsAt !== null) {
      this.roundEndsAt += pausedDuration;
    }
    for (const zone of this.areaEffects) {
      zone.endAt += pausedDuration;
      zone.nextTickAt += pausedDuration;
    }

    this.pauseStartedAt = null;
    this.startCountdown(now, true);
  }

  private emitCountdown(now: number, resumed: boolean): void {
    if (this.countdownEndsAt === null) {
      return;
    }
    const seconds = Math.max(1, Math.ceil((this.countdownEndsAt - now) / 1000));
    if (seconds === this.lastCountdownSecond) {
      return;
    }
    this.lastCountdownSecond = seconds;
    const state: CountdownState = {
      endsAt: this.countdownEndsAt,
      seconds,
      round: this.round,
      resumed,
    };
    this.events.push({ type: 'countdown', state });
  }

  private handleTimeouts(now: number): void {
    if (this.phase === 'paused' && this.pauseDeadline !== null && now >= this.pauseDeadline) {
      const connected = this.getPlayers().filter((player) => player.connected);
      const disconnected = this.getPlayers().filter((player) => !player.connected);

      for (const player of disconnected) {
        this.players.delete(player.id);
      }

      const connectedAlpha = connected.filter((p) => p.team === 'alpha');
      const connectedBravo = connected.filter((p) => p.team === 'bravo');

      if (connectedAlpha.length === 0 && connectedBravo.length > 0) {
        this.endMatch(connectedBravo[0]?.id ?? null, 'abandon', now);
        this.emitLobby();
      } else if (connectedBravo.length === 0 && connectedAlpha.length > 0) {
        this.endMatch(connectedAlpha[0]?.id ?? null, 'abandon', now);
        this.emitLobby();
      } else if (connectedAlpha.length === 0 && connectedBravo.length === 0) {
        this.players.clear();
        this.resetToLobby(now);
      } else {
        this.resumeFromPause(now);
      }
      return;
    }

    if (this.phase === 'lobby') {
      let removed = false;
      for (const player of this.getPlayers()) {
        if (
          !player.connected &&
          player.disconnectedAt !== null &&
          now - player.disconnectedAt >= this.config.reconnectWindowMs
        ) {
          this.players.delete(player.id);
          removed = true;
        }
      }
      if (removed) {
        if (this.players.size === 0) {
          this.resetToLobby(now);
        } else {
          this.emitLobby();
        }
      }
    }
  }

  private endMatch(winnerId: string | null, reason: MatchEndReason, _now: number): void {
    if (this.phase === 'ended') {
      return;
    }

    this.phase = 'ended';
    this.countdownEndsAt = null;
    this.roundOverEndsAt = null;
    this.matchEndsAt = null;
    this.buyEndsAt = null;
    this.roundEndsAt = null;
    this.pausedBuyRemainingMs = null;
    this.pausedRoundRemainingMs = null;
    this.pauseDeadline = null;
    this.pauseStartedAt = null;
    this.lastCountdownSecond = null;
    this.winnerId = winnerId;
    this.endReason = reason;
    this.pendingMatchEnd = null;

    for (const player of this.players.values()) {
      player.velocity = vec3();
      cancelReload(player);
      player.rematchVote = false;
    }

    const winner = winnerId === null ? undefined : this.players.get(winnerId);
    const event: RoundEndEvent = {
      winnerId,
      winnerName: winner?.name ?? null,
      scores: this.getScores(),
      reason,
    };
    this.events.push({ type: 'round_end', event });
    this.emitLobby();
  }

  private removePlayer(playerId: string, now: number, endMatchIfNeeded: boolean): void {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return;
    }

    this.players.delete(playerId);

    if (
      endMatchIfNeeded &&
      (this.phase === 'live' ||
        this.phase === 'countdown' ||
        this.phase === 'round_over' ||
        this.phase === 'paused')
    ) {
      const opponent = this.findConnectedOpponent(player);
      if (opponent !== null) {
        this.endMatch(opponent.id, 'abandon', now);
      } else {
        this.resetToLobby(now);
      }
      return;
    }

    if (this.players.size === 0) {
      this.resetToLobby(now);
      return;
    }

    if (this.phase === 'ended' && this.players.size < 2) {
      this.resetToLobby(now);
      return;
    }

    this.emitLobby();
  }

  private resetToLobby(now: number): void {
    this.phase = 'lobby';
    this.round = 1;
    this.roundWins = emptyScores();
    this.countdownEndsAt = null;
    this.roundOverEndsAt = null;
    this.matchEndsAt = null;
    this.buyEndsAt = null;
    this.roundEndsAt = null;
    this.pausedBuyRemainingMs = null;
    this.pausedRoundRemainingMs = null;
    this.pausedBombRemainingMs = null;
    this.pauseDeadline = null;
    this.pauseStartedAt = null;
    this.remainingMatchMs = this.config.matchDurationMs;
    this.winnerId = null;
    this.roundWinnerTeam = null;
    this.roundEndReason = null;
    this.endReason = null;
    this.pendingMatchEnd = null;
    this.lastCountdownSecond = null;
    this.tickCount = 0;

    for (const player of this.players.values()) {
      player.kills = 0;
      player.deaths = 0;
      player.matchShots = 0;
      player.matchHits = 0;
      player.matchDamage = 0;
      player.matchHeadshots = 0;
      player.matchHeadshotKills = 0;
      player.rematchVote = false;
      player.side = player.team === 'alpha' ? 't' : 'ct';
      player.money = ECONOMY.startMoney;
      player.lossStreak = 0;
      player.helmet = false;
      player.defuseKit = false;
      player.grenadeCounts = {};
      player.alive = true;
      this.spawnPlayerAtBase(player, now);
    }

    this.resetPickups(now);
    this.areaEffects.length = 0;
    this.resetArmorPickups();
    this.resetBomb();
    this.emitLobby();
  }

  private resetBomb(): void {
    this.pausedBombRemainingMs = null;
    if (!isEconomyMode(this.mode)) {
      this.bomb = null;
      return;
    }
    const ordered = this.getOrderedPlayers();
    const carrier =
      ordered.find((player) => player.side === 't' && player.alive) ??
      ordered.find((player) => player.side === 't') ??
      null;
    const tSpawn = getSpawnsForTeam(this.map, 'alpha')[0]?.position ?? vec3();
    this.bomb = {
      state: carrier !== null ? 'carried' : 'dropped',
      carrierId: carrier?.id ?? null,
      position: carrier !== null ? null : { ...tSpawn },
      siteId: null,
      plantedAt: null,
      explodeAt: null,
      planterId: null,
      plantStartedAt: null,
      plantEndsAt: null,
      defuserId: null,
      defuseStartedAt: null,
      defuseEndsAt: null,
      defuseHasKit: false,
    };
  }

  private isPlantingOrDefusing(player: PlayerState): boolean {
    if (this.bomb === null) {
      return false;
    }
    const planting =
      this.bomb.state === 'carried' &&
      this.bomb.planterId === player.id &&
      this.bomb.plantStartedAt !== null;
    const defusing =
      this.bomb.state === 'planted' &&
      this.bomb.defuserId === player.id &&
      this.bomb.defuseStartedAt !== null;
    return planting || defusing;
  }

  private canStartPlant(player: PlayerState): boolean {
    if (
      this.phase !== 'live' ||
      !isEconomyMode(this.mode) ||
      this.bomb === null ||
      this.bomb.state !== 'carried' ||
      this.bomb.carrierId !== player.id ||
      !player.alive ||
      player.side !== 't' ||
      !player.grounded
    ) {
      return false;
    }
    return findBombSiteAt(this.map, player.position) !== null;
  }

  private canStartDefuse(player: PlayerState): boolean {
    if (
      this.phase !== 'live' ||
      !isEconomyMode(this.mode) ||
      this.bomb === null ||
      this.bomb.state !== 'planted' ||
      this.bomb.position === null ||
      !player.alive ||
      player.side !== 'ct' ||
      !player.grounded
    ) {
      return false;
    }
    if (this.bomb.defuserId !== null && this.bomb.defuserId !== player.id) {
      return false;
    }
    return (
      distance(player.position, this.bomb.position) <= BOMB.defuseRadius &&
      Math.abs(player.position.y - this.bomb.position.y) <= 1.5
    );
  }

  private canStartBombAction(player: PlayerState): boolean {
    return this.canStartPlant(player) || this.canStartDefuse(player);
  }

  private cancelPlant(now: number): void {
    if (
      this.bomb === null ||
      this.bomb.state !== 'carried' ||
      this.bomb.planterId === null ||
      this.bomb.plantStartedAt === null
    ) {
      return;
    }
    const planterId = this.bomb.planterId;
    const planter = this.players.get(planterId);
    const siteId = this.bomb.siteId;
    this.bomb.planterId = null;
    this.bomb.plantStartedAt = null;
    this.bomb.plantEndsAt = null;
    this.bomb.siteId = null;
    this.events.push({
      type: 'bomb_event',
      event: {
        kind: 'plant_cancelled',
        playerId: planterId,
        siteId,
        position: planter !== undefined ? { ...planter.position } : vec3(),
        explodeAt: null,
      },
    });
    void now;
  }

  private cancelDefuse(now: number): void {
    if (this.bomb === null || this.bomb.defuserId === null) {
      return;
    }
    const defuserId = this.bomb.defuserId;
    this.bomb.defuserId = null;
    this.bomb.defuseStartedAt = null;
    this.bomb.defuseEndsAt = null;
    this.bomb.defuseHasKit = false;
    this.events.push({
      type: 'bomb_event',
      event: {
        kind: 'defuse_cancelled',
        playerId: defuserId,
        siteId: this.bomb.siteId,
        position: this.bomb.position !== null ? { ...this.bomb.position } : vec3(),
        explodeAt: this.bomb.explodeAt,
      },
    });
    void now;
  }

  private updatePlayerBombInteraction(player: PlayerState, input: InputFrame, now: number): void {
    if (this.bomb === null || !isEconomyMode(this.mode) || this.phase !== 'live') {
      return;
    }
    const holdingUse = input.useHeld === true;

    if (
      this.bomb.state === 'carried' &&
      this.bomb.planterId === player.id &&
      this.bomb.plantStartedAt !== null
    ) {
      if (!holdingUse || !this.canStartPlant(player)) {
        this.cancelPlant(now);
      }
      return;
    }

    if (
      this.bomb.state === 'planted' &&
      this.bomb.defuserId === player.id &&
      this.bomb.defuseStartedAt !== null
    ) {
      if (!holdingUse || !this.canStartDefuse(player)) {
        this.cancelDefuse(now);
      }
      return;
    }

    if (!holdingUse) {
      return;
    }

    if (this.canStartPlant(player)) {
      const site = findBombSiteAt(this.map, player.position);
      if (site !== null) {
        this.bomb.planterId = player.id;
        this.bomb.siteId = site.id;
        this.bomb.plantStartedAt = now;
        this.bomb.plantEndsAt = now + BOMB.plantTimeMs;
        player.velocity.x = 0;
        player.velocity.z = 0;
        cancelReload(player);
        this.events.push({
          type: 'bomb_event',
          event: {
            kind: 'plant_started',
            playerId: player.id,
            siteId: site.id,
            position: { ...player.position },
            explodeAt: null,
          },
        });
      }
      return;
    }

    if (this.canStartDefuse(player) && this.bomb.defuserId === null) {
      const duration = player.defuseKit ? BOMB.defuseKitTimeMs : BOMB.defuseTimeMs;
      this.bomb.defuserId = player.id;
      this.bomb.defuseStartedAt = now;
      this.bomb.defuseEndsAt = now + duration;
      this.bomb.defuseHasKit = player.defuseKit;
      player.velocity.x = 0;
      player.velocity.z = 0;
      cancelReload(player);
      this.events.push({
        type: 'bomb_event',
        event: {
          kind: 'defuse_started',
          playerId: player.id,
          siteId: this.bomb.siteId,
          position:
            this.bomb.position !== null ? { ...this.bomb.position } : { ...player.position },
          explodeAt: this.bomb.explodeAt,
          hasKit: player.defuseKit,
        },
      });
    }
  }

  private validatePlayerBombInteractionAfterMove(
    player: PlayerState,
    input: InputFrame,
    now: number,
  ): void {
    if (this.bomb === null) {
      return;
    }
    const holdingUse = input.useHeld === true;
    if (
      this.bomb.state === 'carried' &&
      this.bomb.planterId === player.id &&
      (!holdingUse || !this.canStartPlant(player))
    ) {
      this.cancelPlant(now);
    }
    if (
      this.bomb.state === 'planted' &&
      this.bomb.defuserId === player.id &&
      (!holdingUse || !this.canStartDefuse(player))
    ) {
      this.cancelDefuse(now);
    }
  }

  private tryPickupDroppedBomb(player: PlayerState, now: number): boolean {
    if (
      !isEconomyMode(this.mode) ||
      this.bomb === null ||
      this.bomb.state !== 'dropped' ||
      this.bomb.position === null ||
      !player.alive ||
      player.side !== 't'
    ) {
      return false;
    }
    if (
      distance(player.position, this.bomb.position) > BOMB.pickupRadius ||
      Math.abs(player.position.y - this.bomb.position.y) > 1.2
    ) {
      return false;
    }
    this.bomb.state = 'carried';
    this.bomb.carrierId = player.id;
    this.bomb.position = null;
    player.lastUseAt = now;
    this.events.push({
      type: 'bomb_event',
      event: {
        kind: 'picked_up',
        playerId: player.id,
        siteId: null,
        position: { ...player.position },
        explodeAt: null,
      },
    });
    return true;
  }

  private updateBomb(now: number): void {
    if (this.bomb === null || !isEconomyMode(this.mode) || this.phase !== 'live') {
      return;
    }

    if (
      this.bomb.state === 'carried' &&
      this.bomb.planterId !== null &&
      this.bomb.plantStartedAt !== null
    ) {
      const planter = this.players.get(this.bomb.planterId);
      if (
        planter === undefined ||
        !planter.connected ||
        !planter.alive ||
        !this.canStartPlant(planter)
      ) {
        this.cancelPlant(now);
      } else if (this.bomb.plantEndsAt !== null && now >= this.bomb.plantEndsAt) {
        const site = findBombSiteAt(this.map, planter.position);
        const siteId = site?.id ?? this.bomb.siteId ?? 'A';
        const plantPos = { ...planter.position };
        this.bomb.state = 'planted';
        this.bomb.carrierId = null;
        this.bomb.position = plantPos;
        this.bomb.siteId = siteId;
        this.bomb.plantedAt = now;
        this.bomb.explodeAt = now + BOMB.fuseTimeMs;
        this.bomb.planterId = planter.id;
        this.bomb.plantStartedAt = null;
        this.bomb.plantEndsAt = null;
        this.awardMoney(planter, ECONOMY.plantReward);
        this.events.push({
          type: 'bomb_event',
          event: {
            kind: 'planted',
            playerId: planter.id,
            siteId,
            position: { ...plantPos },
            explodeAt: this.bomb.explodeAt,
          },
        });
      }
    }

    if (this.bomb.state !== 'planted') {
      return;
    }

    if (this.bomb.defuserId !== null) {
      const defuser = this.players.get(this.bomb.defuserId);
      if (
        defuser === undefined ||
        !defuser.connected ||
        !defuser.alive ||
        !this.canStartDefuse(defuser)
      ) {
        this.cancelDefuse(now);
      } else if (
        this.bomb.defuseEndsAt !== null &&
        now >= this.bomb.defuseEndsAt &&
        (this.bomb.explodeAt === null || this.bomb.defuseEndsAt <= this.bomb.explodeAt)
      ) {
        const defusePos =
          this.bomb.position !== null ? { ...this.bomb.position } : { ...defuser.position };
        this.bomb.state = 'defused';
        this.bomb.defuseStartedAt = null;
        this.bomb.defuseEndsAt = null;
        this.awardMoney(defuser, ECONOMY.defuseReward);
        this.events.push({
          type: 'bomb_event',
          event: {
            kind: 'defused',
            playerId: defuser.id,
            siteId: this.bomb.siteId,
            position: defusePos,
            explodeAt: null,
          },
        });
        this.resolveRound(this.getTeamForSide('ct'), 'defuse', now);
        return;
      }
    }

    if (this.bomb.explodeAt !== null && now >= this.bomb.explodeAt) {
      if (this.bomb.defuserId !== null) {
        this.bomb.defuserId = null;
        this.bomb.defuseStartedAt = null;
        this.bomb.defuseEndsAt = null;
      }
      this.explodeBomb(now);
    }
  }

  private explodeBomb(now: number): void {
    if (this.bomb === null) {
      return;
    }
    this.bomb.state = 'exploded';
    const bombPos = this.bomb.position !== null ? { ...this.bomb.position } : vec3();
    const planter =
      this.bomb.planterId !== null ? (this.players.get(this.bomb.planterId) ?? null) : null;

    this.events.push({
      type: 'bomb_event',
      event: {
        kind: 'exploded',
        playerId: this.bomb.planterId,
        siteId: this.bomb.siteId,
        position: { ...bombPos },
        explodeAt: null,
      },
    });

    for (const victim of this.getOrderedPlayers()) {
      if (!victim.alive) {
        continue;
      }
      const center: Vec3 = {
        x: victim.position.x,
        y: victim.position.y + (victim.crouching ? 0.6 : 0.9),
        z: victim.position.z,
      };
      const dist = distance(bombPos, center);
      if (dist > BOMB.explosionRadius) {
        continue;
      }
      const falloff = Math.max(BOMB.minDamageFraction, 1 - dist / BOMB.explosionRadius);
      const result = applyDamage(
        victim,
        planter,
        BOMB.explosionDamage * falloff,
        'body',
        now,
        this.config.respawnMs,
        {
          armorRatio: 0.75,
          allowSelf: true,
          allowTeam: true,
        },
      );
      if (result.damage <= 0 && !result.killed) {
        continue;
      }
      const hitEvent: HitEvent = {
        shooterId: planter?.id ?? victim.id,
        victimId: victim.id,
        damage: result.damage,
        headshot: false,
        zone: 'body',
        healthAfter: result.healthAfter,
        armorAfter: result.armorAfter,
        hitPoint: { ...center },
        sourcePosition: { ...bombPos },
        source: 'bomb',
      };
      this.events.push({ type: 'hit', event: hitEvent });
      if (result.killed) {
        victim.deaths += 1;
        this.dropInventoryOnDeath(victim, now);
        const killEvent: KillEvent = {
          killerId: planter?.id ?? victim.id,
          killerName: 'C4',
          victimId: victim.id,
          victimName: victim.name,
          weapon: 'c4',
          headshot: false,
          at: now,
        };
        this.events.push({ type: 'kill', event: killEvent });
        this.events.push({
          type: 'score_update',
          event: {
            scores: this.getScores(),
            killerId: planter?.id ?? victim.id,
            victimId: victim.id,
            killerKills: planter?.kills ?? 0,
            victimDeaths: victim.deaths,
          },
        });
      }
    }

    this.resolveRound(this.getTeamForSide('t'), 'bomb', now);
  }

  private toBombSnapshot(now: number): BombSnapshot | null {
    if (this.bomb === null) {
      return null;
    }
    const carrier =
      this.bomb.carrierId !== null ? (this.players.get(this.bomb.carrierId) ?? null) : null;
    const position =
      this.bomb.state === 'carried' && carrier !== null
        ? { ...carrier.position }
        : this.bomb.position !== null
          ? { ...this.bomb.position }
          : null;
    const plantProgress =
      this.bomb.plantStartedAt !== null && this.bomb.plantEndsAt !== null
        ? clamp(
            (now - this.bomb.plantStartedAt) /
              Math.max(1, this.bomb.plantEndsAt - this.bomb.plantStartedAt),
            0,
            1,
          )
        : 0;
    const defuseProgress =
      this.bomb.defuseStartedAt !== null && this.bomb.defuseEndsAt !== null
        ? clamp(
            (now - this.bomb.defuseStartedAt) /
              Math.max(1, this.bomb.defuseEndsAt - this.bomb.defuseStartedAt),
            0,
            1,
          )
        : 0;
    const explodeAt =
      this.bomb.explodeAt ??
      (this.pausedBombRemainingMs !== null ? now + this.pausedBombRemainingMs : null);

    return {
      state: this.bomb.state,
      carrierId: this.bomb.carrierId,
      position,
      siteId: this.bomb.siteId,
      plantedAt: this.bomb.plantedAt,
      explodeAt,
      planterId: this.bomb.planterId,
      defuserId: this.bomb.defuserId,
      defuseHasKit: this.bomb.defuseHasKit,
      plantProgress,
      defuseProgress,
    };
  }

  private emitLobby(): void {
    this.events.push({ type: 'lobby', state: this.getLobbyState() });
  }

  private toLobbyPlayer(player: PlayerState): LobbyPlayer {
    return {
      id: player.id,
      name: player.name,
      team: player.team,
      side: player.side,
      connected: player.connected,
      kills: player.kills,
      money: player.money,
      deaths: player.deaths,
      rematchVote: player.rematchVote,
      ready: player.ready,
    };
  }

  private toPlayerSnapshot(player: PlayerState): PlayerSnapshot {
    const weapon = getActiveWeapon(player);
    return {
      id: player.id,
      name: player.name,
      team: player.team,
      side: player.side,
      position: { ...player.position },
      yaw: player.yaw,
      pitch: player.pitch,
      health: player.health,
      armor: player.armor,
      helmet: player.helmet,
      defuseKit: player.defuseKit,
      money: player.money,
      grenades: { ...player.grenadeCounts },
      lastPurchaseId: player.purchases[player.purchases.length - 1]?.itemId ?? null,
      blindUntil: player.blindUntil,
      alive: player.alive,
      crouching: player.crouching,
      walking: player.walking,
      scoped: player.scoped,
      activeSlot: player.activeSlot,
      activeWeapon: weapon.id,
      ammo: weapon.ammo,
      reserve: weapon.reserve,
      reloadingUntil: player.reloadingUntil,
      respawnAt: player.respawnAt,
      kills: player.kills,
      deaths: player.deaths,
      connected: player.connected,
      ready: player.ready,
    };
  }

  private toGrenadeSnapshot(grenade: GrenadeState): GrenadeSnapshot {
    return {
      id: grenade.id,
      ownerId: grenade.ownerId,
      type: grenade.type,
      position: { ...grenade.position },
      fuseAt: grenade.fuseAt,
    };
  }

  private toPickupSnapshot(pickup: PickupState): PickupSnapshot {
    return {
      id: pickup.id,
      weapon: pickup.weapon,
      position: { ...pickup.position },
      kind: pickup.kind,
    };
  }

  private toArmorPickupSnapshot(pickup: ArmorPickupState): {
    id: string;
    amount: number;
    position: Vec3;
  } {
    return {
      id: pickup.id,
      amount: pickup.amount,
      position: { ...pickup.position },
    };
  }
}
