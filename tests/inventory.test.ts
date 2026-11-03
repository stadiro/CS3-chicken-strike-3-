import { describe, expect, it } from 'vitest';
import {
  addWeapon,
  cancelReload,
  consumeShot,
  createDefaultInventory,
  createWeaponInstance,
  dropWeapons,
  finishReloadIfDue,
  getActiveWeapon,
  startReload,
  switchWeapon,
} from '../server/game/inventory';
import { makePlayer } from './helpers';

describe('inventory', () => {
  it('starts alpha with a Glock, bravo with a USP, and both with a knife', () => {
    const alpha = createDefaultInventory('alpha');
    expect(alpha.primary).toBeNull();
    expect(alpha.secondary?.id).toBe('glock');
    expect(alpha.secondary?.ammo).toBe(20);
    expect(alpha.knife.id).toBe('knife');

    const bravo = createDefaultInventory('bravo');
    expect(bravo.primary).toBeNull();
    expect(bravo.secondary?.id).toBe('usp');
    expect(bravo.secondary?.ammo).toBe(12);
  });

  it('starts without a grenade and can hold only one HE grenade', () => {
    const player = makePlayer();
    expect(player.inventory.grenade).toBeNull();
    const first = addWeapon(player, 'hegrenade');
    expect(first.added).toBe(true);
    expect(player.inventory.grenade).toEqual({ id: 'hegrenade', ammo: 1, reserve: 0 });
    expect(player.activeSlot).toBe('secondary');
    const second = addWeapon(player, 'hegrenade');
    expect(second.added).toBe(false);
    expect(second.sameWeapon).toBe(true);
  });

  it('does not equip a picked-up grenade over the active firearm', () => {
    const player = makePlayer();
    addWeapon(player, 'ak47');
    addWeapon(player, 'hegrenade');
    expect(player.activeSlot).toBe('primary');
    expect(getActiveWeapon(player).id).toBe('ak47');
    expect(switchWeapon(player, 'grenade')).toBe(true);
    expect(getActiveWeapon(player).id).toBe('hegrenade');
  });

  it('does not reload a grenade', () => {
    const player = makePlayer();
    addWeapon(player, 'hegrenade');
    expect(startReload(player, 1_000)).toBe(false);
    expect(player.reloadingUntil).toBeNull();
  });

  it('creates weapon instances from definitions', () => {
    const ak = createWeaponInstance('ak47');
    expect(ak).toEqual({ id: 'ak47', ammo: 30, reserve: 90 });
    const knife = createWeaponInstance('knife');
    expect(knife).toEqual({ id: 'knife', ammo: 0, reserve: 0 });
  });

  it('switches only to owned slots', () => {
    const player = makePlayer();
    expect(switchWeapon(player, 'knife')).toBe(true);
    expect(player.activeSlot).toBe('knife');
    expect(switchWeapon(player, 'knife')).toBe(false);
    expect(switchWeapon(player, 'primary')).toBe(false);
    expect(switchWeapon(player, 'secondary')).toBe(true);
    expect(getActiveWeapon(player).id).toBe('glock');
  });

  it('adds firearms and replaces the current slot weapon', () => {
    const player = makePlayer();
    const first = addWeapon(player, 'ak47');
    expect(first.added).toBe(true);
    expect(first.replaced).toBeNull();
    expect(player.activeSlot).toBe('primary');
    expect(player.inventory.primary?.id).toBe('ak47');

    const second = addWeapon(player, 'm4a1');
    expect(second.added).toBe(true);
    expect(second.replaced?.id).toBe('ak47');
    expect(player.inventory.primary?.id).toBe('m4a1');
  });

  it('stacks ammo for the same weapon up to twice the reserve', () => {
    const player = makePlayer();
    addWeapon(player, 'ak47', 10, 20);
    const result = addWeapon(player, 'ak47', 30, 90);
    expect(result.sameWeapon).toBe(true);
    expect(result.replaced).toBeNull();
    expect(player.inventory.primary?.ammo).toBe(10);
    expect(player.inventory.primary?.reserve).toBe(140);
    addWeapon(player, 'ak47', 30, 90);
    expect(player.inventory.primary?.reserve).toBe(180);
  });

  it('never adds a knife as a pickup', () => {
    const player = makePlayer();
    const result = addWeapon(player, 'knife');
    expect(result.added).toBe(false);
    expect(player.inventory.knife.id).toBe('knife');
  });

  it('drops primary and secondary but keeps the knife', () => {
    const player = makePlayer();
    addWeapon(player, 'ak47');
    addWeapon(player, 'hegrenade');
    const dropped = dropWeapons(player);
    expect(dropped.map((weapon) => weapon.id)).toEqual(['ak47', 'glock', 'hegrenade']);
    expect(player.inventory.primary).toBeNull();
    expect(player.inventory.secondary).toBeNull();
    expect(player.inventory.grenade).toBeNull();
    expect(player.inventory.knife.id).toBe('knife');
    expect(player.activeSlot).toBe('knife');
  });

  it('reloads from reserve and finishes at the right time', () => {
    const player = makePlayer();
    const weapon = getActiveWeapon(player);
    weapon.ammo = 2;
    expect(startReload(player, 1_000)).toBe(true);
    expect(player.reloadingUntil).toBe(1_000 + 2_200);
    expect(finishReloadIfDue(player, 2_000)).toBe(false);
    expect(finishReloadIfDue(player, 3_100)).toBe(false);
    expect(finishReloadIfDue(player, 3_200)).toBe(true);
    expect(weapon.ammo).toBe(20);
    expect(weapon.reserve).toBe(102);
    expect(player.reloadingUntil).toBeNull();
  });

  it('does not reload full weapons or empty reserve', () => {
    const player = makePlayer();
    expect(startReload(player, 1_000)).toBe(false);
    const weapon = getActiveWeapon(player);
    weapon.ammo = 0;
    weapon.reserve = 0;
    expect(startReload(player, 1_000)).toBe(false);
  });

  it('cancels a reload when switching weapons', () => {
    const player = makePlayer();
    const weapon = getActiveWeapon(player);
    weapon.ammo = 0;
    startReload(player, 1_000);
    switchWeapon(player, 'knife');
    expect(player.reloadingUntil).toBeNull();
    expect(player.reloadWeapon).toBeNull();
  });

  it('enforces fire rate and consumes ammo', () => {
    const player = makePlayer();
    const first = consumeShot(player, 1_000);
    expect(first.ok).toBe(true);
    expect(first.weapon.ammo).toBe(19);
    const tooSoon = consumeShot(player, 1_050);
    expect(tooSoon.ok).toBe(false);
    const later = consumeShot(player, 1_300);
    expect(later.ok).toBe(true);
    expect(later.weapon.ammo).toBe(18);
  });

  it('lets the knife swing forever without ammo', () => {
    const player = makePlayer();
    switchWeapon(player, 'knife');
    expect(consumeShot(player, 1_000).ok).toBe(true);
    expect(consumeShot(player, 1_600).ok).toBe(true);
    expect(getActiveWeapon(player).ammo).toBe(0);
  });

  it('blocks firing while reloading and when empty', () => {
    const player = makePlayer();
    const weapon = getActiveWeapon(player);
    weapon.ammo = 0;
    expect(consumeShot(player, 1_000).ok).toBe(false);
    weapon.ammo = 2;
    startReload(player, 1_000);
    expect(consumeShot(player, 1_500).ok).toBe(false);
    cancelReload(player);
    expect(consumeShot(player, 1_500).ok).toBe(true);
  });
});
