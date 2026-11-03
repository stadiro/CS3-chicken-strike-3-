import { GRENADE_LIMITS, type GrenadeType } from './economy';

export type WeaponId =
  | 'knife'
  | 'glock'
  | 'usp'
  | 'p250'
  | 'fiveseven'
  | 'tec9'
  | 'deagle'
  | 'dualberettas'
  | 'mp9'
  | 'mac10'
  | 'mp5'
  | 'p90'
  | 'ak47'
  | 'm4a1'
  | 'galil'
  | 'famas'
  | 'sg553'
  | 'aug'
  | 'ssg08'
  | 'awp'
  | 'm249'
  | 'hegrenade'
  | 'flashbang'
  | 'smokegrenade'
  | 'molotov'
  | 'incendiary';

export type WeaponSlot = 'primary' | 'secondary' | 'knife' | 'grenade';

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  slot: WeaponSlot;
  damage: number;
  /** Fraction of incoming damage that penetrates body armor. */
  armorRatio: number;
  /** Damage multiplier per 500 Hammer units (12.8 game units). */
  rangeModifier: number;
  rpm: number;
  magazine: number;
  reserve: number;
  reloadMs: number;
  weight: number;
  spread: number;
  /** Optional unscoped spread for scoped weapons. */
  unscopedSpread?: number;
  moveSpread: number;
  recoil: number;
  range: number;
  automatic: boolean;
  pellets: number;
  color: number;
  /** Scoped weapons use the right mouse button. */
  scoped?: boolean;
}

const pistol = (
  id: WeaponId,
  name: string,
  damage: number,
  armorRatio: number,
  rpm: number,
  magazine: number,
  reserve: number,
  reloadMs: number,
  spread: number,
  moveSpread: number,
  recoil: number,
  range: number,
  color: number,
  automatic = false,
): WeaponDefinition => ({
  id,
  name,
  slot: 'secondary',
  damage,
  armorRatio,
  rangeModifier: 0.75,
  rpm,
  magazine,
  reserve,
  reloadMs,
  weight: 0.96,
  spread,
  moveSpread,
  recoil,
  range,
  automatic,
  pellets: 1,
  color,
});

const smg = (
  id: WeaponId,
  name: string,
  damage: number,
  armorRatio: number,
  rpm: number,
  magazine: number,
  reserve: number,
  reloadMs: number,
  spread: number,
  moveSpread: number,
  recoil: number,
  range: number,
  color: number,
): WeaponDefinition => ({
  id,
  name,
  slot: 'primary',
  damage,
  armorRatio,
  rangeModifier: 0.84,
  rpm,
  magazine,
  reserve,
  reloadMs,
  weight: 0.94,
  spread,
  moveSpread,
  recoil,
  range,
  automatic: true,
  pellets: 1,
  color,
});

const rifle = (
  id: WeaponId,
  name: string,
  damage: number,
  armorRatio: number,
  rpm: number,
  magazine: number,
  reserve: number,
  reloadMs: number,
  spread: number,
  moveSpread: number,
  recoil: number,
  range: number,
  color: number,
): WeaponDefinition => ({
  id,
  name,
  slot: 'primary',
  damage,
  armorRatio,
  rangeModifier: 0.98,
  rpm,
  magazine,
  reserve,
  reloadMs,
  weight: 0.88,
  spread,
  moveSpread,
  recoil,
  range,
  automatic: true,
  pellets: 1,
  color,
});

