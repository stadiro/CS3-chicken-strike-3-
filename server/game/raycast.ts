import { MOVEMENT, PLAYER as PLAYER_CONFIG } from '../../shared/config';
import { add, clamp, normalize, scale, type Vec3 } from '../../shared/math';
import { DUST2_ANGLED_DOORS, type AngledDoorDef, type ArenaMap } from '../../shared/map';
import type { HitZone } from '../../shared/protocol';
import type { WeaponDefinition } from '../../shared/weapons';
import { sampleHistory } from './history';
import type { PlayerState } from './types';
import type { Rng } from './rng';

export interface AabbLike {
  min: Vec3;
  max: Vec3;
}

export interface RayAabbHit {
  distance: number;
  point: Vec3;
}

export interface WallHit extends RayAabbHit {
  boxId: string;
}

export interface PlayerHit extends RayAabbHit {
  player: PlayerState;
  zone: HitZone;
}

export type WorldHit =
  | { type: 'player'; playerHit: PlayerHit; distance: number; point: Vec3 }
  | { type: 'wall'; wallHit: WallHit; distance: number; point: Vec3 }
  | { type: 'none'; distance: number; point: Vec3 };

export function rayAabb(
  origin: Vec3,
  direction: Vec3,
  box: AabbLike,
  maxDistance = Number.POSITIVE_INFINITY,
): RayAabbHit | null {
  let tMin = 0;
  let tMax = maxDistance;

  const axes: ReadonlyArray<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  for (const axis of axes) {
    const originValue = origin[axis];
    const directionValue = direction[axis];
    const minValue = box.min[axis];
    const maxValue = box.max[axis];

    if (Math.abs(directionValue) < 1e-9) {
      if (originValue < minValue || originValue > maxValue) {
        return null;
      }
      continue;
    }

    let t1 = (minValue - originValue) / directionValue;
    let t2 = (maxValue - originValue) / directionValue;
    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
    }

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) {
      return null;
    }
  }

  if (tMax < 0) {
    return null;
  }

  const distance = Math.max(0, tMin);
  return {
    distance,
    point: add(origin, scale(direction, distance)),
  };
}

function rayAngledDoor(
  origin: Vec3,
  direction: Vec3,
  door: AngledDoorDef,
  minY: number,
  maxY: number,
  maxDistance: number,
): RayAabbHit | null {
  const len = Math.hypot(door.x1 - door.x0, door.z1 - door.z0);
  if (len < 1e-4) {
    return null;
  }
  const cx = (door.x0 + door.x1) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (door.z0 + door.z1) / 2;
  const cos = (door.z1 - door.z0) / len;
  const sin = (door.x1 - door.x0) / len;

  const ox = origin.x - cx;
  const oy = origin.y - cy;
  const oz = origin.z - cz;
  const localOrigin: Vec3 = {
    x: ox * cos - oz * sin,
    y: oy,
    z: ox * sin + oz * cos,
  };
  const localDir: Vec3 = {
    x: direction.x * cos - direction.z * sin,
    y: direction.y,
    z: direction.x * sin + direction.z * cos,
  };

  const halfT = door.thickness / 2;
  const halfH = (maxY - minY) / 2;
  const halfL = len / 2;
  const localBox: AabbLike = {
    min: { x: -halfT, y: -halfH, z: -halfL },
    max: { x: halfT, y: halfH, z: halfL },
  };

  const localHit = rayAabb(localOrigin, localDir, localBox, maxDistance);
  if (localHit === null) {
    return null;
  }
  return {
    distance: localHit.distance,
    point: add(origin, scale(direction, localHit.distance)),
  };
}

export function raycastMap(
  map: ArenaMap,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
): WallHit | null {
  let nearest: WallHit | null = null;

  for (const box of map.boxes) {
    if (box.kind === 'ladder') {
      continue;
    }
    const angledDoor = map.id === 'de_dust2' ? DUST2_ANGLED_DOORS[box.id] : undefined;
    const hit =
      angledDoor !== undefined
        ? rayAngledDoor(origin, direction, angledDoor, box.min.y, box.max.y, maxDistance)
        : rayAabb(origin, direction, box, maxDistance);
    if (hit === null) {
      continue;
    }
    if (nearest === null || hit.distance < nearest.distance) {
      nearest = {
        distance: hit.distance,
        point: hit.point,
        boxId: box.id,
      };
    }
  }

  return nearest;
}

