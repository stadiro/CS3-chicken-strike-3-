import { describe, expect, it } from 'vitest';
import {
  BOMB_CAM_DISTANCE,
  chooseSpectatorView,
  computeBombCamera,
  cycleSpectatorTarget,
  SPECTATE_DELAY_MS,
  SPECTATE_FADE_IN_MS,
  SPECTATE_FADE_OUT_MS,
  spectatorFadeAlpha,
  spectatorSubjectKey,
  type SpectatorView,
} from '../client/src/game/spectator';
import type { MapBox } from '../shared/map';
import type { BombSnapshot, PlayerSnapshot } from '../shared/protocol';

function player(id: string, overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id,
    name: id,
    team: 'alpha',
    side: 't',
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: 100,
    armor: 0,
    helmet: false,
    defuseKit: false,
    money: 800,
    grenades: {},
    lastPurchaseId: null,
    blindUntil: 0,
    alive: true,
    crouching: false,
    walking: false,
    scoped: false,
    activeSlot: 'secondary',
    activeWeapon: 'glock',
    ammo: 20,
    reserve: 120,
    reloadingUntil: null,
    respawnAt: null,
    kills: 0,
    deaths: 0,
    connected: true,
    ...overrides,
  };
}

function bomb(state: BombSnapshot['state']): BombSnapshot {
  return {
    state,
    carrierId: null,
    position: { x: 5, y: 0, z: 5 },
    siteId: 'A',
    plantedAt: 0,
    explodeAt: 40_000,
    planterId: 'me',
    defuserId: null,
    defuseHasKit: false,
    plantProgress: 1,
    defuseProgress: 0,
  };
}

const deadMe = player('me', { alive: false });
const enemy = player('enemy', { team: 'bravo', side: 'ct' });

function choose(
  players: PlayerSnapshot[],
  current: SpectatorView,
  currentSinceMs: number,
  bombState: BombSnapshot | null = null,
): SpectatorView | null {
  return chooseSpectatorView({ players, localId: 'me', bomb: bombState, current, currentSinceMs });
}

describe('spectator view selection', () => {
  it('returns null while the local player is alive', () => {
    expect(choose([player('me'), enemy], { kind: 'self' }, 5_000)).toBeNull();
  });

  it('holds on the own body for the first second after death', () => {
    const mate = player('mate');
    expect(choose([deadMe, mate, enemy], { kind: 'self' }, SPECTATE_DELAY_MS - 1)).toEqual({
      kind: 'self',
    });
  });

  it('switches to an alive teammate after the delay, never to an enemy', () => {
    const deadMate = player('dead-mate', { alive: false });
    const mate = player('mate');
    expect(choose([deadMe, deadMate, enemy, mate], { kind: 'self' }, SPECTATE_DELAY_MS)).toEqual({
      kind: 'player',
      playerId: 'mate',
    });
  });

  it('shows the planted bomb when T has no alive teammates', () => {
    expect(choose([deadMe, enemy], { kind: 'self' }, SPECTATE_DELAY_MS, bomb('planted'))).toEqual({
      kind: 'bomb',
    });
  });

  it('prefers an alive teammate over the bomb', () => {
    const mate = player('mate');
    expect(
      choose([deadMe, mate, enemy], { kind: 'self' }, SPECTATE_DELAY_MS, bomb('planted')),
    ).toEqual({ kind: 'player', playerId: 'mate' });
  });

  it('does not show the bomb camera to a dead CT', () => {
    const deadCt = player('me', { alive: false, team: 'bravo', side: 'ct' });
    const t = player('t', { team: 'alpha', side: 't' });
    expect(choose([deadCt, t], { kind: 'self' }, SPECTATE_DELAY_MS, bomb('planted'))).toEqual({
      kind: 'self',
    });
  });

  it('stays on the own body when nobody is left and no bomb is planted', () => {
    expect(choose([deadMe, enemy], { kind: 'self' }, 10_000, bomb('carried'))).toEqual({
      kind: 'self',
    });
  });

  it('holds on a spectated teammate corpse, then moves on', () => {
    const deadMate = player('mate', { alive: false });
    const other = player('other');
    const current: SpectatorView = { kind: 'player', playerId: 'mate' };
    const corpse = choose([deadMe, deadMate, other], current, 3_000);
    expect(corpse).toEqual({ kind: 'corpse', playerId: 'mate' });
    expect(choose([deadMe, deadMate, other], corpse!, SPECTATE_DELAY_MS - 1)).toEqual(corpse);
    expect(choose([deadMe, deadMate, other], corpse!, SPECTATE_DELAY_MS)).toEqual({
      kind: 'player',
      playerId: 'other',
    });
  });

  it('keeps watching the bomb after it explodes until the round resets', () => {
    expect(choose([deadMe, enemy], { kind: 'bomb' }, 500, bomb('exploded'))).toEqual({
      kind: 'bomb',
    });
  });

  it('treats a teammate and their corpse as the same camera subject', () => {
    expect(spectatorSubjectKey({ kind: 'player', playerId: 'a' }, 'me')).toBe(
      spectatorSubjectKey({ kind: 'corpse', playerId: 'a' }, 'me'),
    );
    expect(spectatorSubjectKey({ kind: 'self' }, 'me')).not.toBe(
      spectatorSubjectKey({ kind: 'bomb' }, 'me'),
    );
  });
});

