import type { MapBox } from '../../../shared/map';
import { clamp, type Vec3 } from '../../../shared/math';
import type { BombSnapshot, PlayerSnapshot } from '../../../shared/protocol';

/**
 * CS2-style spectator logic for economy rounds (no mid-round respawn).
 *
 * Flow after the local player dies:
 * 1. `self`   — camera hangs over the own body for SPECTATE_DELAY_MS.
 * 2. `player` — first-person view of an alive teammate (LMB/RMB cycles).
 * 3. `bomb`   — no alive teammates, local player is T and the bomb is planted:
 *               orbit camera above the bomb.
 * 4. otherwise the camera stays on the own body / last spectated corpse until
 *    the round ends.
 *
 * Kept free of three.js and DOM so it can be unit tested.
 */

export const SPECTATE_DELAY_MS = 1_000;
export const SPECTATE_FADE_OUT_MS = 260;
export const SPECTATE_FADE_IN_MS = 420;

export const BOMB_CAM_DISTANCE = 5.2;
export const BOMB_CAM_DEFAULT_ELEVATION = 0.95;
export const BOMB_CAM_MIN_ELEVATION = 0.35;
export const BOMB_CAM_MAX_ELEVATION = 1.45;
const BOMB_CAM_TARGET_LIFT = 0.25;
const BOMB_CAM_MIN_DISTANCE = 1.2;
const BOMB_CAM_WALL_PADDING = 0.25;

export type SpectatorView =
  | { kind: 'self' }
  | { kind: 'player'; playerId: string }
  | { kind: 'corpse'; playerId: string }
  | { kind: 'bomb' };

export interface SpectatorContext {
  players: readonly PlayerSnapshot[];
  localId: string;
  bomb: BombSnapshot | null;
  current: SpectatorView;
  /** Time spent in `current`, used for the 1 s hold on a fresh corpse. */
  currentSinceMs: number;
}

/** Stable identity of what the camera looks at. A change triggers a fade. */
export function spectatorSubjectKey(view: SpectatorView, localId: string): string {
  switch (view.kind) {
    case 'self':
      return `p:${localId}`;
    case 'bomb':
      return 'bomb';
    case 'player':
    case 'corpse':
      return `p:${view.playerId}`;
  }
}

export function aliveTeammates(
  players: readonly PlayerSnapshot[],
  localId: string,
): PlayerSnapshot[] {
  const local = players.find((player) => player.id === localId);
  if (local === undefined) {
    return [];
  }
  return players.filter(
    (player) =>
      player.id !== localId && player.team === local.team && player.alive && player.connected,
  );
}

function bombCamAvailable(local: PlayerSnapshot, bomb: BombSnapshot | null): boolean {
  return local.side === 't' && bomb !== null && bomb.state === 'planted' && bomb.position !== null;
}

/**
 * Picks the next spectator view. Returns null while the local player is alive
 * (or missing), meaning the regular first-person camera should be used.
 */
export function chooseSpectatorView(context: SpectatorContext): SpectatorView | null {
  const { players, localId, bomb, current, currentSinceMs } = context;
  const local = players.find((player) => player.id === localId);
  if (local === undefined || local.alive) {
    return null;
  }

  if (current.kind === 'player') {
    const target = players.find((player) => player.id === current.playerId);
    if (target !== undefined && target.alive && target.connected && target.team === local.team) {
      return current;
    }
    // The spectated teammate just died: hold on the body first, like CS2.
    return { kind: 'corpse', playerId: current.playerId };
  }

  if ((current.kind === 'self' || current.kind === 'corpse') && currentSinceMs < SPECTATE_DELAY_MS) {
    return current;
  }

  const mates = aliveTeammates(players, localId);
  const firstMate = mates[0];
  if (firstMate !== undefined) {
    return { kind: 'player', playerId: firstMate.id };
  }

  if (current.kind === 'bomb') {
    return bomb !== null && bomb.position !== null ? current : { kind: 'self' };
  }
  if (bombCamAvailable(local, bomb)) {
    return { kind: 'bomb' };
  }
  return current;
}