export function raySphere(
  origin: Vec3,
  direction: Vec3,
  center: Vec3,
  radius: number,
  maxDistance = Number.POSITIVE_INFINITY,
): RayAabbHit | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) {
    return null;
  }

  const root = Math.sqrt(discriminant);
  let distance = -b - root;
  if (distance < 0) {
    distance = -b + root;
  }
  if (distance < 0 || distance > maxDistance) {
    return null;
  }

  return {
    distance,
    point: add(origin, scale(direction, distance)),
  };
}

/**
 * Ray against a vertical capped cylinder. Player bodies are rounded, so this
 * avoids the empty corners and oversized shoulders of a single AABB.
 */
export function rayVerticalCylinder(
  origin: Vec3,
  direction: Vec3,
  centerX: number,
  centerZ: number,
  radius: number,
  minY: number,
  maxY: number,
  maxDistance = Number.POSITIVE_INFINITY,
): RayAabbHit | null {
  if (maxY < minY) {
    return null;
  }

  const ox = origin.x - centerX;
  const oz = origin.z - centerZ;
  const insideXz = ox * ox + oz * oz <= radius * radius;
  if (insideXz && origin.y >= minY && origin.y <= maxY) {
    return { distance: 0, point: { ...origin } };
  }

  let nearest: RayAabbHit | null = null;
  const consider = (distance: number): void => {
    if (distance < 0 || distance > maxDistance) {
      return;
    }
    if (nearest !== null && distance >= nearest.distance) {
      return;
    }
    nearest = {
      distance,
      point: add(origin, scale(direction, distance)),
    };
  };

  const a = direction.x * direction.x + direction.z * direction.z;
  if (a > 1e-9) {
    const b = 2 * (ox * direction.x + oz * direction.z);
    const c = ox * ox + oz * oz - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      for (const distance of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
        const y = origin.y + direction.y * distance;
        if (y >= minY && y <= maxY) {
          consider(distance);
        }
      }
    }
  }

  if (Math.abs(direction.y) > 1e-9) {
    for (const capY of [minY, maxY]) {
      const distance = (capY - origin.y) / direction.y;
      if (distance < 0 || distance > maxDistance) {
        continue;
      }
      const x = origin.x + direction.x * distance - centerX;
      const z = origin.z + direction.z * distance - centerZ;
      if (x * x + z * z <= radius * radius) {
        consider(distance);
      }
    }
  }

  return nearest;
}

export function raycastPlayers(
  players: readonly PlayerState[],
  shooter: PlayerState,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  shotTime: number,
): PlayerHit | null {
  let nearest: PlayerHit | null = null;

  for (const candidate of players) {
    if (candidate.id === shooter.id || candidate.team === shooter.team || !candidate.alive) {
      continue;
    }

    const sampled = sampleHistory(candidate, shotTime);
    if (!sampled.alive) {
      continue;
    }

    let candidateHit: PlayerHit | null = null;
    const headCenterY = sampled.position.y + sampled.height - PLAYER_CONFIG.headRadius;
    const headHit = raySphere(
      origin,
      direction,
      { x: sampled.position.x, y: headCenterY, z: sampled.position.z },
      PLAYER_CONFIG.headRadius,
      maxDistance,
    );
    if (headHit !== null) {
      candidateHit = {
        player: candidate,
        distance: headHit.distance,
        point: headHit.point,
        zone: 'head',
      };
    }

    const legTop = sampled.position.y + sampled.height * PLAYER_CONFIG.legHeightRatio;
    // Overlap the bottom of the head sphere so the neck/shoulder area cannot
    // fall into a gap between the two hitboxes.
    const torsoTop = headCenterY;
    const bodyHit = rayVerticalCylinder(
      origin,
      direction,
      sampled.position.x,
      sampled.position.z,
      PLAYER_CONFIG.bodyRadius,
      legTop,
      torsoTop,
      maxDistance,
    );
    if (bodyHit !== null && (candidateHit === null || bodyHit.distance < candidateHit.distance)) {
      candidateHit = {
        player: candidate,
        distance: bodyHit.distance,
        point: bodyHit.point,
        zone: 'body',
      };
    }

    const legHit = rayVerticalCylinder(
      origin,
      direction,
      sampled.position.x,
      sampled.position.z,
      PLAYER_CONFIG.legRadius,
      sampled.position.y,
      legTop,
      maxDistance,
    );
    if (legHit !== null && (candidateHit === null || legHit.distance < candidateHit.distance)) {
      candidateHit = {
        player: candidate,
        distance: legHit.distance,
        point: legHit.point,
        zone: 'legs',
      };
    }

    if (candidateHit !== null && (nearest === null || candidateHit.distance < nearest.distance)) {
      nearest = candidateHit;
    }
  }

  return nearest;
}

