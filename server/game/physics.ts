import { MOVEMENT } from '../../shared/config';
import { clamp, normalizeAngle, normalize, type Vec3 } from '../../shared/math';
import type { ArenaMap, MapBox } from '../../shared/map';
import type { InputFrame } from '../../shared/protocol';
import { getWeapon } from '../../shared/weapons';
import { getActiveWeapon } from './inventory';
import { playerHeight } from './player';
import type { PlayerState } from './types';

const EPSILON = 1e-4;

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface SimulationResult {
  jumped: boolean;
  landed: boolean;
  stepped: boolean;
  fallSpeed: number;
}

export function playerAabb(player: PlayerState, height = playerHeight(player)): Aabb {
  return {
    min: {
      x: player.position.x - MOVEMENT.radius,
      y: player.position.y,
      z: player.position.z - MOVEMENT.radius,
    },
    max: {
      x: player.position.x + MOVEMENT.radius,
      y: player.position.y + height,
      z: player.position.z + MOVEMENT.radius,
    },
  };
}

export function aabbOverlaps(a: Aabb, b: Aabb): boolean {
  return (
    a.min.x < b.max.x - EPSILON &&
    a.max.x > b.min.x + EPSILON &&
    a.min.y < b.max.y - EPSILON &&
    a.max.y > b.min.y + EPSILON &&
    a.min.z < b.max.z - EPSILON &&
    a.max.z > b.min.z + EPSILON
  );
}

function boxAabb(box: MapBox): Aabb {
  return { min: box.min, max: box.max };
}

function overlappingBoxesAtHeight(player: PlayerState, map: ArenaMap, height: number): MapBox[] {
  const aabb = playerAabb(player, height);
  return map.boxes.filter((box) => box.kind !== 'ladder' && aabbOverlaps(aabb, boxAabb(box)));
}

export function overlappingBoxes(player: PlayerState, map: ArenaMap): MapBox[] {
  return overlappingBoxesAtHeight(player, map, playerHeight(player));
}

export function isSupported(player: PlayerState, map: ArenaMap): boolean {
  const radius = MOVEMENT.radius;
  const feet = player.position.y;
  for (const box of map.boxes) {
    if (box.kind === 'ladder') {
      continue;
    }
    if (player.position.x + radius <= box.min.x + EPSILON) {
      continue;
    }
    if (player.position.x - radius >= box.max.x - EPSILON) {
      continue;
    }
    if (player.position.z + radius <= box.min.z + EPSILON) {
      continue;
    }
    if (player.position.z - radius >= box.max.z - EPSILON) {
      continue;
    }
    if (Math.abs(box.max.y - feet) <= 0.035) {
      return true;
    }
  }
  return false;
}

export function canStand(player: PlayerState, map: ArenaMap): boolean {
  return overlappingBoxesAtHeight(player, map, MOVEMENT.standHeight).length === 0;
}

export function overlappingLadders(player: PlayerState, map: ArenaMap): MapBox[] {
  const aabb = playerAabb(player);
  const margin = MOVEMENT.ladderGrabMargin;
  return map.boxes.filter((box) => {
    if (box.kind !== 'ladder') {
      return false;
    }
    const reach = {
      min: {
        x: box.min.x - margin,
        y: box.min.y - margin,
        z: box.min.z - margin,
      },
      max: {
        x: box.max.x + margin,
        y: box.max.y + margin,
        z: box.max.z + margin,
      },
    };
    return aabbOverlaps(aabb, reach);
  });
}

function snapToLadder(player: PlayerState, ladder: MapBox, dt: number): void {
  const widthX = ladder.max.x - ladder.min.x;
  const widthZ = ladder.max.z - ladder.min.z;
  const factor = Math.min(1, MOVEMENT.ladderSnapSpeed * dt);
  // Ladders are thin boxes mounted on a wall. Snapping only the wide axis
  // centres the player without pushing them into the wall.
  if (widthX < widthZ) {
    const centerZ = (ladder.min.z + ladder.max.z) / 2;
    player.position.z += (centerZ - player.position.z) * factor;
  } else {
    const centerX = (ladder.min.x + ladder.max.x) / 2;
    player.position.x += (centerX - player.position.x) * factor;
  }
}

