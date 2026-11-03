import { ECONOMY, type Side } from '../../shared/economy';
import { MOVEMENT, PLAYER as PLAYER_CONFIG } from '../../shared/config';
import { vec3, type Vec3 } from '../../shared/math';
import type { Team } from '../../shared/protocol';
import { createDefaultInventory } from './inventory';
import type { PlayerState } from './types';

export function createPlayer(
  id: string,
  sessionToken: string,
  name: string,
  team: Team,
  now: number,
  spawnPosition: Vec3,
  spawnYaw: number,
  side: Side = team === 'alpha' ? 't' : 'ct',
): PlayerState {
  return {
    id,
    sessionToken,
    name,
    team,
    side,
    socketId: null,
    connected: true,
    joinedAt: now,
    disconnectedAt: null,
    position: { ...spawnPosition },
    velocity: vec3(),
    yaw: spawnYaw,
    pitch: 0,
    health: PLAYER_CONFIG.maxHealth,
    armor: PLAYER_CONFIG.startingArmor,
    helmet: false,
    defuseKit: false,
    money: ECONOMY.startMoney,
    lossStreak: 0,
    grenadeCounts: {},
    blindUntil: 0,
    roundGrenadesThrown: 0,
    purchases: [],
    alive: true,
    crouching: false,
    walking: false,
    grounded: true,
    scoped: false,
    lastFireHeld: false,
    pendingFire: null,
    fallVelocity: 0,
    jumpBufferUntil: 0,
    respawnAt: null,
    kills: 0,
    deaths: 0,
    inventory: createDefaultInventory(side),
    activeSlot: 'secondary',
    lastFireAt: 0,
    sprayShots: 0,
    roundShots: 0,
    roundHits: 0,
    roundDamage: 0,
    roundHeadshots: 0,
    matchShots: 0,
    matchHits: 0,
    matchDamage: 0,
    matchHeadshots: 0,
    matchHeadshotKills: 0,
    reloadingUntil: null,
    reloadWeapon: null,
    lastUseAt: 0,
    lastInput: null,
    lastInputSeq: 0,
    pendingActions: [],
    lastInputReceivedAt: 0,
    history: [],
    lastDamageAt: 0,
    lastAttackerId: null,
    rematchVote: false,
  };
}

export function playerHeight(player: PlayerState): number {
  return player.crouching ? MOVEMENT.crouchHeight : MOVEMENT.standHeight;
}

export function playerEyePosition(player: PlayerState): Vec3 {
  return {
    x: player.position.x,
    y: player.position.y + playerHeight(player) - MOVEMENT.eyeOffset,
    z: player.position.z,
  };
}

export function resetPlayerForSpawn(
  player: PlayerState,
  position: Vec3,
  yaw: number,
  now: number,
  preserveLoadout = false,
): void {
  const keptInventory = preserveLoadout ? player.inventory : null;
  const keptArmor = preserveLoadout ? player.armor : PLAYER_CONFIG.startingArmor;
  const keptHelmet = preserveLoadout ? player.helmet : false;
  const keptKit = preserveLoadout ? player.defuseKit : false;
  const keptSlot = preserveLoadout ? player.activeSlot : 'secondary';

  player.position = { ...position };
  player.velocity = vec3();
  player.yaw = yaw;
  player.pitch = 0;
  player.health = PLAYER_CONFIG.maxHealth;
  player.armor = keptArmor;
  player.helmet = keptHelmet;
  player.defuseKit = keptKit;
  player.blindUntil = 0;
  player.alive = true;
  player.crouching = false;
  player.walking = false;
  player.grounded = true;
  player.scoped = false;
  player.lastFireHeld = false;
  player.pendingFire = null;
  player.fallVelocity = 0;
  player.jumpBufferUntil = 0;
  player.respawnAt = null;
  player.inventory = keptInventory ?? createDefaultInventory(player.side);
  if (player.inventory[keptSlot] !== null || keptSlot === 'knife') {
    player.activeSlot = keptSlot;
  } else {
    player.activeSlot =
      player.inventory.primary !== null
        ? 'primary'
        : player.inventory.secondary !== null
          ? 'secondary'
          : player.inventory.grenade !== null
            ? 'grenade'
            : 'knife';
  }
  player.lastFireAt = now;
  player.sprayShots = 0;
  player.roundShots = 0;
  player.roundHits = 0;
  player.roundDamage = 0;
  player.roundHeadshots = 0;
  player.roundGrenadesThrown = 0;
  player.purchases = [];
  player.reloadingUntil = null;
  player.reloadWeapon = null;
  player.lastUseAt = 0;
  player.lastInput = null;
  player.lastInputSeq = 0;
  player.pendingActions = [];
  player.lastInputReceivedAt = now;
  player.history = [];
  player.lastDamageAt = 0;
  player.lastAttackerId = null;
}