/** Next/previous alive teammate for LMB/RMB cycling, or null if none. */
export function cycleSpectatorTarget(
  players: readonly PlayerSnapshot[],
  localId: string,
  currentId: string | null,
  direction: 1 | -1,
): string | null {
  const mates = aliveTeammates(players, localId);
  if (mates.length === 0) {
    return null;
  }
  const index = currentId === null ? -1 : mates.findIndex((player) => player.id === currentId);
  if (index < 0) {
    return mates[direction === 1 ? 0 : mates.length - 1]?.id ?? null;
  }
  const next = (index + direction + mates.length) % mates.length;
  return mates[next]?.id ?? null;
}

/** Fade overlay opacity for a transition that started `elapsedMs` ago. */
export function spectatorFadeAlpha(elapsedMs: number): number {
  if (elapsedMs < 0) {
    return 0;
  }
  if (elapsedMs < SPECTATE_FADE_OUT_MS) {
    return elapsedMs / SPECTATE_FADE_OUT_MS;
  }
  const inElapsed = elapsedMs - SPECTATE_FADE_OUT_MS;
  return clamp(1 - inElapsed / SPECTATE_FADE_IN_MS, 0, 1);
}

/**
 * Returns the parameter t in [0, 1] where the segment first enters the box, or
 * null when it misses. Segments starting inside a box are ignored.
 */
function segmentBoxEntry(from: Vec3, to: Vec3, box: MapBox): number | null {
  let tMin = 0;
  let tMax = 1;
  const axes = ['x', 'y', 'z'] as const;
  for (const axis of axes) {
    const origin = from[axis];
    const delta = to[axis] - origin;
    const min = box.min[axis];
    const max = box.max[axis];
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) {
        return null;
      }
      continue;
    }
    let t0 = (min - origin) / delta;
    let t1 = (max - origin) / delta;
    if (t0 > t1) {
      [t0, t1] = [t1, t0];
    }
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) {
      return null;
    }
  }
  return tMin > 0 ? tMin : null;
}

export interface BombCamera {
  position: Vec3;
  target: Vec3;
}

/**
 * Orbit camera above the planted bomb. The camera is pulled in when map
 * geometry would block the line of sight to the bomb.
 */
export function computeBombCamera(
  bomb: Vec3,
  yaw: number,
  elevation: number,
  boxes: readonly MapBox[],
): BombCamera {
  const pitch = clamp(elevation, BOMB_CAM_MIN_ELEVATION, BOMB_CAM_MAX_ELEVATION);
  const target: Vec3 = { x: bomb.x, y: bomb.y + BOMB_CAM_TARGET_LIFT, z: bomb.z };
  const horizontal = Math.cos(pitch) * BOMB_CAM_DISTANCE;
  // Matches the camera convention: yaw 0 looks toward -Z, so the camera sits on +Z.
  const desired: Vec3 = {
    x: target.x + Math.sin(yaw) * horizontal,
    y: target.y + Math.sin(pitch) * BOMB_CAM_DISTANCE,
    z: target.z + Math.cos(yaw) * horizontal,
  };

  let nearest = 1;
  for (const box of boxes) {
    if (box.kind === 'ladder') {
      continue;
    }
    const hit = segmentBoxEntry(target, desired, box);
    if (hit !== null && hit < nearest) {
      nearest = hit;
    }
  }

  let distance =
    nearest < 1
      ? Math.max(BOMB_CAM_MIN_DISTANCE, BOMB_CAM_DISTANCE * nearest - BOMB_CAM_WALL_PADDING)
      : BOMB_CAM_DISTANCE;
  distance = Math.min(BOMB_CAM_DISTANCE, distance);
  const scale = distance / BOMB_CAM_DISTANCE;
  return {
    position: {
      x: target.x + (desired.x - target.x) * scale,
      y: target.y + (desired.y - target.y) * scale,
      z: target.z + (desired.z - target.z) * scale,
    },
    target,
  };
}
