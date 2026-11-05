import type { Vec3 } from './math';

export interface CalloutZone {
  name: string;
  min: Vec3;
  max: Vec3;
  priority?: number;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// ---------------------------------------------------------------------------
// DE_DUST2 Callouts (CS2 Russian/English tournament standard)
// ---------------------------------------------------------------------------
const DUST2_CALLOUTS: CalloutZone[] = [
  // High-priority landmarks & specific spots
  { name: 'A PLANT (ПЛЕНТ A)', min: v(15.2, 2.0, -28.0), max: v(24.0, 5.5, -21.5), priority: 10 },
  { name: 'GOOSE (ГУСЬ)', min: v(24.0, 2.0, -31.5), max: v(30.0, 5.0, -26.0), priority: 9 },
  { name: 'B PLANT (ПЛЕНТ B)', min: v(-25.2, 0.9, -24.2), max: v(-17.8, 4.5, -14.8), priority: 10 },
  { name: 'B WINDOW (ОКНО B)', min: v(-18.5, 2.5, -27.5), max: v(-13.5, 5.5, -23.0), priority: 9 },
  { name: 'B DOORS (ДВЕРИ B)', min: v(-18.0, 1.0, -18.0), max: v(-13.0, 4.5, -13.0), priority: 9 },
  { name: 'MID DOORS (ДВЕРИ МИД)', min: v(-3.5, 0.0, -4.0), max: v(1.5, 4.0, -0.5), priority: 9 },
  { name: 'XBOX (ИКСБОКС)', min: v(0.0, 0.0, -2.0), max: v(2.5, 3.0, 1.2), priority: 9 },
  { name: 'PIT (ЯМА)', min: v(23.5, -0.5, 3.0), max: v(32.5, 2.5, 13.0), priority: 9 },
  { name: 'BANKA (ТЕМКА ЛОНГ)', min: v(15.0, 1.2, 1.5), max: v(20.5, 4.5, 13.0), priority: 9 },
  { name: 'VINT (ВИНТ)', min: v(-16.0, 0.0, 3.0), max: v(-9.5, 3.0, 7.0), priority: 9 },
  { name: 'LOWER TUNNELS (ТЕМКА НИЗ)', min: v(-16.0, -0.5, -3.5), max: v(-5.0, 2.5, 3.0), priority: 8 },
  { name: 'SHORT BRIDGE (МОСТ КТ)', min: v(5.5, 2.0, -20.5), max: v(14.5, 5.0, -16.5), priority: 8 },
  { name: 'CT SPAWN (СПАВН КТ)', min: v(1.0, -0.5, -24.0), max: v(15.0, 2.0, -16.0), priority: 7 },
  { name: 'DALNIY (ДАЛЬНИЙ B)', min: v(-32.5, 1.2, -32.5), max: v(-18.5, 3.5, -25.0), priority: 8 },
  { name: 'TANCPOL (ТАНЦПОЛ B)', min: v(-31.5, 1.0, -25.0), max: v(-25.0, 3.5, -16.5), priority: 8 },
  { name: 'B CAR (МАШИНА B)', min: v(-32.0, 1.0, -16.5), max: v(-26.5, 3.5, -11.0), priority: 8 },
  { name: 'B TUNNEL EXIT (ВЫХОД НА B)', min: v(-29.5, 0.0, -11.5), max: v(-24.5, 3.0, -4.0), priority: 8 },
  { name: 'UPPER TUNNELS (ТЕМКА ВЕРХ)', min: v(-33.0, 1.0, -4.0), max: v(-15.0, 4.0, 6.5), priority: 7 },
  { name: 'TITANIC (ТИТАНИК)', min: v(-23.0, 2.0, 21.0), max: v(-13.0, 4.5, 28.0), priority: 8 },
  { name: 'PESKI (ПЕСКИ)', min: v(-31.0, 1.0, 6.0), max: v(-17.0, 3.5, 21.0), priority: 7 },
  { name: 'T SPAWN (СПАВН Т)', min: v(-16.0, 2.0, 23.0), max: v(14.0, 5.0, 33.0), priority: 6 },
  { name: 'SUICIDE (СУИЦИД)', min: v(-3.0, 0.0, 16.0), max: v(3.0, 2.5, 24.0), priority: 8 },
  { name: 'TOP MID (ПАЛЬМА)', min: v(-5.0, 1.0, 8.0), max: v(3.0, 3.0, 16.0), priority: 7 },
  { name: 'CATWALK (ПАРАПЕТ)', min: v(1.5, 1.0, 2.0), max: v(6.5, 3.0, 9.5), priority: 8 },
  { name: 'ZIGA (ЗИГА)', min: v(4.5, 1.5, -5.0), max: v(8.5, 3.5, 2.0), priority: 8 },
  { name: 'SHORT A (ШОРТ A)', min: v(6.5, 1.8, -16.5), max: v(15.2, 4.0, -5.0), priority: 7 },
  { name: 'LONG DOORS (ДВЕРИ ЛОНГ)', min: v(16.5, 1.2, -4.0), max: v(23.5, 4.0, 2.0), priority: 8 },
  { name: 'LONG A (ДЛИНА A)', min: v(23.5, 1.2, -18.0), max: v(32.5, 3.5, 3.0), priority: 7 },
  { name: 'PROSVET (ПРОСВЕТ ЛОНГ)', min: v(16.5, 1.2, -21.5), max: v(24.0, 4.0, -16.0), priority: 8 },
  { name: 'PLOSCHAD (ПЛОЩАДЬ Т)', min: v(12.0, 1.0, 12.0), max: v(24.0, 3.5, 24.0), priority: 7 },
  { name: 'MID (МИД)', min: v(-6.0, -0.5, -1.0), max: v(2.5, 2.5, 9.0), priority: 6 },
  { name: 'CT MID (КТ МИД)', min: v(-8.0, -0.5, -16.0), max: v(2.0, 2.5, -4.0), priority: 6 },
  { name: 'B SLOPE (ПОДЪЁМ НА B)', min: v(-15.5, 0.0, -28.0), max: v(-5.5, 3.0, -11.0), priority: 6 },
];

// ---------------------------------------------------------------------------
// FY_SAND Callouts
// ---------------------------------------------------------------------------
const SAND_CALLOUTS: CalloutZone[] = [
  { name: 'ALPHA BASE (СПАВН Т)', min: v(-22.0, 0.0, -6.0), max: v(-14.0, 4.0, 6.0), priority: 8 },
  { name: 'BRAVO BASE (СПАВН КТ)', min: v(14.0, 0.0, -6.0), max: v(22.0, 4.0, 6.0), priority: 8 },
  { name: 'TOP BUILDING (ВЕРХНЕЕ ЗДАНИЕ)', min: v(3.0, 0.0, -12.0), max: v(13.5, 7.5, -2.5), priority: 9 },
  { name: 'BOTTOM BUILDING (НИЖНЕЕ ЗДАНИЕ)', min: v(-13.5, 0.0, 2.5), max: v(-3.0, 7.5, 12.0), priority: 9 },
  { name: 'NORTH ALLEY (СЕВЕРНЫЙ ПРОХОД)', min: v(-14.0, 0.0, -16.6), max: v(14.0, 4.0, -11.0), priority: 7 },
  { name: 'SOUTH ALLEY (ЮЖНЫЙ ПРОХОД)', min: v(-14.0, 0.0, 11.0), max: v(14.0, 4.0, 16.6), priority: 7 },
  { name: 'CENTER YARD (ЦЕНТР)', min: v(-8.0, 0.0, -6.0), max: v(8.0, 4.0, 6.0), priority: 6 },
  { name: 'WEST LANE (ЛЕВЫЙ ФЛАНГ)', min: v(-22.0, 0.0, -16.6), max: v(-12.0, 4.0, 16.6), priority: 5 },
  { name: 'EAST LANE (ПРАВЫЙ ФЛАНГ)', min: v(12.0, 0.0, -16.6), max: v(22.0, 4.0, 16.6), priority: 5 },
];

// ---------------------------------------------------------------------------
// FY_WOW Callouts
// ---------------------------------------------------------------------------
const WOW_CALLOUTS: CalloutZone[] = [
  { name: 'ALPHA BASE (СПАВН Т)', min: v(-20.0, 0.0, -8.0), max: v(-12.0, 4.0, 8.0), priority: 8 },
  { name: 'BRAVO BASE (СПАВН КТ)', min: v(12.0, 0.0, -8.0), max: v(20.0, 4.0, 8.0), priority: 8 },
  { name: 'NORTH PASSAGE (ВЕРХ)', min: v(-20.0, 0.0, -20.0), max: v(20.0, 4.0, -10.0), priority: 7 },
  { name: 'SOUTH PASSAGE (НИЗ)', min: v(-20.0, 0.0, 10.0), max: v(20.0, 4.0, 20.0), priority: 7 },
  { name: 'CENTER ARENA (ЦЕНТР)', min: v(-10.0, 0.0, -10.0), max: v(10.0, 4.0, 10.0), priority: 6 },
  { name: 'WEST FLANK', min: v(-20.0, 0.0, -10.0), max: v(-10.0, 4.0, 10.0), priority: 5 },
  { name: 'EAST FLANK', min: v(10.0, 0.0, -10.0), max: v(20.0, 4.0, 10.0), priority: 5 },
];

const MAP_CALLOUTS: Record<string, CalloutZone[]> = {
  de_dust2: DUST2_CALLOUTS,
  fy_sand: SAND_CALLOUTS,
  fy_wow: WOW_CALLOUTS,
};

const DEFAULT_MAP_NAMES: Record<string, string> = {
  de_dust2: 'DUST II',
  fy_sand: 'FY SAND',
  fy_wow: 'FY WOW',
};

function pointInAabb(pos: Vec3, min: Vec3, max: Vec3): boolean {
  return (
    pos.x >= min.x &&
    pos.x <= max.x &&
    pos.z >= min.z &&
    pos.z <= max.z &&
    pos.y >= min.y - 0.5 &&
    pos.y <= max.y + 0.5
  );
}

function aabbVolume(min: Vec3, max: Vec3): number {
  return Math.max(0.1, (max.x - min.x) * (max.y - min.y) * (max.z - min.z));
}

/**
 * Returns the CS2 location callout name for a player's position on the given map.
 */
export function getCalloutName(mapId: string, pos: Vec3): string {
  const list = MAP_CALLOUTS[mapId] ?? DUST2_CALLOUTS;
  let bestMatch: CalloutZone | null = null;
  let bestPriority = -1;
  let bestVolume = Number.POSITIVE_INFINITY;

  for (const zone of list) {
    if (pointInAabb(pos, zone.min, zone.max)) {
      const priority = zone.priority ?? 0;
      const volume = aabbVolume(zone.min, zone.max);
      if (priority > bestPriority || (priority === bestPriority && volume < bestVolume)) {
        bestMatch = zone;
        bestPriority = priority;
        bestVolume = volume;
      }
    }
  }

  if (bestMatch !== null) {
    return bestMatch.name;
  }
  return DEFAULT_MAP_NAMES[mapId] ?? 'ARENA';
}
