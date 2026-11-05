import type { ArenaMap } from './map';
import { distance, normalize, type Vec3 } from './math';

export function rayBoxIntersect(
  origin: Vec3,
  dir: Vec3,
  min: Vec3,
  max: Vec3,
  maxDist = Number.POSITIVE_INFINITY,
): boolean {
  let tMin = 0;
  let tMax = maxDist;

  const axes: ReadonlyArray<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  for (const axis of axes) {
    const o = origin[axis];
    const d = dir[axis];
    const bMin = min[axis];
    const bMax = max[axis];

    if (Math.abs(d) < 1e-9) {
      if (o < bMin || o > bMax) {
        return false;
      }
      continue;
    }

    let t1 = (bMin - o) / d;
    let t2 = (bMax - o) / d;
    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) {
      return false;
    }
  }

  return tMin < maxDist && tMax > 0;
}

/**
 * Checks whether an observer has direct visual line of sight to a target.
 * Takes into account:
 * 1. Maximum detection range.
 * 2. Field of view (angle relative to observer yaw).
 * 3. Solid occluder obstacles (walls, pillars, crates) in map.boxes.
 */
export function hasLineOfSight(
  map: ArenaMap,
  observerPos: Vec3,
  observerYaw: number,
  targetPos: Vec3,
  maxDistance = 55,
  fovRad = (85 * Math.PI) / 180,
): boolean {
  const dx = targetPos.x - observerPos.x;
  const dy = targetPos.y - observerPos.y;
  const dz = targetPos.z - observerPos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > maxDistance) {
    return false;
  }
  if (dist < 0.6) {
    return true; // Point-blank range
  }

  // Forward vector of observer (yaw 0 points towards -Z, yaw pi/2 points towards -X)
  const fwdX = -Math.sin(observerYaw);
  const fwdZ = -Math.cos(observerYaw);

  const hDist = Math.sqrt(dx * dx + dz * dz);
  if (hDist > 0.5) {
    const dot = (dx / hDist) * fwdX + (dz / hDist) * fwdZ;
    if (dot < Math.cos(fovRad)) {
      return false; // Target is behind or outside field of view
    }
  }

  // Raycast from observer eye level to target center
  const origin: Vec3 = { x: observerPos.x, y: observerPos.y + 1.5, z: observerPos.z };
  const target: Vec3 = { x: targetPos.x, y: targetPos.y + 1.2, z: targetPos.z };
  const rayDir = normalize({ x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z });
  const rayDist = distance(origin, target);

  for (const box of map.boxes) {
    if (box.kind === 'roof' || box.kind === 'ladder' || box.kind === 'floor') {
      continue;
    }
    if (rayBoxIntersect(origin, rayDir, box.min, box.max, rayDist - 0.35)) {
      return false; // Occluded by wall or crate
    }
  }

  return true;
}
