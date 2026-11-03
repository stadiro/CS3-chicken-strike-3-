import type { GrenadeType } from './economy';

export interface MatchConfig {
  tickRate: number;
  fragLimit: number;
  matchDurationMs: number;
  countdownMs: number;
  respawnMs: number;
  roundResetMs: number;
  reconnectWindowMs: number;
  useCooldownMs: number;
  snapshotBufferMs: number;
  lagCompensationMs: number;
  historyRetentionMs: number;
  maxDroppedWeapons: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  tickRate: 30,
  fragLimit: 16,
  matchDurationMs: 10 * 60 * 1000,
  countdownMs: 8_000,
  respawnMs: 3000,
  roundResetMs: 5_000,
  reconnectWindowMs: 60_000,
  useCooldownMs: 250,
  snapshotBufferMs: 100,
  lagCompensationMs: 300,
  historyRetentionMs: 350,
  maxDroppedWeapons: 8,
};

export const MOVEMENT = {
  walkSpeed: 6.4,
  crouchSpeed: 3.1,
  groundAcceleration: 60,
  airAcceleration: 14,
  friction: 10,
  gravity: 20,
  jumpVelocity: 7.0,
  radius: 0.36,
  standHeight: 1.8,
  crouchHeight: 1.2,
  eyeOffset: 0.15,
  stepHeight: 0.36,
  maxFallSpeed: 40,
  ladderSpeed: 3.6,
  ladderGrabMargin: 0.38,
  ladderSnapSpeed: 9,
  walkMultiplier: 0.52,
} as const;

export const PLAYER = {
  maxHealth: 100,
  maxArmor: 100,
  startingArmor: 0,
  armorAbsorption: 0.5,
  headshotMultiplier: 4,
  legMultiplier: 0.7,
  /** Radius of the spherical head hitbox. Matches the visible head. */
  headRadius: 0.21,
  /** Radius of the torso cylinder hitbox. Matches the visible torso. */
  bodyRadius: 0.32,
  /** Radius of the leg cylinder hitbox. Matches the visible legs. */
  legRadius: 0.27,
  /** Legs occupy this fraction of the player's current height. */
  legHeightRatio: 0.46,
} as const;

export const FALL_DAMAGE = {
  /** GoldSrc safe fall speed is 580 Hammer units/sec. */
  safeSpeed: 580 / 39.0625,
  /** 1024 Hammer units/sec produces exactly 100 fall damage. */
  fatalSpeed: 1024 / 39.0625,
  maxDamage: 1000,
  /** GoldSrc DAMAGE_FOR_FALL_SPEED (25/111) in game units. */
  damagePerSpeed: (25 / 111) * 39.0625,
} as const;

export const GRENADE = {
  /** CS 1.6 HE grenade fuse is 1.5 seconds. */
  fuseMs: 1500,
  damage: 85,
  radius: 8.75,
  /** 750 Hammer units/s at the GoldSrc 39.0625 units/m scale. */
  throwSpeed: 750 / 39.0625,
  throwLift: 3.2,
  playerVelocityFactor: 0.5,
  bounceDamping: 0.42,
  gravity: 20,
  minDamageFraction: 0.08,
} as const;

export const BOMB = {
  plantTimeMs: 3_000,
  defuseTimeMs: 8_000,
  defuseKitTimeMs: 4_000,
  fuseTimeMs: 30_000,
  defuseRadius: 2.2,
  pickupRadius: 1.6,
  soundRadius: 34,
  explosionRadius: 34,
  explosionDamage: 500,
  minDamageFraction: 0.05,
} as const;

export interface GrenadeEffectConfig {
  fuseMs: number;
  radius: number;
  damage: number;
  durationMs: number;
  tickMs?: number;
  blind?: boolean;
}

export const GRENADE_EFFECTS: Record<GrenadeType, GrenadeEffectConfig> = {
  hegrenade: {
    fuseMs: 1500,
    radius: GRENADE.radius,
    damage: GRENADE.damage,
    durationMs: 0,
  },
  flashbang: {
    fuseMs: 1500,
    radius: 75,
    damage: 0,
    durationMs: 4_870,
    blind: true,
  },
  smokegrenade: {
    fuseMs: 1500,
    radius: 5,
    damage: 0,
    durationMs: 15_000,
  },
  molotov: {
    fuseMs: 1500,
    radius: 4.5,
    damage: 15,
    durationMs: 7_000,
    tickMs: 500,
  },
  incendiary: {
    fuseMs: 1500,
    radius: 4.5,
    damage: 15,
    durationMs: 7_000,
    tickMs: 500,
  },
};

export const NETWORK = {
  // The client sends at 120 Hz and flushes action keys immediately.
  maxInputsPerSecond: 180,
  maxInputsBurst: 60,
  maxJoinsPerMinute: 20,
  maxRematchPerMinute: 12,
  maxNameLength: 16,
  maxPingPerSecond: 10,
  maxPingBurst: 5,
  maxInputFutureMs: 1000,
} as const;
