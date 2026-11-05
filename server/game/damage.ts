import { DEFAULT_MATCH_CONFIG, FALL_DAMAGE, PLAYER as PLAYER_CONFIG } from '../../shared/config';
import type { DamageResult, PlayerState } from './types';

export interface DamageOptions {
  /** Fraction of incoming damage that penetrates armor. 1 = no armor effect. */
  armorRatio?: number;
  ignoreArmor?: boolean;
  allowSelf?: boolean;
  allowTeam?: boolean;
}

function emptyResult(victim: PlayerState, zone: DamageResult['zone']): DamageResult {
  return {
    damage: 0,
    armorDamage: 0,
    healthAfter: victim.health,
    armorAfter: victim.armor,
    killed: false,
    headshot: false,
    zone,
  };
}

export function applyDamage(
  victim: PlayerState,
  attacker: PlayerState | null,
  baseDamage: number,
  zone: 'head' | 'body' | 'legs',
  now: number,
  respawnMs = DEFAULT_MATCH_CONFIG.respawnMs,
  options: DamageOptions = {},
): DamageResult {
  if (!victim.alive) {
    return emptyResult(victim, zone);
  }

  if (
    attacker !== null &&
    ((attacker.id === victim.id && options.allowSelf !== true) ||
      (attacker.team === victim.team && options.allowTeam !== true))
  ) {
    return emptyResult(victim, zone);
  }

  const multiplier =
    zone === 'head'
      ? PLAYER_CONFIG.headshotMultiplier
      : zone === 'legs'
        ? PLAYER_CONFIG.legMultiplier
        : 1;
  const incoming = Math.max(0, baseDamage * multiplier);

  let healthDamage = incoming;
  let armorDamage = 0;
  const headProtected = zone !== 'head' || victim.helmet;
  if (victim.armor > 0 && options.ignoreArmor !== true && headProtected) {
    const armorRatio = Math.min(1, Math.max(0, options.armorRatio ?? 1));
    const armoredDamage = incoming * armorRatio;
    const blocked = incoming - armoredDamage;
    const requestedArmorDamage = blocked * 0.5;
    if (requestedArmorDamage > victim.armor) {
      // CS 1.6: when armor cannot absorb the full hit, recompute health damage
      // from the armor that is actually available.
      armorDamage = victim.armor;
      healthDamage = incoming - armorDamage / (2 * armorRatio);
    } else {
      armorDamage = requestedArmorDamage;
      healthDamage = armoredDamage;
    }
    victim.armor = Math.max(0, victim.armor - armorDamage);
  }

  const effectiveDamage = Math.min(victim.health, healthDamage);
  victim.health = Math.max(0, victim.health - healthDamage);
  victim.lastDamageAt = now;
  victim.lastAttackerId = attacker?.id ?? null;

  const killed = victim.health <= 0;
  if (killed) {
    victim.alive = false;
    victim.respawnAt = now + respawnMs;
    victim.velocity = { x: 0, y: 0, z: 0 };
    victim.scoped = false;
    victim.lastFireHeld = false;
    victim.pendingFire = null;
  }

  return {
    damage: effectiveDamage,
    armorDamage,
    healthAfter: victim.health,
    armorAfter: victim.armor,
    killed,
    headshot: zone === 'head',
    zone,
  };
}

export function fallDamageForSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= FALL_DAMAGE.safeSpeed) {
    return 0;
  }
  const damage = (speed - FALL_DAMAGE.safeSpeed) * FALL_DAMAGE.damagePerSpeed;
  return Math.min(FALL_DAMAGE.maxDamage, Math.max(0, damage));
}

export function applyFallDamage(
  victim: PlayerState,
  speed: number,
  now: number,
  respawnMs = DEFAULT_MATCH_CONFIG.respawnMs,
): DamageResult {
  const damage = fallDamageForSpeed(speed);
  return applyDamage(victim, null, damage, 'body', now, respawnMs, {
    ignoreArmor: true,
    allowSelf: true,
  });
}