describe('spectator cycling', () => {
  const players = [deadMe, player('a'), enemy, player('b', { alive: false }), player('c')];

  it('cycles forward and backward through alive teammates only', () => {
    expect(cycleSpectatorTarget(players, 'me', 'a', 1)).toBe('c');
    expect(cycleSpectatorTarget(players, 'me', 'c', 1)).toBe('a');
    expect(cycleSpectatorTarget(players, 'me', 'a', -1)).toBe('c');
    expect(cycleSpectatorTarget(players, 'me', null, 1)).toBe('a');
    expect(cycleSpectatorTarget(players, 'me', null, -1)).toBe('c');
  });

  it('returns null without alive teammates (1v1)', () => {
    expect(cycleSpectatorTarget([deadMe, enemy], 'me', null, 1)).toBeNull();
  });
});

describe('spectator fade', () => {
  it('fades to black, then back in', () => {
    expect(spectatorFadeAlpha(0)).toBe(0);
    expect(spectatorFadeAlpha(SPECTATE_FADE_OUT_MS)).toBeCloseTo(1);
    expect(spectatorFadeAlpha(SPECTATE_FADE_OUT_MS + SPECTATE_FADE_IN_MS / 2)).toBeCloseTo(0.5);
    expect(spectatorFadeAlpha(SPECTATE_FADE_OUT_MS + SPECTATE_FADE_IN_MS)).toBe(0);
  });
});

describe('bomb camera', () => {
  it('orbits above the bomb at full distance in the open', () => {
    const cam = computeBombCamera({ x: 0, y: 0, z: 0 }, 0, 0.9, []);
    expect(cam.position.y).toBeGreaterThan(cam.target.y + 2);
    const dist = Math.hypot(
      cam.position.x - cam.target.x,
      cam.position.y - cam.target.y,
      cam.position.z - cam.target.z,
    );
    expect(dist).toBeCloseTo(BOMB_CAM_DISTANCE);
    // yaw 0 looks toward -Z, so the camera sits on +Z.
    expect(cam.position.z).toBeGreaterThan(0);
  });

  it('pulls in when a roof blocks the view', () => {
    const roof: MapBox = {
      id: 'roof',
      min: { x: -5, y: 2, z: -5 },
      max: { x: 5, y: 2.5, z: 5 },
      color: '#000',
      kind: 'roof',
    };
    const cam = computeBombCamera({ x: 0, y: 0, z: 0 }, 0, 0.9, [roof]);
    expect(cam.position.y).toBeLessThan(2);
  });
});