function wishDirection(input: InputFrame, yaw: number): Vec3 {
  const forwardInput = clamp(Number.isFinite(input.forward) ? input.forward : 0, -1, 1);
  const strafeInput = clamp(Number.isFinite(input.strafe) ? input.strafe : 0, -1, 1);
  if (Math.abs(forwardInput) < 1e-6 && Math.abs(strafeInput) < 1e-6) {
    return { x: 0, y: 0, z: 0 };
  }

  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  return normalize({
    x: forwardX * forwardInput + rightX * strafeInput,
    y: 0,
    z: forwardZ * forwardInput + rightZ * strafeInput,
  });
}

function applyFriction(velocity: Vec3, friction: number, dt: number): void {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed <= 0.0001) {
    velocity.x = 0;
    velocity.z = 0;
    return;
  }
  const drop = speed * friction * dt;
  const nextSpeed = Math.max(0, speed - drop);
  const factor = nextSpeed / speed;
  velocity.x *= factor;
  velocity.z *= factor;
}

function accelerate(
  velocity: Vec3,
  wish: Vec3,
  maxSpeed: number,
  acceleration: number,
  dt: number,
): void {
  const currentSpeed = velocity.x * wish.x + velocity.z * wish.z;
  const addSpeed = maxSpeed - currentSpeed;
  if (addSpeed <= 0) {
    return;
  }
  const accelSpeed = Math.min(acceleration * dt, addSpeed);
  velocity.x += wish.x * accelSpeed;
  velocity.z += wish.z * accelSpeed;
}

function moveHorizontal(
  player: PlayerState,
  axis: 'x' | 'z',
  amount: number,
  map: ArenaMap,
): boolean {
  if (Math.abs(amount) < 1e-9) {
    return false;
  }

  const target = player.position[axis] + amount;
  player.position[axis] = target;
  const collisions = overlappingBoxes(player, map);
  if (collisions.length === 0) {
    return false;
  }

  if (player.grounded) {
    for (const box of collisions) {
      const rise = box.max.y - player.position.y;
      if (rise > EPSILON && rise <= MOVEMENT.stepHeight + EPSILON) {
        const oldY = player.position.y;
        player.position.y = box.max.y + 0.001;
        if (overlappingBoxes(player, map).length === 0) {
          player.velocity.y = 0;
          player.grounded = true;
          return true;
        }
        player.position.y = oldY;
      }
    }
  }

  let clamped = target;
  for (const box of collisions) {
    if (axis === 'x') {
      if (amount > 0) {
        clamped = Math.min(clamped, box.min.x - MOVEMENT.radius - 0.001);
      } else {
        clamped = Math.max(clamped, box.max.x + MOVEMENT.radius + 0.001);
      }
    } else if (amount > 0) {
      clamped = Math.min(clamped, box.min.z - MOVEMENT.radius - 0.001);
    } else {
      clamped = Math.max(clamped, box.max.z + MOVEMENT.radius + 0.001);
    }
  }

  player.position[axis] = clamped;
  player.velocity[axis] = 0;
  return false;
}

function moveVertical(player: PlayerState, amount: number, map: ArenaMap): boolean {
  if (Math.abs(amount) < 1e-9) {
    return false;
  }

  player.position.y += amount;
  const collisions = overlappingBoxes(player, map);
  if (collisions.length === 0) {
    return false;
  }

  if (amount <= 0) {
    let top = Number.NEGATIVE_INFINITY;
    for (const box of collisions) {
      top = Math.max(top, box.max.y);
    }
    if (top > Number.NEGATIVE_INFINITY) {
      player.position.y = top;
      player.velocity.y = 0;
      return true;
    }
    return false;
  }

  let bottom = Number.POSITIVE_INFINITY;
  for (const box of collisions) {
    bottom = Math.min(bottom, box.min.y);
  }
  if (bottom < Number.POSITIVE_INFINITY) {
    player.position.y = bottom - playerHeight(player) - 0.001;
    player.velocity.y = 0;
  }
  return false;
}

