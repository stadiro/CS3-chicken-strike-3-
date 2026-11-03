import { describe, expect, it } from 'vitest';
import { computeRecoilKick } from '../shared/recoil';
import {
  damageAtDistance,
  getWeapon,
  isGrenadeWeapon,
  isWeaponId,
  isWeaponSlot,
  PICKUP_WEAPON_IDS,
  WEAPON_IDS,
  WEAPONS,
} from '../shared/weapons';

describe('weapon definitions', () => {
  it('exposes every weapon with a matching id', () => {
    expect(WEAPON_IDS).toHaveLength(26);
    for (const id of WEAPON_IDS) {
      expect(WEAPONS[id].id).toBe(id);
      expect(getWeapon(id)).toBe(WEAPONS[id]);
      expect(WEAPONS[id].damage).toBeGreaterThan(0);
      expect(WEAPONS[id].rpm).toBeGreaterThan(0);
      if (!isGrenadeWeapon(id)) {
        expect(WEAPONS[id].range).toBeGreaterThan(0);
      }
    }
  });

  it('keeps pickups limited to firearms and grenades', () => {
    expect(PICKUP_WEAPON_IDS).not.toContain('knife');
    expect(PICKUP_WEAPON_IDS).toContain('hegrenade');
    for (const id of PICKUP_WEAPON_IDS) {
      expect(WEAPONS[id].slot).not.toBe('knife');
    }
  });

  it('uses CS 1.6 damage, armor, range, and AWP spread values', () => {
    const ak = getWeapon('ak47');
    expect(ak.damage).toBe(36);
    expect(ak.armorRatio).toBe(0.775);
    expect(ak.rangeModifier).toBe(0.98);
    expect(damageAtDistance(ak, 0)).toBe(36);
    expect(damageAtDistance(ak, 12.8)).toBeCloseTo(36 * 0.98);

    const awp = getWeapon('awp');
    expect(awp.damage).toBe(115);
    expect(awp.unscopedSpread).toBeGreaterThan(awp.spread);
    expect(damageAtDistance(awp, 100)).toBeLessThan(awp.damage);

    const grenade = getWeapon('hegrenade');
    expect(grenade.slot).toBe('grenade');
    expect(grenade.damage).toBe(85);
    expect(grenade.magazine).toBe(1);
  });

  it('uses sensible slot and magazine values', () => {
    expect(getWeapon('knife').magazine).toBe(0);
    expect(getWeapon('glock').slot).toBe('secondary');
    expect(getWeapon('usp').slot).toBe('secondary');
    expect(getWeapon('glock').magazine).toBe(20);
    expect(getWeapon('usp').magazine).toBe(12);
    expect(getWeapon('deagle').slot).toBe('secondary');
    expect(getWeapon('ak47').slot).toBe('primary');
    expect(getWeapon('awp').automatic).toBe(false);
    expect(getWeapon('ak47').automatic).toBe(true);
    expect(getWeapon('mp5').slot).toBe('primary');
    expect(getWeapon('m249').automatic).toBe(true);
    expect(getWeapon('m249').rpm).toBe(750);
  });

  it('builds a horizontal spray pattern instead of a vertical line', () => {
    const rifle = getWeapon('ak47');
    const kicks = Array.from({ length: 10 }, (_, index) =>
      computeRecoilKick(rifle, index, () => 0.5),
    );
    const horizontal = kicks.map((kick) => kick.yaw);

    expect(kicks.every((kick) => kick.pitch > 0)).toBe(true);
    expect(new Set(horizontal.map((value) => value.toFixed(5))).size).toBeGreaterThan(4);
    expect(Math.max(...horizontal)).toBeGreaterThan(0);
    expect(Math.min(...horizontal)).toBeLessThan(0);
  });

  it('does not apply recoil to the knife', () => {
    expect(computeRecoilKick(getWeapon('knife'), 5, () => 0.9)).toEqual({
      yaw: 0,
      pitch: 0,
    });
  });

  it('validates weapon ids and slots', () => {
    expect(isWeaponId('ak47')).toBe(true);
    expect(isWeaponId('railgun')).toBe(false);
    expect(isWeaponId(42)).toBe(false);
    expect(isWeaponSlot('primary')).toBe(true);
    expect(isWeaponSlot('secondary')).toBe(true);
    expect(isWeaponSlot('knife')).toBe(true);
    expect(isWeaponSlot('grenade')).toBe(true);
  });
});