const grenade = (
  id: GrenadeType,
  name: string,
  damage: number,
  color: number,
): WeaponDefinition => ({
  id,
  name,
  slot: 'grenade',
  damage,
  armorRatio: 0.5,
  rangeModifier: 1,
  rpm: 60,
  magazine: GRENADE_LIMITS[id],
  reserve: 0,
  reloadMs: 0,
  weight: 1,
  spread: 0,
  moveSpread: 0,
  recoil: 0,
  range: 0,
  automatic: false,
  pellets: 0,
  color,
});

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  knife: {
    id: 'knife',
    name: 'Нож',
    slot: 'knife',
    damage: 65,
    armorRatio: 0.85,
    rangeModifier: 1,
    rpm: 120,
    magazine: 0,
    reserve: 0,
    reloadMs: 0,
    weight: 1.08,
    spread: 0.012,
    moveSpread: 0.02,
    recoil: 0.01,
    range: 2.2,
    automatic: false,
    pellets: 1,
    color: 0xc7d2de,
  },
  glock: pistol(
    'glock',
    'Glock-18',
    30,
    0.47,
    400,
    20,
    120,
    2200,
    0.006,
    0.04,
    0.012,
    60,
    0x8a8f98,
  ),
  usp: pistol('usp', 'USP-S', 35, 0.505, 352, 12, 100, 2700, 0.004, 0.032, 0.018, 65, 0x6f7a86),
  p250: pistol('p250', 'P250', 38, 0.645, 400, 13, 26, 2200, 0.006, 0.036, 0.016, 60, 0x7e8794),
  fiveseven: pistol(
    'fiveseven',
    'Five-SeveN',
    32,
    0.655,
    400,
    20,
    100,
    2700,
    0.005,
    0.032,
    0.014,
    65,
    0x8f9aa8,
  ),
  tec9: pistol('tec9', 'Tec-9', 33, 0.907, 500, 18, 90, 2200, 0.009, 0.045, 0.014, 60, 0x6f6a5b),
  deagle: pistol(
    'deagle',
    'Desert Eagle',
    63,
    0.931,
    267,
    7,
    35,
    2200,
    0.004,
    0.035,
    0.028,
    80,
    0xd6a95c,
  ),
  dualberettas: pistol(
    'dualberettas',
    'Dual Berettas',
    38,
    0.575,
    500,
    30,
    120,
    2200,
    0.008,
    0.04,
    0.014,
    60,
    0x9aa4b2,
  ),
  mp9: smg('mp9', 'MP9', 26, 0.605, 857, 30, 120, 2100, 0.007, 0.034, 0.012, 75, 0x5b6b7d),
  mac10: smg('mac10', 'MAC-10', 29, 0.575, 800, 30, 100, 2450, 0.009, 0.038, 0.014, 70, 0x5f6470),
  mp5: smg('mp5', 'MP5-SD', 27, 0.625, 750, 30, 120, 2630, 0.006, 0.033, 0.011, 75, 0x6b7c8f),
  p90: smg('p90', 'P90', 26, 0.69, 857, 50, 100, 3400, 0.009, 0.034, 0.013, 80, 0x5a6a78),
  ak47: rifle('ak47', 'AK-47', 36, 0.775, 600, 30, 90, 2450, 0.006, 0.055, 0.022, 110, 0xb07745),
  m4a1: rifle('m4a1', 'M4A1', 33, 0.7, 666, 30, 90, 3050, 0.005, 0.048, 0.018, 110, 0x5c6773),
  galil: rifle(
    'galil',
    'Galil AR',
    30,
    0.775,
    666,
    35,
    90,
    3000,
    0.007,
    0.052,
    0.02,
    105,
    0x8b7355,
  ),
  famas: rifle('famas', 'FAMAS', 30, 0.7, 666, 25, 90, 3200, 0.006, 0.05, 0.019, 105, 0x5f6f6a),
  sg553: rifle('sg553', 'SG 553', 30, 0.7, 545, 30, 90, 3000, 0.006, 0.052, 0.021, 110, 0x4c5b4a),
  aug: rifle('aug', 'AUG', 28, 0.7, 666, 30, 90, 3200, 0.005, 0.048, 0.018, 110, 0x6a6f5b),
  ssg08: {
    ...rifle('ssg08', 'SSG 08', 88, 0.85, 48, 10, 90, 3700, 0.002, 0.1, 0.05, 150, 0x4d5f72),
    rangeModifier: 0.99,
    automatic: false,
    unscopedSpread: 0.06,
    scoped: true,
  },
  awp: {
    ...rifle('awp', 'AWP', 115, 0.975, 41, 10, 30, 2500, 0.0008, 0.14, 0.09, 160, 0x3f6b57),
    rangeModifier: 0.99,
    automatic: false,
    unscopedSpread: 0.07,
    scoped: true,
  },
  m249: {
    ...rifle('m249', 'M249', 32, 0.75, 750, 100, 200, 4700, 0.012, 0.075, 0.024, 105, 0x4f6b4f),
    weight: 0.88,
  },
  hegrenade: grenade('hegrenade', 'HE граната', 85, 0x5f7f4a),
  flashbang: grenade('flashbang', 'Flashbang', 1, 0xd6d6d6),
  smokegrenade: grenade('smokegrenade', 'Smoke Grenade', 1, 0x7f8a8f),
  molotov: grenade('molotov', 'Molotov', 20, 0xd2693d),
  incendiary: grenade('incendiary', 'Incendiary', 20, 0xff7a3d),
};

export const WEAPON_IDS: readonly WeaponId[] = [
  'knife',
  'glock',
  'usp',
  'p250',
  'fiveseven',
  'tec9',
  'deagle',
  'dualberettas',
  'mp9',
  'mac10',
  'mp5',
  'p90',
  'ak47',
  'm4a1',
  'galil',
  'famas',
  'sg553',
  'aug',
  'ssg08',
  'awp',
  'm249',
  'hegrenade',
  'flashbang',
  'smokegrenade',
  'molotov',
  'incendiary',
];

export const GRENADE_WEAPON_IDS: readonly GrenadeType[] = [
  'hegrenade',
  'flashbang',
  'smokegrenade',
  'molotov',
  'incendiary',
];

export const PICKUP_WEAPON_IDS: readonly WeaponId[] = [
  'glock',
  'usp',
  'p250',
  'fiveseven',
  'tec9',
  'deagle',
  'dualberettas',
  'mp9',
  'mac10',
  'mp5',
  'p90',
  'ak47',
  'm4a1',
  'galil',
  'famas',
  'sg553',
  'aug',
  'ssg08',
  'awp',
  'm249',
  'hegrenade',
  'flashbang',
  'smokegrenade',
  'molotov',
  'incendiary',
];

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && (WEAPON_IDS as readonly string[]).includes(value);
}

export function isGrenadeWeapon(value: unknown): value is GrenadeType {
  return typeof value === 'string' && (GRENADE_WEAPON_IDS as readonly string[]).includes(value);
}

export function isScopedWeapon(value: WeaponId): boolean {
  return WEAPONS[value].scoped === true;
}

export function isWeaponSlot(value: unknown): value is WeaponSlot {
  return value === 'primary' || value === 'secondary' || value === 'knife' || value === 'grenade';
}

export function getWeapon(id: WeaponId): WeaponDefinition {
  return WEAPONS[id];
}

/**
 * CS 1.6 applies the range modifier once per 500 Hammer units. The game uses
 * 1 game unit = 39.0625 Hammer units, so one range step is 12.8 game units.
 */
export function damageAtDistance(definition: WeaponDefinition, distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0 || definition.rangeModifier >= 1) {
    return definition.damage;
  }
  return definition.damage * Math.pow(definition.rangeModifier, distance / 12.8);
}
