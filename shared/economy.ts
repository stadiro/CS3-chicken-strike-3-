import type { WeaponId } from './weapons';

export type Side = 't' | 'ct';
export type MatchMode = 'arena' | 'buy';

export function isEconomyMode(mode: MatchMode): boolean {
  return mode === 'buy';
}

export type BuyCategory = 'pistols' | 'smgs' | 'rifles' | 'heavy' | 'grenades' | 'gear';

export const GRENADE_LIMITS = {
  flashbang: 2,
  hegrenade: 1,
  smokegrenade: 1,
  molotov: 1,
  incendiary: 1,
} as const;

export type GrenadeType = keyof typeof GRENADE_LIMITS;
export const MAX_GRENADES = 4;

export const ECONOMY = {
  startMoney: 800,
  maxMoney: 16_000,
  winReward: 3_250,
  bombWinReward: 3_500,
  lossBonus: [1_400, 1_900, 2_400, 2_900, 3_400] as const,
  plantReward: 500,
  defuseReward: 300,
  helmetUpgrade: 350,
  killReward: {
    knife: 1_500,
    glock: 300,
    usp: 300,
    p250: 300,
    fiveseven: 300,
    tec9: 300,
    deagle: 300,
    dualberettas: 300,
    mp9: 600,
    mac10: 600,
    mp5: 600,
    p90: 300,
    ak47: 300,
    m4a1: 300,
    galil: 300,
    famas: 300,
    sg553: 300,
    aug: 300,
    ssg08: 300,
    awp: 100,
    m249: 300,
    hegrenade: 300,
    flashbang: 300,
    smokegrenade: 300,
    molotov: 300,
    incendiary: 300,
  } as Record<WeaponId, number>,
} as const;

export function getBuyPrice(item: BuyItem, armor: number, helmet: boolean): number {
  if (item.gear === 'kevlar_helmet' && armor >= 100 && !helmet) {
    return ECONOMY.helmetUpgrade;
  }
  return item.price;
}

export const BUY = {
  freezeTimeMs: 8_000,
  roundTimeMs: 115_000,
  buyTimeMs: 20_000,
  buyZoneRadius: 7.5,
  roundsToWin: 13,
  regulationRounds: 24,
  sideSwapAfterRound: 12,
} as const;

export interface BuyItem {
  id: string;
  name: string;
  category: BuyCategory;
  price: number;
  side: Side | 'both';
  weapon?: WeaponId;
  gear?: 'kevlar' | 'kevlar_helmet' | 'defuse_kit';
}

const weaponItem = (
  id: BuyItem['id'],
  name: string,
  category: BuyCategory,
  price: number,
  side: BuyItem['side'],
  weapon: WeaponId,
): BuyItem => ({ id, name, category, price, side, weapon });

const gearItem = (
  id: BuyItem['id'],
  name: string,
  price: number,
  side: BuyItem['side'],
  gear: NonNullable<BuyItem['gear']>,
): BuyItem => ({ id, name, category: 'gear', price, side, gear });

export const BUY_ITEMS: readonly BuyItem[] = [
  weaponItem('glock', 'Glock-18', 'pistols', 200, 't', 'glock'),
  weaponItem('usp', 'USP-S', 'pistols', 200, 'ct', 'usp'),
  weaponItem('p250', 'P250', 'pistols', 300, 'both', 'p250'),
  weaponItem('fiveseven', 'Five-SeveN', 'pistols', 500, 'ct', 'fiveseven'),
  weaponItem('tec9', 'Tec-9', 'pistols', 500, 't', 'tec9'),
  weaponItem('deagle', 'Desert Eagle', 'pistols', 700, 'both', 'deagle'),
  weaponItem('dualberettas', 'Dual Berettas', 'pistols', 300, 'both', 'dualberettas'),

  weaponItem('mp9', 'MP9', 'smgs', 1_250, 'ct', 'mp9'),
  weaponItem('mac10', 'MAC-10', 'smgs', 1_050, 't', 'mac10'),
  weaponItem('mp5', 'MP5-SD', 'smgs', 1_500, 'both', 'mp5'),
  weaponItem('p90', 'P90', 'smgs', 2_350, 'both', 'p90'),

  weaponItem('galil', 'Galil AR', 'rifles', 1_800, 't', 'galil'),
  weaponItem('famas', 'FAMAS', 'rifles', 2_050, 'ct', 'famas'),
  weaponItem('ak47', 'AK-47', 'rifles', 2_700, 't', 'ak47'),
  weaponItem('m4a1', 'M4A1', 'rifles', 3_100, 'ct', 'm4a1'),
  weaponItem('sg553', 'SG 553', 'rifles', 3_000, 't', 'sg553'),
  weaponItem('aug', 'AUG', 'rifles', 3_300, 'ct', 'aug'),
  weaponItem('ssg08', 'SSG 08', 'rifles', 1_700, 'both', 'ssg08'),
  weaponItem('awp', 'AWP', 'rifles', 4_750, 'both', 'awp'),

  weaponItem('m249', 'M249', 'smgs', 5_200, 'both', 'm249'),

  weaponItem('flashbang', 'Flashbang', 'grenades', 200, 'both', 'flashbang'),
  weaponItem('smokegrenade', 'Smoke Grenade', 'grenades', 300, 'both', 'smokegrenade'),
  weaponItem('hegrenade', 'HE Grenade', 'grenades', 300, 'both', 'hegrenade'),
  weaponItem('molotov', 'Molotov', 'grenades', 400, 't', 'molotov'),
  weaponItem('incendiary', 'Incendiary', 'grenades', 500, 'ct', 'incendiary'),

  gearItem('kevlar', 'Kevlar Vest', 650, 'both', 'kevlar'),
  gearItem('kevlar_helmet', 'Kevlar + Helmet', 1_000, 'both', 'kevlar_helmet'),
  gearItem('defuse_kit', 'Defuse Kit', 400, 'ct', 'defuse_kit'),
];

export type BuyItemId = (typeof BUY_ITEMS)[number]['id'];

export const BUY_ITEM_MAP: Record<string, BuyItem> = Object.fromEntries(
  BUY_ITEMS.map((item) => [item.id, item]),
);

export const BUY_CATEGORY_LABELS: Record<BuyCategory, string> = {
  pistols: 'ПИСТОЛЕТЫ',
  smgs: 'ПП / ТЯЖЁЛОЕ',
  rifles: 'ВИНТОВКИ',
  heavy: 'ТЯЖЁЛОЕ',
  grenades: 'ГРАНАТЫ',
  gear: 'СНАРЯЖЕНИЕ',
};

export function isBuyItemId(value: unknown): value is BuyItemId {
  return typeof value === 'string' && value in BUY_ITEM_MAP;
}

export function getBuyItem(id: string): BuyItem | undefined {
  return BUY_ITEM_MAP[id];
}
