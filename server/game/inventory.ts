import { GRENADE_LIMITS, MAX_GRENADES, type GrenadeType, type Side } from '../../shared/economy';
import type { Team } from '../../shared/protocol';
import {
  getWeapon,
  GRENADE_WEAPON_IDS,
  type WeaponId,
  type WeaponSlot,
} from '../../shared/weapons';
import type { Inventory, PlayerState, WeaponInstance } from './types';

export function createWeaponInstance(id: WeaponId): WeaponInstance {
  const definition = getWeapon(id);
  return {
    id,
    ammo: definition.magazine,
    reserve: definition.reserve,
  };
}

export function createDefaultInventory(sideOrTeam: Team | Side = 'alpha'): Inventory {
  const ct = sideOrTeam === 'bravo' || sideOrTeam === 'ct';
  return {
    primary: null,
    secondary: createWeaponInstance(ct ? 'usp' : 'glock'),
    knife: createWeaponInstance('knife'),
    grenade: null,
    grenadeCounts: {},
  };
}

export function getActiveWeapon(player: PlayerState): WeaponInstance {
  const active = player.inventory[player.activeSlot];
  return active ?? player.inventory.knife;
}

export function cancelReload(player: PlayerState): void {
  player.reloadingUntil = null;
  player.reloadWeapon = null;
}

export function getGrenadeCount(player: PlayerState, type: GrenadeType): number {
  return player.grenadeCounts[type] ?? 0;
}

export function getTotalGrenades(player: PlayerState): number {
  return Object.values(player.grenadeCounts).reduce((total, count) => total + (count ?? 0), 0);
}

export function getOwnedGrenadeTypes(player: PlayerState): GrenadeType[] {
  return GRENADE_WEAPON_IDS.filter((type) => getGrenadeCount(player, type) > 0);
}

export function syncGrenadeSlot(player: PlayerState, preferred?: GrenadeType): void {
  const owned = getOwnedGrenadeTypes(player);
  if (owned.length === 0) {
    player.inventory.grenade = null;
    player.grenadeCounts = {};
    if (player.activeSlot === 'grenade') {
      player.activeSlot =
        player.inventory.primary !== null
          ? 'primary'
          : player.inventory.secondary !== null
            ? 'secondary'
            : 'knife';
    }
    return;
  }

  const type =
    preferred !== undefined && getGrenadeCount(player, preferred) > 0 ? preferred : owned[0];
  if (type === undefined) {
    player.inventory.grenade = null;
    return;
  }
  player.inventory.grenade = {
    id: type,
    ammo: getGrenadeCount(player, type),
    reserve: 0,
  };
}

export function cycleGrenade(player: PlayerState): boolean {
  const owned = getOwnedGrenadeTypes(player);
  if (owned.length <= 1) {
    return false;
  }
  const current = player.inventory.grenade?.id;
  const index = current === undefined ? -1 : owned.indexOf(current as GrenadeType);
  const next = owned[(index + 1) % owned.length];
  if (next === undefined) {
    return false;
  }
  syncGrenadeSlot(player, next);
  return true;
}

export function canAddGrenade(player: PlayerState, type: GrenadeType): boolean {
  const count = getGrenadeCount(player, type);
  return count < GRENADE_LIMITS[type] && getTotalGrenades(player) < MAX_GRENADES;
}

export function addGrenade(player: PlayerState, type: GrenadeType): boolean {
  if (!canAddGrenade(player, type)) {
    return false;
  }
  player.grenadeCounts[type] = getGrenadeCount(player, type) + 1;
  syncGrenadeSlot(player, type);
  return true;
}

export function removeGrenade(player: PlayerState, type: GrenadeType): boolean {
  const count = getGrenadeCount(player, type);
  if (count <= 0) {
    return false;
  }
  if (count <= 1) {
    delete player.grenadeCounts[type];
  } else {
    player.grenadeCounts[type] = count - 1;
  }
  syncGrenadeSlot(player, type);
  return true;
}