export function raycastWorld(
  map: ArenaMap,
  players: readonly PlayerState[],
  shooter: PlayerState,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  shotTime: number,
): WorldHit {
  const wallHit = raycastMap(map, origin, direction, maxDistance);
  const playerHit = raycastPlayers(players, shooter, origin, direction, maxDistance, shotTime);

  if (playerHit !== null && (wallHit === null || playerHit.distance < wallHit.distance - 0.001)) {
    return {
      type: 'player',
      playerHit,
      distance: playerHit.distance,
      point: playerHit.point,
    };
  }

  if (wallHit !== null) {
    return {
      type: 'wall',
      wallHit,
      distance: wallHit.distance,
      point: wallHit.point,
    };
  }

  return {
    type: 'none',
    distance: maxDistance,
    point: add(origin, scale(direction, maxDistance)),
  };
}

export function applySpread(direction: Vec3, spread: number, rng: Rng): Vec3 {
  if (spread <= 0) {
    return direction;
  }

  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const dot = direction.x * up.x + direction.y * up.y + direction.z * up.z;
  const reference = Math.abs(dot) > 0.99 ? { x: 1, y: 0, z: 0 } : up;
  const right = normalize({
    x: direction.y * reference.z - direction.z * reference.y,
    y: direction.z * reference.x - direction.x * reference.z,
    z: direction.x * reference.y - direction.y * reference.x,
  });
  const upCorrected = normalize({
    x: right.y * direction.z - right.z * direction.y,
    y: right.z * direction.x - right.x * direction.z,
    z: right.x * direction.y - right.y * direction.x,
  });

  const angle = rng.next() * Math.PI * 2;
  const radius = Math.sqrt(rng.next()) * spread;
  const offset = {
    x: right.x * Math.cos(angle) * radius + upCorrected.x * Math.sin(angle) * radius,
    y: right.y * Math.cos(angle) * radius + upCorrected.y * Math.sin(angle) * radius,
    z: right.z * Math.cos(angle) * radius + upCorrected.z * Math.sin(angle) * radius,
  };

  return normalize(add(direction, offset));
}

export function computeSpread(
  weapon: WeaponDefinition,
  horizontalSpeed: number,
  crouching: boolean,
  grounded: boolean,
  scoped = false,
  sprayIndex = 0,
): number {
  const movementFactor = clamp(horizontalSpeed / MOVEMENT.walkSpeed, 0, 1.5);
  const crouchFactor = crouching ? 0.55 : 1;
  const airFactor = grounded ? 1 : 1.6;
  const unscoped = !scoped && weapon.unscopedSpread !== undefined;
  const baseSpread = unscoped ? (weapon.unscopedSpread ?? weapon.spread) : weapon.spread;
  const movementSpread = weapon.moveSpread * movementFactor * crouchFactor * airFactor;

  // The first two bullets go exactly where the crosshair points while standing still.
  // Sustained fire quickly opens up a wide cone so holding the trigger is a commitment.
  const firstShotPenalty = sprayIndex <= 1 && !unscoped ? 0 : baseSpread;
  const sprayPenalty = sprayIndex <= 1 ? 0 : Math.min(0.065, (sprayIndex - 1) * 0.0075);
  return firstShotPenalty + movementSpread + sprayPenalty;
}
