import { describe, expect, it } from 'vitest';
import { applyDamage, applyFallDamage, fallDamageForSpeed } from '../server/game/damage';
import { makePlayer } from './helpers';

describe('damage and armor', () => {
  it('applies body damage without armor', () => {
    const victim = makePlayer();
    victim.armor = 0;
    const result = applyDamage(
      victim,
      makePlayer({ id: 'attacker', team: 'bravo' }),
      40,
      'body',
      5_000,
    );
    expect(result.damage).toBe(40);
    expect(result.healthAfter).toBe(60);
    expect(result.killed).toBe(false);
    expect(result.zone).toBe('body');
  });

  it('uses the weapon armor ratio when the victim wears armor', () => {
    const victim = makePlayer();
    victim.armor = 100;
    const result = applyDamage(
      victim,
      makePlayer({ id: 'attacker', team: 'bravo' }),
      40,
      'body',
      5_000,
      3_000,
      { armorRatio: 0.5 },
    );
    expect(result.armorAfter).toBe(90);
    expect(result.armorDamage).toBe(10);
    expect(result.damage).toBe(20);
    expect(result.healthAfter).toBe(80);
  });

  it('recomputes health damage when armor is depleted by a hit', () => {
    const victim = makePlayer({ armor: 5, health: 100 });
    const result = applyDamage(
      victim,
      makePlayer({ id: 'attacker', team: 'bravo' }),
      100,
      'body',
      5_000,
      3_000,
      { armorRatio: 0.5 },
    );
    expect(result.armorAfter).toBe(0);
    expect(result.armorDamage).toBe(5);
    expect(result.damage).toBe(95);
    expect(result.healthAfter).toBe(5);
  });

  it('applies CS-style fall damage without armor absorption', () => {
    expect(fallDamageForSpeed(580 / 39.0625)).toBe(0);
    expect(fallDamageForSpeed(20)).toBeGreaterThan(0);
    expect(fallDamageForSpeed(1024 / 39.0625)).toBeCloseTo(100);
    expect(fallDamageForSpeed(100)).toBeGreaterThan(100);

    const victim = makePlayer({ armor: 100, health: 100 });
    const result = applyFallDamage(victim, 20, 5_000);
    expect(result.damage).toBeGreaterThan(0);
    expect(result.armorAfter).toBe(100);
    expect(result.armorDamage).toBe(0);
    expect(result.healthAfter).toBeLessThan(100);
  });

  it('applies headshot and leg multipliers', () => {
    const headVictim = makePlayer({ armor: 0 });
    const head = applyDamage(
      headVictim,
      makePlayer({ id: 'attacker', team: 'bravo' }),
      25,
      'head',
      1_000,
    );
    expect(head.damage).toBe(100);
    expect(head.headshot).toBe(true);

    const legVictim = makePlayer({ armor: 0 });
    const legs = applyDamage(
      legVictim,
      makePlayer({ id: 'attacker', team: 'bravo' }),
      40,
      'legs',
      1_000,
    );
    expect(legs.damage).toBe(28);
    expect(legs.headshot).toBe(false);
  });

  it('marks a victim dead and schedules respawn', () => {
    const victim = makePlayer({ armor: 0, health: 10 });
    const result = applyDamage(
      victim,
      makePlayer({ id: 'attacker', team: 'bravo' }),
      50,
      'body',
      9_000,
      3_000,
    );
    expect(result.killed).toBe(true);
    expect(victim.alive).toBe(false);
    expect(victim.health).toBe(0);
    expect(victim.respawnAt).toBe(12_000);
    expect(victim.velocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rejects friendly fire and self damage', () => {
    const victim = makePlayer({ team: 'alpha' });
    const friend = makePlayer({ id: 'friend', team: 'alpha' });
    expect(applyDamage(victim, friend, 100, 'body', 1_000).damage).toBe(0);
    expect(applyDamage(victim, victim, 100, 'body', 1_000).damage).toBe(0);
    expect(victim.health).toBe(100);
  });

  it('ignores damage to a dead victim', () => {
    const victim = makePlayer({ alive: false, health: 0 });
    const result = applyDamage(
      victim,
      makePlayer({ id: 'attacker', team: 'bravo' }),
      50,
      'body',
      1_000,
    );
    expect(result.damage).toBe(0);
    expect(result.killed).toBe(false);
  });

  it('records the attacker and damage timestamp', () => {
    const victim = makePlayer();
    const attacker = makePlayer({ id: 'attacker', team: 'bravo' });
    applyDamage(victim, attacker, 10, 'body', 777);
    expect(victim.lastAttackerId).toBe('attacker');
    expect(victim.lastDamageAt).toBe(777);
  });
});