export function switchWeapon(player: PlayerState, slot: WeaponSlot): boolean {
  if (slot === 'grenade') {
    if (getOwnedGrenadeTypes(player).length === 0) {
      return false;
    }
    if (player.activeSlot === 'grenade') {
      return cycleGrenade(player);
    }
    player.activeSlot = 'grenade';
    syncGrenadeSlot(player);
    player.sprayShots = 0;
    cancelReload(player);
    return true;
  }

  if (slot !== 'knife' && player.inventory[slot] === null) {
    return false;
  }
  if (player.activeSlot === slot) {
    return false;
  }
  player.activeSlot = slot;
  player.sprayShots = 0;
  cancelReload(player);
  return true;
}

export interface AddWeaponResult {
  added: boolean;
  replaced: WeaponInstance | null;
  sameWeapon: boolean;
}

export function addWeapon(
  player: PlayerState,
  weaponId: WeaponId,
  ammo?: number,
  reserve?: number,
): AddWeaponResult {
  const definition = getWeapon(weaponId);
  if (definition.slot === 'knife') {
    return { added: false, replaced: null, sameWeapon: false };
  }

  if (definition.slot === 'grenade') {
    const added = addGrenade(player, weaponId as GrenadeType);
    return { added, replaced: null, sameWeapon: !added };
  }

  const incoming: WeaponInstance = {
    id: weaponId,
    ammo: ammo ?? definition.magazine,
    reserve: reserve ?? definition.reserve,
  };
  const slot = definition.slot;
  const existing = player.inventory[slot];

  if (existing !== null && existing.id === weaponId) {
    existing.reserve = Math.min(
      definition.reserve * 2,
      existing.reserve + incoming.ammo + incoming.reserve,
    );
    return { added: true, replaced: null, sameWeapon: true };
  }

  player.inventory[slot] = incoming;
  player.activeSlot = slot;
  player.sprayShots = 0;
  cancelReload(player);
  return { added: true, replaced: existing, sameWeapon: false };
}

export function dropWeapons(player: PlayerState): WeaponInstance[] {
  const dropped: WeaponInstance[] = [];
  if (player.inventory.primary !== null) {
    dropped.push(player.inventory.primary);
    player.inventory.primary = null;
  }
  if (player.inventory.secondary !== null) {
    dropped.push(player.inventory.secondary);
    player.inventory.secondary = null;
  }
  if (player.inventory.grenade !== null) {
    dropped.push(player.inventory.grenade);
  }
  player.inventory.grenade = null;
  player.grenadeCounts = {};
  player.activeSlot = 'knife';
  cancelReload(player);
  return dropped;
}

export function startReload(player: PlayerState, now: number): boolean {
  if (!player.alive || player.reloadingUntil !== null) {
    return false;
  }

  const weapon = getActiveWeapon(player);
  const definition = getWeapon(weapon.id);
  if (
    definition.slot === 'grenade' ||
    definition.magazine <= 0 ||
    weapon.ammo >= definition.magazine ||
    weapon.reserve <= 0
  ) {
    return false;
  }

  player.reloadingUntil = now + definition.reloadMs;
  player.reloadWeapon = weapon.id;
  player.sprayShots = 0;
  return true;
}

export function finishReloadIfDue(player: PlayerState, now: number): boolean {
  if (player.reloadingUntil === null) {
    return false;
  }
  if (now < player.reloadingUntil) {
    return false;
  }

  const weapon = getActiveWeapon(player);
  if (player.reloadWeapon !== weapon.id) {
    cancelReload(player);
    return false;
  }

  const definition = getWeapon(weapon.id);
  const needed = definition.magazine - weapon.ammo;
  const transferred = Math.min(needed, weapon.reserve);
  weapon.ammo += transferred;
  weapon.reserve -= transferred;
  cancelReload(player);
  return transferred > 0;
}

export interface ShotResult {
  ok: boolean;
  weapon: WeaponInstance;
}

export function consumeShot(player: PlayerState, now: number): ShotResult {
  const weapon = getActiveWeapon(player);
  if (!player.alive || player.reloadingUntil !== null) {
    return { ok: false, weapon };
  }

  const definition = getWeapon(weapon.id);
  const interval = 60_000 / definition.rpm;
  if (now - player.lastFireAt < interval) {
    return { ok: false, weapon };
  }
  if (definition.magazine > 0 && weapon.ammo <= 0) {
    return { ok: false, weapon };
  }

  player.lastFireAt = now;
  if (definition.magazine > 0) {
    weapon.ammo -= 1;
  }
  return { ok: true, weapon };
}