function clampToArena(player: PlayerState, map: ArenaMap): void {
  const limitX = map.size / 2 - MOVEMENT.radius - 0.05;
  const limitZ = map.sizeZ / 2 - MOVEMENT.radius - 0.05;
  if (player.position.x < -limitX) {
    player.position.x = -limitX;
    player.velocity.x = 0;
  } else if (player.position.x > limitX) {
    player.position.x = limitX;
    player.velocity.x = 0;
  }
  if (player.position.z < -limitZ) {
    player.position.z = -limitZ;
    player.velocity.z = 0;
  } else if (player.position.z > limitZ) {
    player.position.z = limitZ;
    player.velocity.z = 0;
  }
}

export function simulatePlayer(
  player: PlayerState,
  input: InputFrame,
  dt: number,
  map: ArenaMap,
  _now: number,
): SimulationResult {
  if (!player.alive) {
    return { jumped: false, landed: false, stepped: false, fallSpeed: 0 };
  }

  player.yaw = normalizeAngle(Number.isFinite(input.yaw) ? input.yaw : player.yaw);
  player.pitch = clamp(
    Number.isFinite(input.pitch) ? input.pitch : player.pitch,
    -Math.PI / 2 + 0.01,
    Math.PI / 2 - 0.01,
  );

  if (input.crouch) {
    player.crouching = true;
  } else if (player.crouching && canStand(player, map)) {
    player.crouching = false;
  }

  player.grounded = isSupported(player, map);
  if (player.grounded) {
    player.fallVelocity = 0;
  }
  const wasGrounded = player.grounded;

  let jumped = false;
  if (input.jump && player.grounded) {
    player.velocity.y = MOVEMENT.jumpVelocity;
    player.grounded = false;
    jumped = true;
  }

  const wish = wishDirection(input, player.yaw);
  const weapon = getActiveWeapon(player);
  const definition = getWeapon(weapon.id);
  const crouchFactor = player.crouching ? MOVEMENT.crouchSpeed / MOVEMENT.walkSpeed : 1;
  const walkFactor = input.walk ? MOVEMENT.walkMultiplier : 1;
  const maxSpeed = MOVEMENT.walkSpeed * definition.weight * crouchFactor * walkFactor;
  const groundAcceleration = MOVEMENT.groundAcceleration * Math.max(1, definition.weight);

  if (player.grounded) {
    applyFriction(player.velocity, MOVEMENT.friction, dt);
    accelerate(player.velocity, wish, maxSpeed, groundAcceleration, dt);
  } else {
    accelerate(player.velocity, wish, maxSpeed, MOVEMENT.airAcceleration, dt);
  }

  const ladders = overlappingLadders(player, map);
  const onLadder = ladders.length > 0;
  if (onLadder) {
    const ladder = ladders[0];
    if (ladder !== undefined) {
      snapToLadder(player, ladder, dt);
    }
    const climb = input.forward > 0.1 ? 1 : input.forward < -0.1 ? -1 : 0;
    player.velocity.y = climb * MOVEMENT.ladderSpeed;
    player.grounded = false;
  } else {
    player.velocity.y = Math.max(player.velocity.y - MOVEMENT.gravity * dt, -MOVEMENT.maxFallSpeed);
  }
  const impactSpeed = Math.max(0, -player.velocity.y);

  const steppedX = moveHorizontal(player, 'x', player.velocity.x * dt, map);
  const steppedZ = moveHorizontal(player, 'z', player.velocity.z * dt, map);
  const stepped = steppedX || steppedZ;
  const landed = moveVertical(player, player.velocity.y * dt, map);
  const fallSpeed = landed && !wasGrounded ? Math.max(player.fallVelocity, impactSpeed) : 0;
  if (landed) {
    player.fallVelocity = 0;
  } else if (!player.grounded) {
    player.fallVelocity = Math.max(player.fallVelocity, impactSpeed);
  }

  clampToArena(player, map);
  player.grounded = landed || isSupported(player, map);

  return { jumped, landed, stepped, fallSpeed };
}
