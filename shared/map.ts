import { vec3, type Vec3 } from './math';
import type { MatchMode } from './economy';
import type { Team } from './protocol';
import type { WeaponId } from './weapons';

export type MapId = 'fy_wow' | 'fy_sand' | 'de_dust2';
export type MapBoxKind =
  'floor' | 'wall' | 'crate' | 'platform' | 'column' | 'ramp' | 'roof' | 'rock' | 'ladder';

export interface AngledDoorDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  thickness: number;
}

export const DUST2_ANGLED_DOORS: Record<string, AngledDoorDef> = {
  // Сайт Б (проем z = -16.8 .. -13.6, ширина 3.2 м, высота y = 1.2 .. 3.8):
  // Ось вращения каждой створки — строго край стены (z = -16.8 и z = -13.6).
  // Дальняя створка b-door-leaf-n (северная) открыта вглубь сайта Б (-X, угол ~34.2°).
  // Ближняя створка b-door-leaf-s (южная) открыта наружу в сторону КТ (+X, угол ~34.2°).
  // Длина створок увеличена до 1.51 м, угол увеличен, зазор при прямом просмотре уменьшен (S-образный проход 1.70 м).
  'b-door-leaf-n': { x0: -15.9, z0: -16.8, x1: -16.75, z1: -15.55, thickness: 0.12 },
  'b-door-leaf-s': { x0: -15.9, z0: -13.6, x1: -15.05, z1: -14.85, thickness: 0.12 },

  // Выход с КТ на мид (проем x = -2.6 .. 0.5, ширина 3.1 м, высота y = 0.0 .. 3.4):
  // Ось вращения створок — край стены (x = -2.6 и x = 0.5, z = -1.7).
  // Западная створка выдвинута вперед (в сторону Xbox/T, +Z, угол ~24.7°).
  // Восточная створка выдвинута назад (в сторону КТ мидла, -Z, угол ~24.7°).
  // Длина створок увеличена до 1.49 м, снайперская щель при прямом просмотре уменьшена до 0.40 м (S-образный проход 1.24 м).
  'mid-door-leaf-w': { x0: -2.6, z0: -1.7, x1: -1.25, z1: -1.08, thickness: 0.12 },
  'mid-door-leaf-e': { x0: 0.5, z0: -1.7, x1: -0.85, z1: -2.32, thickness: 0.12 },

  // Банка юг / вход с T (проем x = 16.0 .. 19.2, ширина 3.2 м, высота y = 1.6 .. 4.2):
  // Ось вращения — край стены (x = 16.0 и x = 19.2, z = 11.65).
  // Западная створка открыта внутрь банки (-Z, угол ~23.2°), восточная — наружу в сторону T (+Z, угол ~23.2°).
  // Длина створок увеличена до 1.52 м, зазор при прямом просмотре уменьшен до 0.40 м (S-образный проход 1.20 м).
  'banka-s-leaf-w': { x0: 16.0, z0: 11.65, x1: 17.4, z1: 11.05, thickness: 0.12 },
  'banka-s-leaf-e': { x0: 19.2, z0: 11.65, x1: 17.8, z1: 12.25, thickness: 0.12 },

  // Банка север / выход в лонг (проем x = 16.0 .. 19.2, ширина 3.2 м, высота y = 1.6 .. 4.2):
  // Ось вращения — край стены (x = 16.0 и x = 19.2, z = 2.85).
  // Западная створка открыта наружу в лонг (-Z, угол ~23.2°), восточная — внутрь банки (+Z, угол ~23.2°).
  // Длина створок увеличена до 1.52 м, зазор при прямом просмотре уменьшен до 0.40 м (S-образный проход 1.20 м).
  'banka-n-leaf-w': { x0: 16.0, z0: 2.85, x1: 17.4, z1: 2.25, thickness: 0.12 },
  'banka-n-leaf-e': { x0: 19.2, z0: 2.85, x1: 17.8, z1: 3.45, thickness: 0.12 },
};

export interface MapTheme {
  sky: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  ambient: string;
  accent: string;
  horizon: string;
}

export interface MapBox {
  id: string;
  min: Vec3;
  max: Vec3;
  color: string;
  kind: MapBoxKind;
}

export interface SpawnPoint {
  id: string;
  team: Team;
  position: Vec3;
  yaw: number;
}

export interface WeaponSpawnPoint {
  id: string;
  weapon: WeaponId;
  position: Vec3;
}

export interface ArmorSpawnPoint {
  id: string;
  amount: number;
  position: Vec3;
}

export type BombSiteId = 'A' | 'B';

export interface BombSite {
  id: BombSiteId;
  name: string;
  center: Vec3;
  min: Vec3;
  max: Vec3;
}

export interface ArenaMap {
  id: MapId;
  name: string;
  mode: MatchMode;
  size: number;
  sizeZ: number;
  height: number;
  boxes: MapBox[];
  spawns: SpawnPoint[];
  weaponSpawns: WeaponSpawnPoint[];
  armorSpawns: ArmorSpawnPoint[];
  bombSites: BombSite[];
  theme: MapTheme;
}

const DEFAULT_THEME: MapTheme = {
  sky: '#060a11',
  fog: '#060a11',
  fogNear: 30,
  fogFar: 92,
  sun: '#fff2d8',
  ambient: '#4cc9e8',
  accent: '#38bdf8',
  horizon: '#08111d',
};

const SAND_THEME: MapTheme = {
  sky: '#8fb9d3',
  fog: '#dcc39a',
  fogNear: 42,
  fogFar: 128,
  sun: '#fff0c9',
  ambient: '#b9d3df',
  accent: '#e8b86d',
  horizon: '#d3ae78',
};

function makeBox(id: string, min: Vec3, max: Vec3, color: string, kind: MapBoxKind): MapBox {
  return { id, min, max, color, kind };
}

function mirrorZ(source: MapBox, suffix: string): MapBox {
  return {
    id: `${source.id}-${suffix}`,
    min: vec3(source.min.x, source.min.y, -source.max.z),
    max: vec3(source.max.x, source.max.y, -source.min.z),
    color: source.color,
    kind: source.kind,
  };
}

function buildWowArena(): ArenaMap {
  const boxes: MapBox[] = [];

  const addBox = (id: string, min: Vec3, max: Vec3, color: string, kind: MapBoxKind): void => {
    boxes.push(makeBox(id, min, max, color, kind));
  };

  const addMirroredZ = (
    id: string,
    min: Vec3,
    max: Vec3,
    color: string,
    kind: MapBoxKind,
  ): void => {
    const north = makeBox(`${id}-n`, min, max, color, kind);
    boxes.push(north, mirrorZ(north, 's'));
  };

  const addQuad = (
    id: string,
    centerX: number,
    centerZ: number,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    color: string,
    kind: MapBoxKind,
    baseY = 0,
  ): void => {
    const halfX = sizeX / 2;
    const halfZ = sizeZ / 2;
    const positions: ReadonlyArray<readonly [number, number, string]> = [
      [centerX, centerZ, 'a'],
      [-centerX, centerZ, 'b'],
      [centerX, -centerZ, 'c'],
      [-centerX, -centerZ, 'd'],
    ];

    for (const [x, z, suffix] of positions) {
      addBox(
        `${id}-${suffix}`,
        vec3(x - halfX, baseY, z - halfZ),
        vec3(x + halfX, baseY + sizeY, z + halfZ),
        color,
        kind,
      );
    }
  };

  // Floor and outer walls.
  addBox('floor', vec3(-20, -0.5, -20), vec3(20, 0, 20), '#111827', 'floor');
  addBox('wall-north', vec3(-20.5, 0, -20.5), vec3(20.5, 6, -20), '#263449', 'wall');
  addBox('wall-south', vec3(-20.5, 0, 20), vec3(20.5, 6, 20.5), '#263449', 'wall');
  addBox('wall-west', vec3(-20.5, 0, -20.5), vec3(-20, 6, 20.5), '#263449', 'wall');
  addBox('wall-east', vec3(20, 0, -20.5), vec3(20.5, 6, 20.5), '#263449', 'wall');

  // Symmetrical team pads.
  addMirroredZ('base-pad', vec3(-5, 0, -19.2), vec3(5, 0.3, -16.5), '#1d3b5c', 'platform');

  // Spawn rooms: a solid wall faces the center so the opposite base cannot
  // see the spawn point. Players leave around the wall's outer edges.
  addMirroredZ('spawn-front', vec3(-5, 0.3, 16.3), vec3(5, 4.5, 16.7), '#263449', 'wall');

  // The center is intentionally open: no raised platform, ring or central crate.
  // Crates and columns, mirrored across both axes.
  addQuad('crate-mid', 10.5, 5.5, 1.8, 1.4, 1.8, '#4a6b8a', 'crate');
  addQuad('crate-base', 14.5, 14.5, 2.4, 1.6, 2.4, '#35536f', 'crate');
  addQuad('crate-low', 3.5, 10.5, 1.6, 1.2, 1.6, '#43627f', 'crate');
  addQuad('crate-tall', 8.5, 14.5, 1.4, 2.6, 1.4, '#2f4a63', 'crate');

  addQuad('column', 9, 9, 1.2, 4.5, 1.2, '#3f5a73', 'column');

  // Four cover walls form side lanes and leave the center open.
  addQuad('cover-wall', 12, 10, 0.8, 3.0, 6.0, '#2d4964', 'wall');
  addQuad('low-barrier', 6, 12.5, 3.0, 0.3, 0.6, '#4b6b88', 'crate');

  // Bomb site A (west) and B (east) tactical cover crates and mid-shields.
  addBox('site-a-crate', vec3(-16.0, 0, -0.8), vec3(-14.4, 1.5, 0.8), '#3b5c7a', 'crate');
  addBox('site-a-shield', vec3(-11.9, 0, -1.3), vec3(-11.3, 2.4, 1.3), '#2d4964', 'wall');
  addBox('site-b-crate', vec3(14.4, 0, -0.8), vec3(16.0, 1.5, 0.8), '#3b5c7a', 'crate');
  addBox('site-b-shield', vec3(11.3, 0, -1.3), vec3(11.9, 2.4, 1.3), '#2d4964', 'wall');

  const bombSites: BombSite[] = [
    {
      id: 'A',
      name: 'A',
      center: vec3(-15, 0, 0),
      min: vec3(-18.2, -0.1, -3.6),
      max: vec3(-12.2, 2.6, 3.6),
    },
    {
      id: 'B',
      name: 'B',
      center: vec3(15, 0, 0),
      min: vec3(12.2, -0.1, -3.6),
      max: vec3(18.2, 2.6, 3.6),
    },
  ];

  const spawns: SpawnPoint[] = [
    { id: 'alpha-1', team: 'alpha', position: vec3(-3, 0.31, -18), yaw: Math.PI },
    { id: 'alpha-2', team: 'alpha', position: vec3(3, 0.31, -18), yaw: Math.PI },
    { id: 'bravo-1', team: 'bravo', position: vec3(-3, 0.31, 18), yaw: 0 },
    { id: 'bravo-2', team: 'bravo', position: vec3(3, 0.31, 18), yaw: 0 },
  ];

  const weaponSpawns: WeaponSpawnPoint[] = [];

  return {
    id: 'fy_wow',
    name: 'fy_wow',
    mode: 'buy',
    size: 40,
    sizeZ: 40,
    height: 6,
    boxes,
    spawns,
    weaponSpawns,
    armorSpawns: [],
    bombSites,
    theme: DEFAULT_THEME,
  };
}

const SAND = {
  floor: '#c9a36b',
  floorAlt: '#bd9259',
  wall: '#b88752',
  wallDark: '#9f7045',
  wallLight: '#cfaa75',
  roof: '#7f5139',
  roofDark: '#68412e',
  crate: '#8d633e',
  crateLight: '#ad7f50',
  platform: '#c79a61',
  column: '#b07b4a',
  rock: '#a87b50',
} as const;

function buildSandArena(): ArenaMap {
  const boxes: MapBox[] = [];
  const addBox = (id: string, min: Vec3, max: Vec3, color: string, kind: MapBoxKind): void => {
    boxes.push(makeBox(id, min, max, color, kind));
  };

  // BSP fy_sand is 1728 x 1312 Hammer units. 1 game unit = 39.0625 Hammer
  // units (72 Hammer = 1.8 game units), so the arena is 43.2 x 32.8 units.
  // BSP origin is shifted to the middle of the map and Z=-192 is the floor.
  const ground = 0;
  const wall = SAND.wall;
  const wallDark = SAND.wallDark;
  const wallLight = SAND.wallLight;
  const roof = SAND.roof;
  const roofDark = SAND.roofDark;
  const crate = SAND.crate;
  const crateLight = SAND.crateLight;

  type Opening = { start: number; end: number; bottom: number; top: number };

  const addWallX = (
    id: string,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y0: number,
    y1: number,
    openings: readonly Opening[] = [],
    color: string = wall,
  ): void => {
    let cursor = x0;
    for (const opening of [...openings].sort((a, b) => a.start - b.start)) {
      const start = Math.max(x0, opening.start);
      const end = Math.min(x1, opening.end);
      if (end <= cursor) {
        continue;
      }
      if (start > cursor) {
        addBox(
          `${id}-${cursor.toFixed(2)}`,
          vec3(cursor, y0, z0),
          vec3(start, y1, z1),
          color,
          'wall',
        );
      }
      if (opening.bottom > y0) {
        addBox(
          `${id}-below-${start.toFixed(2)}`,
          vec3(start, y0, z0),
          vec3(end, Math.min(opening.bottom, y1), z1),
          color,
          'wall',
        );
      }
      if (opening.top < y1) {
        addBox(
          `${id}-above-${start.toFixed(2)}`,
          vec3(start, Math.max(opening.top, y0), z0),
          vec3(end, y1, z1),
          color,
          'wall',
        );
      }
      cursor = Math.max(cursor, end);
    }
    if (cursor < x1) {
      addBox(`${id}-${cursor.toFixed(2)}`, vec3(cursor, y0, z0), vec3(x1, y1, z1), color, 'wall');
    }
  };

  const addWallZ = (
    id: string,
    z0: number,
    z1: number,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    openings: readonly Opening[] = [],
    color: string = wall,
  ): void => {
    let cursor = z0;
    for (const opening of [...openings].sort((a, b) => a.start - b.start)) {
      const start = Math.max(z0, opening.start);
      const end = Math.min(z1, opening.end);
      if (end <= cursor) {
        continue;
      }
      if (start > cursor) {
        addBox(
          `${id}-${cursor.toFixed(2)}`,
          vec3(x0, y0, cursor),
          vec3(x1, y1, start),
          color,
          'wall',
        );
      }
      if (opening.bottom > y0) {
        addBox(
          `${id}-below-${start.toFixed(2)}`,
          vec3(x0, y0, start),
          vec3(x1, Math.min(opening.bottom, y1), end),
          color,
          'wall',
        );
      }
      if (opening.top < y1) {
        addBox(
          `${id}-above-${start.toFixed(2)}`,
          vec3(x0, Math.max(opening.top, y0), start),
          vec3(x1, y1, end),
          color,
          'wall',
        );
      }
      cursor = Math.max(cursor, end);
    }
    if (cursor < z1) {
      addBox(`${id}-${cursor.toFixed(2)}`, vec3(x0, y0, cursor), vec3(x1, y1, z1), color, 'wall');
    }
  };

  const addTrim = (id: string, x0: number, x1: number, z0: number, z1: number, y: number): void => {
    addBox(`${id}-n`, vec3(x0, y, z0), vec3(x1, y + 0.16, z0 + 0.2), roofDark, 'roof');
    addBox(`${id}-s`, vec3(x0, y, z1 - 0.2), vec3(x1, y + 0.16, z1), roofDark, 'roof');
    addBox(`${id}-w`, vec3(x0, y, z0), vec3(x0 + 0.2, y + 0.16, z1), roofDark, 'roof');
    addBox(`${id}-e`, vec3(x1 - 0.2, y, z0), vec3(x1, y + 0.16, z1), roofDark, 'roof');
  };

  // Floor and perimeter. Alpha is west, bravo is east.
  addBox('sand-floor', vec3(-21.8, -0.5, -16.6), vec3(21.8, ground, 16.6), SAND.floor, 'floor');
  addBox('sand-center-x', vec3(-21.8, 0, -1.6), vec3(21.8, 0.012, 1.6), SAND.floorAlt, 'floor');
  addBox('sand-center-z', vec3(-3.2, 0, -16.6), vec3(3.2, 0.014, 16.6), SAND.floorAlt, 'floor');
  addBox('sand-wall-n', vec3(-22.2, 0, -16.6), vec3(22.2, 8.4, -16.1), wallDark, 'wall');
  addBox('sand-wall-s', vec3(-22.2, 0, 16.1), vec3(22.2, 8.4, 16.6), wallDark, 'wall');
  addBox('sand-wall-w', vec3(-22.2, 0, -16.6), vec3(-21.7, 8.4, 16.6), wallDark, 'wall');
  addBox('sand-wall-e', vec3(21.7, 0, -16.6), vec3(22.2, 8.4, 16.6), wallDark, 'wall');
  for (const [x, z] of [
    [-21.9, -16.4],
    [21.9, -16.4],
    [-21.9, 16.4],
    [21.9, 16.4],
  ] as const) {
    addBox(
      `sand-corner-${x < 0 ? 'w' : 'e'}-${z < 0 ? 'n' : 's'}`,
      vec3(x - 0.5, 0, z - 0.5),
      vec3(x + 0.5, 9, z + 0.5),
      wallLight,
      'column',
    );
  }

  // Raised team pads, matching the two spawn columns in the BSP.
  addBox('alpha-pad', vec3(-20.8, 0, -12), vec3(-15.2, 0.18, 12), SAND.platform, 'platform');
  addBox('bravo-pad', vec3(15.2, 0, -12), vec3(20.8, 0.18, 12), SAND.platform, 'platform');
  addBox('alpha-pad-edge', vec3(-15.2, 0, -12), vec3(-14.9, 0.1, 12), wallLight, 'platform');
  addBox('bravo-pad-edge', vec3(14.9, 0, -12), vec3(15.2, 0.1, 12), wallLight, 'platform');

  // Top-left garage: solid one-storey block, roof access from the spawn side.
  const tl = { x0: -12.8, x1: -3.2, z0: -11.2, z1: -1.6, top: 3.2 };
  addBox('tl-garage', vec3(tl.x0, ground, tl.z0), vec3(tl.x1, tl.top, tl.z1), wall, 'wall');
  addBox(
    'tl-garage-roof',
    vec3(tl.x0, tl.top, tl.z0),
    vec3(tl.x1, tl.top + 0.25, tl.z1),
    roof,
    'roof',
  );
  addTrim('tl-garage-trim', tl.x0, tl.x1, tl.z0, tl.z1, tl.top + 0.25);
  addBox('tl-garage-ladder', vec3(-13.35, 0, -7.6), vec3(-12.95, 3.6, -6.8), SAND.column, 'ladder');
  addBox('tl-roof-crate-a', vec3(-10.8, 3.45, -8.0), vec3(-9.3, 4.65, -6.5), crate, 'crate');
  addBox('tl-roof-crate-b', vec3(-7.2, 3.45, -6.2), vec3(-5.9, 4.35, -5.0), crateLight, 'crate');
  addBox('tl-roof-crate-c', vec3(-9.5, 3.45, -4.2), vec3(-8.3, 4.05, -3.0), crate, 'crate');
  addBox('tl-roof-barrier', vec3(-6.2, 3.45, -10.2), vec3(-3.8, 4.05, -9.7), wallLight, 'wall');

  // Bottom-right garage: mirrored roof route from the bravo spawn side.
  const br = { x0: 3.2, x1: 12.8, z0: 1.6, z1: 11.2, top: 3.6 };
  addBox('br-garage', vec3(br.x0, ground, br.z0), vec3(br.x1, br.top, br.z1), wall, 'wall');
  addBox(
    'br-garage-roof',
    vec3(br.x0, br.top, br.z0),
    vec3(br.x1, br.top + 0.25, br.z1),
    roof,
    'roof',
  );
  addTrim('br-garage-trim', br.x0, br.x1, br.z0, br.z1, br.top + 0.25);
  addBox('br-garage-ladder', vec3(12.95, 0, 7.2), vec3(13.35, 4.0, 8.0), SAND.column, 'ladder');
  addBox('br-roof-crate-a', vec3(4.8, 3.85, 5.0), vec3(6.2, 5.05, 6.4), crate, 'crate');
  addBox('br-roof-crate-b', vec3(9.8, 3.85, 4.4), vec3(11.2, 4.75, 5.8), crateLight, 'crate');
  addBox('br-roof-crate-c', vec3(6.0, 3.85, 8.4), vec3(7.4, 4.45, 9.8), crate, 'crate');
  addBox('br-roof-barrier', vec3(9.0, 3.85, 9.4), vec3(12.0, 4.45, 9.9), wallLight, 'wall');

  // Top-right two-storey building. Ground floor has the armour, second floor
  // is reached by an internal staircase; windows and doors are real openings.
  const tr = { x0: 3.2, x1: 12.8, z0: -11.2, z1: -2.8, floor2: 3.2, roof: 6.8 };
  addBox(
    'tr-floor2',
    vec3(3.55, tr.floor2, -10.85),
    vec3(10.9, tr.floor2 + 0.25, -3.15),
    SAND.floorAlt,
    'floor',
  );
  addBox(
    'tr-floor2-n',
    vec3(10.9, tr.floor2, -10.85),
    vec3(12.45, tr.floor2 + 0.25, -9.7),
    SAND.floorAlt,
    'floor',
  );
  addBox(
    'tr-floor2-s',
    vec3(10.9, tr.floor2, -4.8),
    vec3(12.45, tr.floor2 + 0.25, -3.15),
    SAND.floorAlt,
    'floor',
  );
  addBox('tr-roof', vec3(tr.x0, tr.roof, tr.z0), vec3(tr.x1, tr.roof + 0.25, tr.z1), roof, 'roof');
  addTrim('tr-roof-trim', tr.x0, tr.x1, tr.z0, tr.z1, tr.roof + 0.25);
  addWallX(
    'tr-south',
    3.2,
    12.8,
    -3.15,
    -2.8,
    0,
    tr.floor2 + 0.25,
    [{ start: 8.2, end: 9.4, bottom: 1.2, top: 2.2 }],
    wall,
  );
  addWallX(
    'tr-north',
    3.2,
    12.8,
    -11.2,
    -10.85,
    0,
    tr.floor2 + 0.25,
    [{ start: 7.2, end: 8.4, bottom: 1.2, top: 2.2 }],
    wall,
  );
  addWallZ(
    'tr-west',
    -10.85,
    -3.15,
    3.2,
    3.55,
    0,
    tr.floor2 + 0.25,
    [{ start: -9.8, end: -8.6, bottom: 1.2, top: 2.2 }],
    wall,
  );
  // The ground-floor entrance faces the bravo spawn on the east wall. It sits
  // south of the staircase so entering the building never puts a player on the
  // stair landing.
  addWallZ(
    'tr-east',
    -10.85,
    -3.15,
    12.45,
    12.8,
    0,
    tr.floor2 + 0.25,
    [
      { start: -9.8, end: -8.6, bottom: 1.2, top: 2.2 },
      { start: -4.6, end: -3.2, bottom: 0, top: 2.4 },
    ],
    wall,
  );
  // Upper walls with a single high window per side.
  addWallX(
    'tr-south-upper',
    3.2,
    12.8,
    -3.15,
    -2.8,
    tr.floor2 + 0.25,
    tr.roof,
    [{ start: 8.2, end: 9.4, bottom: 4.6, top: 5.6 }],
    wallLight,
  );
  addWallX(
    'tr-north-upper',
    3.2,
    12.8,
    -11.2,
    -10.85,
    tr.floor2 + 0.25,
    tr.roof,
    [{ start: 7.2, end: 8.4, bottom: 4.6, top: 5.6 }],
    wallLight,
  );
  addWallZ(
    'tr-west-upper',
    -10.85,
    -3.15,
    3.2,
    3.55,
    tr.floor2 + 0.25,
    tr.roof,
    [{ start: -9.8, end: -8.6, bottom: 4.6, top: 5.6 }],
    wallLight,
  );
  addWallZ(
    'tr-east-upper',
    -10.85,
    -3.15,
    12.45,
    12.8,
    tr.floor2 + 0.25,
    tr.roof,
    [{ start: -9.8, end: -8.6, bottom: 4.6, top: 5.6 }],
    wallLight,
  );
  // Interior ground-floor wall with a doorway.
  addWallX(
    'tr-inner',
    3.55,
    10.9,
    -7.15,
    -6.8,
    0,
    tr.floor2,
    [{ start: 5.0, end: 6.2, bottom: 0, top: 2.4 }],
    wallDark,
  );
  const trStairSteps = 11;
  const trStairRun = 4.9 / trStairSteps;
  for (let step = 0; step < trStairSteps; step += 1) {
    const z1 = -4.8 - step * trStairRun;
    const z0 = z1 - trStairRun;
    const height = ((step + 1) * (tr.floor2 + 0.25)) / trStairSteps;
    addBox(
      `tr-stair-${step}`,
      vec3(10.9, 0, z0),
      vec3(12.45, height, z1),
      SAND.platform,
      'platform',
    );
  }
  // A solid guard rail closes the open side of the stairwell on the second
  // floor; the stair itself remains enterable from its bottom landing.
  addBox(
    'tr-stair-rail',
    vec3(10.9, tr.floor2 + 0.25, -9.7),
    vec3(10.98, tr.floor2 + 1.05, -4.8),
    wallLight,
    'wall',
  );
  addBox('tr-crate', vec3(7.4, 0, -9.6), vec3(8.7, 1.1, -8.3), crate, 'crate');

  // Bottom-left two-storey building, mirrored in layout.
  const bl = { x0: -12.8, x1: -3.2, z0: 1.6, z1: 11.2, floor2: 3.6, roof: 7.0 };
  addBox(
    'bl-floor2',
    vec3(-12.45, bl.floor2, 1.95),
    vec3(-4.55, bl.floor2 + 0.25, 10.85),
    SAND.floorAlt,
    'floor',
  );
  addBox(
    'bl-floor2-n',
    vec3(-4.55, bl.floor2, 1.95),
    vec3(-3.2, bl.floor2 + 0.25, 3.9),
    SAND.floorAlt,
    'floor',
  );
  addBox(
    'bl-floor2-s',
    vec3(-4.55, bl.floor2, 8.9),
    vec3(-3.2, bl.floor2 + 0.25, 10.85),
    SAND.floorAlt,
    'floor',
  );
  addBox('bl-roof', vec3(bl.x0, bl.roof, bl.z0), vec3(bl.x1, bl.roof + 0.25, bl.z1), roof, 'roof');
  addTrim('bl-roof-trim', bl.x0, bl.x1, bl.z0, bl.z1, bl.roof + 0.25);
  addWallX(
    'bl-north',
    -12.8,
    -3.2,
    1.6,
    1.95,
    0,
    bl.floor2 + 0.25,
    [{ start: -7.2, end: -6.0, bottom: 1.2, top: 2.2 }],
    wall,
  );
  addWallX(
    'bl-south',
    -12.8,
    -3.2,
    10.85,
    11.2,
    0,
    bl.floor2 + 0.25,
    [{ start: -7.2, end: -6.0, bottom: 1.2, top: 2.2 }],
    wall,
  );
  // The ground-floor entrance faces the alpha spawn on the west wall.
  addWallZ(
    'bl-west',
    1.95,
    10.85,
    -12.8,
    -12.45,
    0,
    bl.floor2 + 0.25,
    [
      { start: 3.2, end: 4.4, bottom: 1.2, top: 2.2 },
      { start: 6.0, end: 7.6, bottom: 0, top: 2.4 },
    ],
    wall,
  );
  addWallZ(
    'bl-east',
    1.95,
    10.85,
    -3.55,
    -3.2,
    0,
    bl.floor2 + 0.25,
    [{ start: 2.2, end: 3.4, bottom: 1.2, top: 2.2 }],
    wall,
  );
  addWallX(
    'bl-north-upper',
    -12.8,
    -3.2,
    1.6,
    1.95,
    bl.floor2 + 0.25,
    bl.roof,
    [{ start: -7.2, end: -6.0, bottom: 5.0, top: 6.0 }],
    wallLight,
  );
  addWallX(
    'bl-south-upper',
    -12.8,
    -3.2,
    10.85,
    11.2,
    bl.floor2 + 0.25,
    bl.roof,
    [{ start: -7.2, end: -6.0, bottom: 5.0, top: 6.0 }],
    wallLight,
  );
  addWallZ(
    'bl-west-upper',
    1.95,
    10.85,
    -12.8,
    -12.45,
    bl.floor2 + 0.25,
    bl.roof,
    [{ start: 3.2, end: 4.4, bottom: 5.0, top: 6.0 }],
    wallLight,
  );
  addWallZ(
    'bl-east-upper',
    1.95,
    10.85,
    -3.55,
    -3.2,
    bl.floor2 + 0.25,
    bl.roof,
    [{ start: 2.2, end: 3.4, bottom: 5.0, top: 6.0 }],
    wallLight,
  );
  const blStairSteps = 11;
  const blStairRun = 5.0 / blStairSteps;
  for (let step = 0; step < blStairSteps; step += 1) {
    const z0 = 3.9 + step * blStairRun;
    const z1 = z0 + blStairRun;
    const height = ((step + 1) * (bl.floor2 + 0.25)) / blStairSteps;
    addBox(
      `bl-stair-${step}`,
      vec3(-4.55, 0, z0),
      vec3(-3.2, height, z1),
      SAND.platform,
      'platform',
    );
  }
  addBox(
    'bl-stair-rail',
    vec3(-4.63, bl.floor2 + 0.25, 3.9),
    vec3(-4.55, bl.floor2 + 1.05, 8.9),
    wallLight,
    'wall',
  );
  addBox('bl-crate', vec3(-10.6, 0, 4.4), vec3(-9.2, 1.1, 5.8), crate, 'crate');

  // Protruding peek walls and asymmetric crate stack in the side lanes.
  addBox('alpha-peek-n', vec3(-20.0, 0, -3.0), vec3(-18.8, 1.6, -2.4), wallLight, 'wall');
  addBox('alpha-peek-s', vec3(-18.0, 0, 2.4), vec3(-16.8, 1.6, 3.0), wallLight, 'wall');
  addBox('bravo-peek-n', vec3(18.8, 0, -3.0), vec3(20.0, 1.6, -2.4), wallLight, 'wall');
  addBox('bravo-peek-s', vec3(16.8, 0, 2.4), vec3(18.0, 1.6, 3.0), wallLight, 'wall');
  addBox('alpha-mid-crates', vec3(-18.4, 0, -0.9), vec3(-16.9, 1.2, 0.9), crate, 'crate');
  addBox('alpha-mid-crates-high', vec3(-16.9, 0, -0.6), vec3(-15.6, 1.8, 0.6), crateLight, 'crate');
  addBox('center-peek-n', vec3(-2.6, 0, -6.0), vec3(-1.2, 1.4, -5.4), wallLight, 'wall');
  addBox('center-peek-s', vec3(1.2, 0, 5.4), vec3(2.6, 1.4, 6.0), wallLight, 'wall');
  addBox('north-cover', vec3(-1.8, 0, -14.2), vec3(1.8, 1.2, -13.6), crate, 'crate');
  addBox('south-cover', vec3(-1.8, 0, 13.6), vec3(1.8, 1.2, 14.2), crate, 'crate');

  const spawns: SpawnPoint[] = [];
  const spawnZ = [-11.2, -7.2, -3.2, 3.2, 7.2, 11.2];
  for (const z of spawnZ) {
    const suffix = z < 0 ? `n${Math.abs(z)}` : `s${z}`;
    for (const [index, x] of [-19.2, -16.0].entries()) {
      spawns.push({
        id: `alpha-${suffix}-${index + 1}`,
        team: 'alpha',
        position: vec3(x, 0.19, z),
        yaw: -Math.PI / 2,
      });
    }
    for (const [index, x] of [16.0, 19.2].entries()) {
      spawns.push({
        id: `bravo-${suffix}-${index + 1}`,
        team: 'bravo',
        position: vec3(x, 0.19, z),
        yaw: Math.PI / 2,
      });
    }
  }

  const weaponSpawns: WeaponSpawnPoint[] = [
    { id: 'ak47-center-n', weapon: 'ak47', position: vec3(0, 0.9, -6.5) },
    { id: 'm4a1-center-s', weapon: 'm4a1', position: vec3(0, 0.9, 6.5) },
    { id: 'awp-tl-roof', weapon: 'awp', position: vec3(-8.0, 4.35, -6.0) },
    { id: 'awp-br-roof', weapon: 'awp', position: vec3(8.0, 4.75, 8.0) },
    { id: 'mp5-tr', weapon: 'mp5', position: vec3(9.6, 0.9, -9.0) },
    { id: 'mp5-bl', weapon: 'mp5', position: vec3(-8.0, 0.9, 8.5) },
    { id: 'm249-alpha', weapon: 'm249', position: vec3(-17.0, 0.9, -8.0) },
    { id: 'm249-bravo', weapon: 'm249', position: vec3(17.0, 0.9, 8.0) },
    { id: 'deagle-alpha', weapon: 'deagle', position: vec3(-16.0, 0.9, 2.0) },
    { id: 'deagle-bravo', weapon: 'deagle', position: vec3(17.0, 0.9, -2.0) },
    { id: 'ak47-north', weapon: 'ak47', position: vec3(-1.5, 0.9, -14.5) },
    { id: 'm4a1-south', weapon: 'm4a1', position: vec3(1.5, 0.9, 14.5) },
    { id: 'he-tl-a', weapon: 'hegrenade', position: vec3(-10.8, 4.35, -7.2) },
    { id: 'he-tl-b', weapon: 'hegrenade', position: vec3(-5.6, 4.35, -7.2) },
    { id: 'he-br-a', weapon: 'hegrenade', position: vec3(4.8, 4.75, 5.6) },
    { id: 'he-br-b', weapon: 'hegrenade', position: vec3(10.6, 4.75, 5.0) },
  ];

  const armorSpawns: ArmorSpawnPoint[] = [
    { id: 'armor-tr', amount: 100, position: vec3(4.8, 0.9, -10.0) },
    { id: 'armor-bl', amount: 100, position: vec3(-11.6, 4.75, 10.0) },
  ];

  return {
    id: 'fy_sand',
    name: 'fy_sand',
    mode: 'arena',
    size: 44,
    sizeZ: 33.2,
    height: 10,
    boxes,
    spawns,
    weaponSpawns,
    armorSpawns,
    bombSites: [],
    theme: SAND_THEME,
  };
}

const DUST2_THEME: MapTheme = {
  sky: '#7ab8e6',
  fog: '#e6cda5',
  fogNear: 58,
  fogFar: 170,
  sun: '#fff4d4',
  ambient: '#d8c3a5',
  accent: '#d99b4e',
  horizon: '#dfbe8f',
};

const DUST2 = {
  floorLow: '#c7a474',
  floorMid: '#d6b483',
  floorHigh: '#e0c294',
  tunnelFloor: '#a68967',
  wall: '#d9b889',
  wallLight: '#e6caa0',
  wallDark: '#b89162',
  wallBrick: '#bf7e50',
  arch: '#c99f6c',
  tunnelWall: '#947858',
  tunnelRoof: '#786045',
  roof: '#a15e40',
  door: '#7c4d2b',
  crate: '#a67442',
  crateTarp: '#3a8c8c',
  crateBlue: '#3b6998',
  car: '#8c3b32',
  column: '#c49b68',
  rock: '#ab855a',
} as const;

function buildDust2Arena(): ArenaMap {
  const boxes: MapBox[] = [];
  const addBox = (id: string, min: Vec3, max: Vec3, color: string, kind: MapBoxKind): void => {
    boxes.push(makeBox(id, min, max, color, kind));
  };

  // Smoothly traversable road/ramp slices (physics step rise <= 0.20m < MOVEMENT.stepHeight = 0.36m).
  // Prefix 'slopeZ:' or 'slopeX:' instructs the 3D client renderer to draw ONE seamless inclined wedge mesh
  // with zero visible stair steps while keeping exact server/client AABB collision.
  const addSlopeZ = (
    id: string,
    x0: number,
    x1: number,
    zStart: number,
    zEnd: number,
    yBase: number,
    yStart: number,
    yEnd: number,
    slices: number,
    color: string = DUST2.floorMid,
  ): void => {
    const dz = (zEnd - zStart) / slices;
    const dy = (yEnd - yStart) / slices;
    for (let i = 0; i < slices; i += 1) {
      const za = zStart + dz * i;
      const zb = zStart + dz * (i + 1);
      const zMin = Math.min(za, zb);
      const zMax = Math.max(za, zb);
      const yTop = yStart + dy * (i + 1);
      addBox(
        `slopeZ:${id}:${zStart}:${zEnd}:${yStart}:${yEnd}:${i}:${slices}`,
        vec3(x0, yBase, zMin),
        vec3(x1, yTop, zMax),
        color,
        'ramp',
      );
    }
  };

  const addSlopeX = (
    id: string,
    xStart: number,
    xEnd: number,
    z0: number,
    z1: number,
    yBase: number,
    yStart: number,
    yEnd: number,
    slices: number,
    color: string = DUST2.floorMid,
  ): void => {
    const dx = (xEnd - xStart) / slices;
    const dy = (yEnd - yStart) / slices;
    for (let i = 0; i < slices; i += 1) {
      const xa = xStart + dx * i;
      const xb = xStart + dx * (i + 1);
      const xMin = Math.min(xa, xb);
      const xMax = Math.max(xa, xb);
      const yTop = yStart + dy * (i + 1);
      addBox(
        `slopeX:${id}:${xStart}:${xEnd}:${yStart}:${yEnd}:${i}:${slices}`,
        vec3(xMin, yBase, z0),
        vec3(xMax, yTop, z1),
        color,
        'ramp',
      );
    }
  };

  // True architectural staircases (Винт in Lower Tunnels, Short stairs)
  const addStairsZ = (
    id: string,
    x0: number,
    x1: number,
    zStart: number,
    zEnd: number,
    yBase: number,
    yEnd: number,
    steps: number,
    color: string = DUST2.floorMid,
  ): void => {
    const dz = (zEnd - zStart) / steps;
    const dy = (yEnd - yBase) / steps;
    for (let i = 0; i < steps; i += 1) {
      const za = zStart + dz * i;
      const zb = zStart + dz * (i + 1);
      const zMin = Math.min(za, zb);
      const zMax = Math.max(za, zb);
      const yTop = yBase + dy * (i + 1);
      addBox(`${id}-step-${i + 1}`, vec3(x0, yBase, zMin), vec3(x1, yTop, zMax), color, 'ramp');
    }
  };

  // ---------------------------------------------------------------------------
  // 0. Base Floor (y: -0.6 .. 0.0) & Outer Perimeter Walls ([-34..34])
  // Interior playable space is strictly within x: [-33..33], z: [-33..33] with
  // zero overlapping 3D volumes so faces never Z-fight.
  // ---------------------------------------------------------------------------
  addBox('d2-base-floor', vec3(-34, -0.6, -34), vec3(34, 0, 34), DUST2.floorLow, 'floor');
  addBox('d2-wall-north', vec3(-34, 0, -34), vec3(34, 9.5, -33), DUST2.wallDark, 'wall');
  addBox('d2-wall-south', vec3(-34, 0, 33), vec3(34, 9.5, 34), DUST2.wallDark, 'wall');
  addBox('d2-wall-west', vec3(-34, 0, -33), vec3(-33, 9.5, 33), DUST2.wallDark, 'wall');
  addBox('d2-wall-east', vec3(33, 0, -33), vec3(34, 9.5, 33), DUST2.wallDark, 'wall');

  // ---------------------------------------------------------------------------
  // 1. SOUTH BELT: T SPAWN (Т СПАВН), TITANIC (ТИТАНИК), TRAP (ТРАП),
  //    OUTSIDE TUNNELS (ПЕСКИ), SUICIDE (20), OUTSIDE LONG (ПЛОЩАДЬ)
  // ---------------------------------------------------------------------------
  // T-Spawn platform pulled back at Suicide (z = 27.5) with front stone parapet so legs on T-Spawn are NEVER visible from Mid, while sides remain open for jumping in/out!
  addBox('t-spawn-plat-w', vec3(-15, 0, 25), vec3(-3.5, 2.4, 33), DUST2.floorHigh, 'platform');
  addBox('t-spawn-plat-s', vec3(-3.5, 0, 27.5), vec3(1.5, 2.4, 33), DUST2.floorHigh, 'platform');
  addBox('t-spawn-plat-e', vec3(1.5, 0, 25), vec3(10, 2.4, 33), DUST2.floorHigh, 'platform');
  addBox(
    't-spawn-suicide-fence',
    vec3(-3.5, 2.4, 27.5),
    vec3(1.5, 3.45, 28.0),
    DUST2.wallLight,
    'wall',
  );
  addBox('t-titanic-plat', vec3(-25, 0, 20), vec3(-15, 2.4, 33), DUST2.floorHigh, 'platform');
  addBox('t-sw-building', vec3(-33, 0, 20), vec3(-25, 7.6, 33), DUST2.wall, 'wall');
  addBox('t-se-building', vec3(22, 0, 25), vec3(33, 7.6, 33), DUST2.wall, 'wall');
  addBox('t-spawn-car', vec3(-14.2, 2.4, 27.5), vec3(-11.8, 3.6, 29.5), DUST2.car, 'crate');

  // ТРАП (T-Ramp) descending north from Titanic (z=20, y=2.4) into Пески (z=15.5, y=1.2)
  addBox('t-trap-base', vec3(-25, 0, 15.5), vec3(-20, 1.2, 20), DUST2.floorMid, 'platform');
  addSlopeZ('t-trap', -25, -20, 15.5, 20, 1.2, 1.28, 2.4, 8, DUST2.floorHigh);
  addBox('t-titanic-parapet', vec3(-20, 1.2, 19.3), vec3(-15, 3.25, 20), DUST2.wallLight, 'wall');

  // ПЕСКИ (Outside Tunnels, y = 1.2)
  addBox('peski-floor-sw', vec3(-33, 0, 15.5), vec3(-25, 1.2, 20), DUST2.floorMid, 'platform');
  addBox('peski-floor-se', vec3(-20, 0, 15.5), vec3(-15, 1.2, 19.3), DUST2.floorMid, 'platform');
  addBox('peski-floor-main', vec3(-33, 0, 6), vec3(-15, 1.2, 15.5), DUST2.floorMid, 'platform');
  addBox('peski-west-wall', vec3(-33, 1.2, 6), vec3(-29.5, 7.6, 20), DUST2.wall, 'wall');
  addBox('peski-crate', vec3(-28.8, 1.2, 11.5), vec3(-27.0, 2.5, 13.3), DUST2.crate, 'crate');

  // SOLID WEST-MID BUILDING BLOCK (separating Пески/Tunnels from Suicide/Top Mid, with 9 alcove)
  addBox('block-west-mid-s', vec3(-15, 0, 14.5), vec3(-3.5, 7.6, 25), DUST2.wall, 'wall');
  addBox('block-west-mid-m', vec3(-15, 0, 10), vec3(-5.5, 7.6, 14.5), DUST2.wall, 'wall');
  addBox('block-west-mid-n', vec3(-10.5, 0, 2), vec3(-3.5, 7.6, 10), DUST2.wall, 'wall');
  addBox('block-west-mid-nw', vec3(-15, 0, 5.8), vec3(-10.5, 7.6, 10), DUST2.wall, 'wall');

  // 20 (SUICIDE alley with full-length ceiling z: 14.5..24.5 and open jump-in pit z: 24.5..27.5!)
  addBox('suicide-ceiling', vec3(-3.5, 3.1, 14.5), vec3(1.5, 7.6, 24.5), DUST2.arch, 'wall');
  addBox(
    'suicide-low-floor',
    vec3(-3.5, 0, 14.5),
    vec3(1.5, 0.6, 27.5),
    DUST2.floorLow,
    'platform',
  );
  addSlopeZ('suicide-drop', -3.5, 1.5, 25.2, 27.5, 0.6, 0.68, 1.8, 6, DUST2.floorMid);
  addSlopeZ('suicide-rise', -3.5, 1.5, 16.5, 14.5, 0.6, 0.68, 1.2, 4, DUST2.floorMid);
  addBox('suicide-crate', vec3(-3.3, 0.6, 17.5), vec3(-2.0, 1.8, 19.2), DUST2.crate, 'crate');

  // SOLID SOUTH-EAST BUILDING BLOCK (separating Suicide from Площадь / Outside Long)
  addBox('block-se-suicide', vec3(1.5, 0, 14.5), vec3(10, 7.6, 25), DUST2.wall, 'wall');

  // T-Spawn East Smooth Ramp descending into ПЛОЩАДЬ (Outside Long, y: 2.4 -> 1.2)
  addBox('t-long-ramp-base', vec3(10, 0, 25), vec3(15, 1.2, 33), DUST2.floorMid, 'platform');
  addSlopeX('t-long-ramp', 15, 10, 25.5, 31.2, 1.2, 1.28, 2.4, 8, DUST2.floorHigh);
  addBox('ploschad-south-wall', vec3(10, 1.2, 31.2), vec3(22, 7.6, 33), DUST2.wall, 'wall');

  // ПЛОЩАДЬ (Outside Long, y = 1.2 -> 1.6) & 8 / ПАЛЬМА connector to Top Mid
  addBox('ploschad-floor-s', vec3(15, 0, 25), vec3(22, 1.2, 31.2), DUST2.floorMid, 'platform');
  addBox('ploschad-floor-m', vec3(10, 0, 18), vec3(22, 1.2, 25), DUST2.floorMid, 'platform');
  addBox('ploschad-floor-n-base', vec3(13.5, 0, 12), vec3(22, 1.2, 18), DUST2.floorMid, 'platform');
  addSlopeZ('ploschad-to-banka', 13.5, 22, 18, 12, 1.2, 1.26, 1.6, 6, DUST2.floorMid);
  addBox('ploschad-east-wall', vec3(22, 0, 12), vec3(33, 7.6, 25), DUST2.wall, 'wall');
  addBox('ploschad-crate', vec3(18.5, 1.2, 19.5), vec3(20.6, 2.5, 21.6), DUST2.crate, 'crate');
  addBox('palm-conn-w', vec3(1.5, 0, 10), vec3(10, 1.2, 14.5), DUST2.floorMid, 'platform');
  addBox('palm-conn-e', vec3(10, 0, 10), vec3(13.5, 1.2, 18), DUST2.floorMid, 'platform');

  // ---------------------------------------------------------------------------
  // 2. CENTER BELT: Т МИДЛ (MID), ПАРАПЕТ, ИКС (XBOX), ДВЕРИ (MID DOORS),
  //    ЗИГА (CATWALK) & ШОРТ (A-SHORT)
  // ---------------------------------------------------------------------------
  addBox('alcove-9-floor', vec3(-5.5, 0, 10), vec3(-3.5, 1.2, 14.5), DUST2.floorMid, 'platform');
  addBox('top-mid-floor', vec3(-3.5, 0, 10), vec3(1.5, 1.2, 14.5), DUST2.floorMid, 'platform');
  // Smooth road descending down Mid from z = 10.0 (y = 1.2) to z = 3.0 (y = 0.0).
  // From z = 3.0 all the way through Mid Doors (z = -2.7) is flat ground (y = 0.0) with NO stairs!
  addSlopeZ('mid-slope', -3.5, 1.5, 3.0, 10.0, 0, 0.08, 1.2, 10, DUST2.floorLow);

  // ПАРАПЕТ (Catwalk along east side of Mid): flat earth entry at south + low stone parapet fence on west edge!
  addBox('parapet-flat-entry', vec3(1.5, 0, 6.5), vec3(4.5, 1.2, 10.0), DUST2.floorMid, 'platform');
  addBox('parapet-base-n', vec3(1.5, 0, 0.5), vec3(4.5, 1.2, 6.5), DUST2.floorMid, 'platform');
  addBox('parapet-west-fence', vec3(1.5, 1.2, 0.5), vec3(1.9, 2.55, 9.2), DUST2.wallLight, 'wall');
  addSlopeZ('parapet-slope', 1.9, 4.5, 6.5, 0.5, 1.2, 1.26, 2.0, 8, DUST2.floorHigh);

  // ИКС (XBOX) sitting at the north-east corner of Mid right against Зига & Mid Doors wall
  addBox('xbox-step', vec3(0.5, 0, -0.3), vec3(1.5, 1.15, 0.8), DUST2.crate, 'crate');
  addBox('xbox-main', vec3(0.5, 0, -1.5), vec3(1.9, 1.85, -0.3), DUST2.crate, 'crate');

  // SOLID CENTRAL BUILDING BLOCK (between Парапет and Банка; stops at z = 0.5 so Зига is visible from Lower Tunnels!)
  addBox('block-central-mid', vec3(4.5, 0, 0.5), vec3(13.5, 7.6, 10.0), DUST2.wall, 'wall');

  // ЗИГА (Catwalk turn z: -5.5 .. +0.5) with full-height divider wall at z: -5.5..-1.5 blocking CT Mid / Грибы!
  addBox('ziga-ct-divider-wall', vec3(1.5, 0, -5.5), vec3(2.3, 8.2, -1.5), DUST2.wall, 'wall');
  addBox('ziga-ledge-xbox', vec3(1.9, 0, -1.5), vec3(2.3, 2.0, 0.5), DUST2.floorHigh, 'platform');
  addBox('ziga-west-fence', vec3(1.9, 2.0, -1.5), vec3(2.3, 2.95, 0.5), DUST2.wallLight, 'wall');
  addBox('ziga-floor', vec3(2.3, 0, -5.5), vec3(12.5, 2.0, 0.5), DUST2.floorHigh, 'platform');
  addBox('ziga-north-wall', vec3(1.5, 0, -6.5), vec3(6.5, 8.2, -5.5), DUST2.wall, 'wall');

  // ШОРТ (A-Short corridor & stairs rising from z = -5.5 y = 2.0 to z = -22.0 y = 2.4)
  // Full-height solid west wall so CT Mid is NEVER visible from Short!
  addBox('short-west-solid-wall', vec3(6.5, 0, -16.5), vec3(7.2, 8.2, -5.5), DUST2.wall, 'wall');
  addBox(
    'short-bridge-west-wall',
    vec3(6.5, 2.2, -22.0),
    vec3(7.2, 8.2, -16.5),
    DUST2.wall,
    'wall',
  );
  addBox(
    'short-south-flat',
    vec3(7.2, 0, -11.5),
    vec3(12.5, 2.0, -5.5),
    DUST2.floorHigh,
    'platform',
  );
  addBox(
    'short-stairs-base',
    vec3(7.2, 0, -15.5),
    vec3(12.5, 2.0, -11.5),
    DUST2.floorHigh,
    'platform',
  );
  addStairsZ('short-stairs', 7.2, 12.5, -11.5, -15.5, 2.0, 2.4, 3, DUST2.floorHigh);

  // SOLID BUILDING BLOCKS between Зига/Шорт and Банка/Длина (Long A)
  addBox('block-ziga-banka', vec3(12.5, 0, -4.5), vec3(13.5, 7.6, 0.5), DUST2.wall, 'wall');
  addBox('block-long-corner', vec3(12.5, 0, -16.5), vec3(24.5, 7.6, -4.5), DUST2.wall, 'wall');

  // ДВЕРИ (MID DOORS: створки одинаковой длины 1.49 м, S-образный проход и снайперская щель как в КС2)
  addBox('mid-door-pier-w', vec3(-3.5, 0, -2.7), vec3(-2.6, 8.2, -0.7), DUST2.wallDark, 'wall');
  addBox('mid-door-pier-e', vec3(0.5, 0, -2.7), vec3(1.5, 8.2, -1.5), DUST2.wallDark, 'wall');
  addBox('mid-door-lintel', vec3(-2.6, 3.4, -2.7), vec3(0.5, 8.2, -1.5), DUST2.arch, 'wall');
  addBox('mid-door-leaf-w', vec3(-2.6, 0, -1.76), vec3(-1.19, 3.4, -1.02), DUST2.door, 'crate');
  addBox('mid-door-leaf-e', vec3(-0.91, 0, -2.38), vec3(0.5, 3.4, -1.64), DUST2.door, 'crate');

  // ---------------------------------------------------------------------------
  // 3. EAST BELT: БАНКА (LONG DOORS), СИНИЙ (BLUE), 90, ЯМА (PIT),
  //    ДЛИНА (LONG A), ПОДЪЕМ, ПРОСВЕТ, ПЛЕНТ A, ГУСЬ, МОСТ / КТ БУСТ
  // ---------------------------------------------------------------------------
  // БАНКА / КОРОБКА (Fully enclosed Long House at y = 1.6 with west & east walls and passable 1.6m doorways)
  addBox('banka-floor', vec3(13.5, 0, 2.5), vec3(22, 1.6, 12), DUST2.tunnelFloor, 'platform');
  addBox('banka-west-wall', vec3(13.5, 1.6, 3.2), vec3(14.3, 5.4, 11.3), DUST2.wall, 'wall');
  addBox('banka-east-wall', vec3(21.2, 1.6, 2.5), vec3(22, 5.4, 12), DUST2.wall, 'wall');
  addBox('banka-s-pier-w', vec3(13.5, 1.6, 11.3), vec3(16.0, 5.4, 12), DUST2.wallDark, 'wall');
  addBox('banka-s-pier-e', vec3(19.2, 1.6, 11.3), vec3(21.2, 5.4, 12), DUST2.wallDark, 'wall');
  addBox('banka-s-lintel', vec3(16.0, 4.2, 11.3), vec3(19.2, 5.4, 12), DUST2.arch, 'wall');
  // Две створки одинаковой длины 1.52 м: западная внутрь, восточная наружу (S-образный проход 1.20 м, зазор 0.40 м)
  addBox('banka-s-leaf-w', vec3(16.0, 1.6, 10.99), vec3(17.46, 4.2, 11.71), DUST2.door, 'crate');
  addBox('banka-s-leaf-e', vec3(17.74, 1.6, 11.59), vec3(19.2, 4.2, 12.31), DUST2.door, 'crate');
  addBox('banka-n-pier-w', vec3(13.5, 1.6, 2.5), vec3(16.0, 5.4, 3.2), DUST2.wallDark, 'wall');
  addBox('banka-n-pier-e', vec3(19.2, 1.6, 2.5), vec3(21.2, 5.4, 3.2), DUST2.wallDark, 'wall');
  addBox('banka-n-lintel', vec3(16.0, 4.2, 2.5), vec3(19.2, 5.4, 3.2), DUST2.arch, 'wall');
  // Две створки одинаковой длины 1.52 м: западная в лонг, восточная внутрь банки (S-образный проход 1.20 м, зазор 0.40 м)
  addBox('banka-n-leaf-w', vec3(16.0, 1.6, 2.19), vec3(17.46, 4.2, 2.91), DUST2.door, 'crate');
  addBox('banka-n-leaf-e', vec3(17.74, 1.6, 2.79), vec3(19.2, 4.2, 3.51), DUST2.door, 'crate');
  addBox('banka-roof', vec3(13.5, 5.4, 2.5), vec3(22, 6.2, 12), DUST2.roof, 'roof');

  // 7 (Spacious Long Doors exit courtyard z: -4.5 .. 2.5), СИНИЙ (Blue Container), 90 (Side Pit) & deep ЯМА (Pit)
  addBox('long-doors-yard', vec3(13.5, 0, -4.5), vec3(24.5, 1.6, 2.5), DUST2.floorMid, 'platform');
  addBox('side-pit-90-floor', vec3(22, 0, 2.5), vec3(24.5, 1.6, 12), DUST2.floorMid, 'platform');
  addBox(
    'long-blue-container',
    vec3(13.8, 1.6, -3.2),
    vec3(16.2, 3.8, -0.4),
    DUST2.crateBlue,
    'crate',
  );
  addBox('pit-west-parapet', vec3(24.0, 1.6, 2.5), vec3(24.5, 2.5, 12), DUST2.wallDark, 'wall');
  // Deep ЯМА (Pit floor at y = 0.0, 1.6m below Long A!) with width x: 24.5 .. 31.5 matching Long A width!
  addBox('pit-east-plat', vec3(31.5, 0, -1.5), vec3(33, 1.6, 12), DUST2.floorMid, 'platform');
  addSlopeZ('pit-slope', 24.5, 31.5, 5.5, -1.5, 0, 0.1, 1.6, 10, DUST2.floorLow);

  // ДЛИНА (LONG A: x: 24.5 .. 31.5 — same width as right edge of Pit, clean road with NO random boxes!)
  addBox(
    'long-a-main-floor',
    vec3(24.5, 0, -16.5),
    vec3(33, 1.6, -1.5),
    DUST2.floorMid,
    'platform',
  );
  addBox('long-car-body', vec3(30.4, 1.6, -11.5), vec3(32.8, 2.85, -7.2), DUST2.car, 'crate');

  // ПОДЪЕМ (Smooth A-Long Ramp ascending y: 1.6 -> 2.4 all the way to Goose z = -26.5) & ПРОСВЕТ (Cross to CT)
  addBox('a-ramp-base', vec3(24.5, 0, -26.5), vec3(33, 1.6, -16.5), DUST2.floorMid, 'platform');
  addSlopeZ('a-long-ramp', 24.5, 31.5, -16.5, -26.5, 1.6, 1.66, 2.4, 10, DUST2.floorHigh);
  addBox('a-ramp-east-wall', vec3(31.5, 1.6, -26.5), vec3(33, 8.2, -16.5), DUST2.wall, 'wall');
  addBox('prosvet-floor', vec3(18.5, 0, -21), vec3(24.5, 1.6, -16.5), DUST2.floorMid, 'platform');
  addBox(
    'prosvet-headshot-box',
    vec3(21.8, 1.6, -21),
    vec3(23.6, 2.85, -19.4),
    DUST2.crate,
    'crate',
  );
  addSlopeX('prosvet-ct-slope', 14, 18.5, -21, -16.5, 0, 0.1, 1.6, 8, DUST2.floorLow);

  // ПЛЕНТ A (BOMBSITE A, y = 2.4), ГУСЬ (GOOSE), БОЧКИ (BARRELS) & low stone parapet walls along A cliff
  addBox('a-site-plat', vec3(14, 0, -33), vec3(24.5, 2.4, -21), DUST2.floorHigh, 'platform');
  addBox('a-goose-plat', vec3(24.5, 0, -33), vec3(33, 2.4, -26.5), DUST2.floorHigh, 'platform');
  addBox('a-hotel-north-wall', vec3(14, 2.4, -33), vec3(22.5, 8.2, -28.5), DUST2.wallBrick, 'wall');
  addBox('a-goose-north-wall', vec3(22.5, 2.4, -33), vec3(33, 8.2, -31.2), DUST2.wallBrick, 'wall');
  addBox('a-east-wall', vec3(31.5, 2.4, -31.2), vec3(33, 8.2, -26.5), DUST2.wall, 'wall');
  addBox(
    'a-south-parapet',
    vec3(14.0, 2.4, -21.5),
    vec3(24.0, 3.25, -21.0),
    DUST2.wallLight,
    'wall',
  );
  addBox(
    'a-east-parapet',
    vec3(24.0, 2.4, -26.2),
    vec3(24.5, 3.25, -21.0),
    DUST2.wallLight,
    'wall',
  );
  addBox('a-barrels', vec3(21.2, 2.4, -28.5), vec3(22.5, 3.85, -26.8), DUST2.crateBlue, 'crate');
  // Двойной & Плент (Turquoise-tarped military crates on Bombsite A)
  addBox(
    'a-default-box1',
    vec3(17.8, 2.4, -24.8),
    vec3(19.8, 3.8, -22.8),
    DUST2.crateTarp,
    'crate',
  );
  addBox('a-default-box2', vec3(19.8, 2.4, -24.8), vec3(21.6, 3.65, -23.0), DUST2.crate, 'crate');
  addBox(
    'a-default-top',
    vec3(18.0, 3.8, -24.6),
    vec3(19.6, 4.95, -23.0),
    DUST2.crateTarp,
    'crate',
  );

  // МОСТ / ПРОХОД С ШОРТА НА А (Overpass Bridge carrying A-Short over CT Spawn Underpass!)
  addBox(
    'short-bridge-deck',
    vec3(7.2, 2.2, -22.0),
    vec3(12.5, 2.4, -15.5),
    DUST2.floorHigh,
    'platform',
  );
  addBox(
    'short-bridge-east-parapet',
    vec3(12.0, 2.4, -22.0),
    vec3(12.5, 3.25, -16.5),
    DUST2.wallLight,
    'wall',
  );
  addBox('short-north-plat', vec3(7.2, 0, -33), vec3(14, 2.4, -22.0), DUST2.floorHigh, 'platform');
  addBox(
    'short-south-parapet',
    vec3(12.5, 2.4, -22.5),
    vec3(14.0, 3.25, -22.0),
    DUST2.wallLight,
    'wall',
  );
  addBox('short-north-wall', vec3(7.2, 2.4, -33), vec3(14, 8.2, -28.5), DUST2.wall, 'wall');
  // Ниндзя / Гендальф stacked crates on A-Short
  addBox(
    'a-ninja-crate1',
    vec3(11.4, 2.4, -28.3),
    vec3(13.8, 3.85, -26.5),
    DUST2.crateTarp,
    'crate',
  );
  addBox('a-ninja-crate2', vec3(12.0, 3.85, -28.1), vec3(13.6, 4.9, -26.7), DUST2.crate, 'crate');

  // БУСТ (Elevator Boost crates in CT Underpass: orange box moved to the right of green box so walkway is spacious!)
  addBox('ct-boost-high', vec3(12.5, 0, -20.4), vec3(14, 1.75, -18.8), DUST2.crateTarp, 'crate');
  addBox('ct-boost-low', vec3(12.5, 0, -22.0), vec3(14, 0.9, -20.4), DUST2.crate, 'crate');

  // ---------------------------------------------------------------------------
  // 4. NORTH-CENTER BELT: СТ МИДЛ, СТ СПАВН (UNDER BRIDGE), ГРИБЫ / ЗАЙЧИК (B SLOPE)
  // ---------------------------------------------------------------------------
  // Solid North Wall closing the old pocket so CT Spawn is located under the Short Bridge!
  addBox('ct-north-wall', vec3(-5.5, 0, -33.0), vec3(7.2, 8.2, -22.0), DUST2.wall, 'wall');
  addBox('ct-spawn-crate', vec3(2.2, 0, -21.8), vec3(4.2, 1.45, -20.0), DUST2.crateTarp, 'crate');
  addBox('ct-mid-east-building', vec3(1.5, 0, -16.5), vec3(6.5, 8.2, -6.5), DUST2.wall, 'wall');
  addBox('ct-mid-crate', vec3(-5.2, 0, -9.5), vec3(-3.5, 1.35, -7.8), DUST2.crate, 'crate');
  // Solid building block between CT Mid, Lower B Tunnels, and Bombsite B
  addBox('block-ct-b-south', vec3(-15, 0, -11), vec3(-5.5, 7.6, -2), DUST2.wall, 'wall');
  addBox('block-ct-b-se', vec3(-5.5, 0, -4), vec3(-3.5, 7.6, -2), DUST2.wall, 'wall');

  // 3 / ГРИБЫ / ЗАЙЧИК (Smooth slope from CT Mid y=0.0 up to B Doors & B Window landing y=1.2)
  addSlopeX('ct-b-slope', -5.5, -10.5, -28.0, -11.0, 0, 0.08, 1.2, 8, DUST2.floorMid);
  addBox('ct-b-slope-wall-n', vec3(-15.5, 0, -33.0), vec3(-5.5, 8.2, -28.0), DUST2.wall, 'wall');
  addBox(
    'ct-b-landing',
    vec3(-15.5, 0, -28.0),
    vec3(-10.5, 1.2, -11.0),
    DUST2.floorMid,
    'platform',
  );
  addBox('ct-mushrooms-rock', vec3(-12.2, 1.2, -12.6), vec3(-10.5, 2.0, -11), DUST2.rock, 'rock');
  addBox(
    'ct-zaichik-crate',
    vec3(-12.2, 1.2, -16.6),
    vec3(-10.6, 2.45, -15.0),
    DUST2.crate,
    'crate',
  );

  // ---------------------------------------------------------------------------
  // 5. WEST BELT: ТЕМКА (UPPER B TUNNELS), ВИНТ (SPIRAL STAIRS), ТЕМКА НИЗ (LOWER B TUNNELS),
  //    ПЛЕНТ B (BOMBSITE B), ТАНЦПОЛ, ДАЛЬНИЙ, ОКНО, ДВЕРИ
  // ---------------------------------------------------------------------------
  addBox('upper-tuns-floor', vec3(-33, 0, -4), vec3(-15, 1.2, 6), DUST2.tunnelFloor, 'platform');
  addBox('upper-tuns-west-wall', vec3(-33, 1.2, -4), vec3(-29.5, 4.8, 6), DUST2.tunnelWall, 'wall');
  addBox('upper-tuns-s-w', vec3(-29.5, 1.2, 5.2), vec3(-24.5, 4.8, 6), DUST2.tunnelWall, 'wall');
  addBox('upper-tuns-s-e', vec3(-20, 1.2, 5.2), vec3(-15, 4.8, 6), DUST2.tunnelWall, 'wall');
  addBox('upper-tuns-s-lintel', vec3(-24.5, 3.8, 5.2), vec3(-20, 4.8, 6), DUST2.arch, 'wall');
  // East wall of Upper Tunnels: open at z: 3.5 .. 5.8 so Upper Tunnels cannot be seen from Short/Mid!
  addBox('upper-tuns-e-n', vec3(-15.8, 1.2, -4), vec3(-15, 4.8, 3.5), DUST2.tunnelWall, 'wall');
  // Twin ornate columns positioned closer to the Titanic/Пески entrance (z: 2.4 .. 3.8)
  addBox('upper-tuns-col1', vec3(-25.5, 1.2, 2.4), vec3(-24.1, 4.8, 3.8), DUST2.column, 'column');
  addBox('upper-tuns-col2', vec3(-20.5, 1.2, 2.4), vec3(-19.1, 4.8, 3.8), DUST2.column, 'column');
  addBox('upper-tuns-crate', vec3(-29.2, 1.2, 0.2), vec3(-27.4, 2.5, 2.0), DUST2.crate, 'crate');
  addBox('upper-tuns-roof', vec3(-33, 4.8, -4), vec3(-15, 7.6, 6), DUST2.tunnelRoof, 'roof');

  // 1 (Тоннель Выход на B: shifted left & narrower x: -28.4 .. -25.2, z: -10 .. -4)
  addBox(
    'b-tun-exit-floor',
    vec3(-28.4, 0, -10),
    vec3(-25.2, 1.2, -4),
    DUST2.tunnelFloor,
    'platform',
  );
  addBox('b-tun-exit-wall-w', vec3(-33, 0, -10), vec3(-28.4, 7.6, -4), DUST2.tunnelWall, 'wall');
  addBox('b-tun-exit-wall-e', vec3(-25.2, 0, -10), vec3(-15, 7.6, -4), DUST2.tunnelWall, 'wall');
  addBox('b-tun-exit-roof', vec3(-28.4, 4.4, -10), vec3(-25.2, 7.6, -4), DUST2.tunnelRoof, 'roof');

  // ВИНТ (Circular/Spiral Staircase shielded by vint-sight-blocker so Upper Tunnels is NEVER visible from Short!)
  addBox(
    'vint-upper-landing',
    vec3(-15, 0, 3.5),
    vec3(-10.5, 1.2, 5.8),
    DUST2.tunnelFloor,
    'platform',
  );
  addBox('vint-inner-pillar', vec3(-15, 0, -2.0), vec3(-14.2, 3.8, 3.5), DUST2.tunnelWall, 'wall');
  addBox(
    'vint-sight-blocker',
    vec3(-10.5, 0, -0.4),
    vec3(-9.7, 3.8, 2.0),
    DUST2.tunnelWall,
    'wall',
  );
  addStairsZ('vint-stairs', -14.2, -10.5, 0.0, 3.5, 0, 1.2, 5, DUST2.tunnelFloor);
  addBox('vint-roof', vec3(-15, 3.8, 2.0), vec3(-10.5, 7.6, 5.8), DUST2.tunnelRoof, 'roof');

  // ТЕМКА НИЗ (Lower B Tunnels at y = 0.0, z: -2.0 .. +2.0) with full upper wall & arch opening onto Mid/Xbox/Зига!
  addBox('lower-tuns-crate', vec3(-7.8, 0, 0.5), vec3(-6.2, 1.25, 1.9), DUST2.crate, 'crate');
  addBox('lower-tuns-roof', vec3(-15, 3.8, -2), vec3(-3.5, 7.6, 2.0), DUST2.tunnelRoof, 'roof');
  addBox('lower-tuns-mid-arch', vec3(-4.2, 2.8, -2), vec3(-3.5, 3.8, 2.0), DUST2.arch, 'wall');

  // ПЛЕНТ B (BOMBSITE B, x: -33 .. -15.5, z: -33 .. -10, y = 1.2)
  addBox('b-site-floor', vec3(-33, 0, -33), vec3(-15.5, 1.2, -10), DUST2.floorMid, 'platform');
  addBox('b-west-wall', vec3(-33, 1.2, -33), vec3(-31.2, 7.6, -10), DUST2.wall, 'wall');
  addBox('b-north-wall', vec3(-31.2, 1.2, -33), vec3(-15.5, 7.6, -31.2), DUST2.wall, 'wall');
  // Буст (Stacked crates immediately right of narrowed B Tunnel exit)
  addBox('b-boost-box1', vec3(-24.8, 1.2, -11.8), vec3(-23.0, 2.4, -10), DUST2.crate, 'crate');
  addBox(
    'b-boost-box2',
    vec3(-24.6, 2.4, -11.6),
    vec3(-23.2, 3.45, -10.2),
    DUST2.crateTarp,
    'crate',
  );
  // Машина (B Car) & Нычка (Closet) to the left of B Tunnel exit
  addBox('b-car-body', vec3(-31.0, 1.2, -15.8), vec3(-28.4, 2.4, -12.2), DUST2.car, 'crate');
  addBox('b-closet-crate', vec3(-31.0, 1.2, -18.2), vec3(-29.4, 2.45, -16.6), DUST2.crate, 'crate');
  // Танцпол low wooden divider wall (высота 0.55 м для легкого перепрыгивания на бегу)
  addBox(
    'b-dancefloor-fence',
    vec3(-25.8, 1.2, -24.5),
    vec3(-25.3, 1.75, -17.0),
    DUST2.door,
    'wall',
  );
  // Дальний (Raised Back Plat at y = 1.65) & Огурец crates
  addBox(
    'b-back-plat',
    vec3(-31.2, 1.2, -31.2),
    vec3(-19.5, 1.65, -25.5),
    DUST2.floorHigh,
    'platform',
  );
  addSlopeX('b-back-slope', -17.9, -19.5, -29.5, -26.8, 1.2, 1.28, 1.65, 3, DUST2.floorHigh);
  addBox('b-far-crate', vec3(-30.8, 1.65, -30.8), vec3(-28.8, 2.95, -28.8), DUST2.crate, 'crate');
  addBox(
    'b-ogurets-crate',
    vec3(-23.8, 1.65, -30.8),
    vec3(-21.6, 2.95, -28.8),
    DUST2.crateTarp,
    'crate',
  );
  // Квадрат: Бокс (Big Box), Б2 (Central Brick Pillar), Б3 (North Crate)
  addBox('b-big-box', vec3(-24.6, 1.2, -17.6), vec3(-22.2, 2.85, -15.2), DUST2.crate, 'crate');
  addBox(
    'b-b2-pillar',
    vec3(-21.6, 1.2, -19.8),
    vec3(-19.8, 4.6, -18.0),
    DUST2.wallBrick,
    'column',
  );
  addBox('b-b3-crate', vec3(-21.8, 1.2, -23.4), vec3(-19.8, 2.55, -21.4), DUST2.crateTarp, 'crate');

  // East wall of Bombsite B with angled ДВЕРИ B and raised/shifted ОКНО B (z: -26.8 .. -23.8, y = 2.85)
  addBox('b-east-wall-s', vec3(-16.3, 1.2, -13.6), vec3(-15.5, 7.6, -10), DUST2.wall, 'wall');
  addBox('b-doors-lintel', vec3(-16.3, 3.8, -16.8), vec3(-15.5, 7.6, -13.6), DUST2.arch, 'wall');
  // Две створки одинаковой длины 1.51 м:
  // Северная створка (дальняя от КТ) открыта вглубь сайта Б (-X, угол ~34.2°)
  // Южная створка (ближняя к КТ) открыта наружу в сторону КТ (+X, угол ~34.2°)
  // Зазор при прямом просмотре и широкий S-образный проход (как в КС2: example1.png, example2.png)
  addBox('b-door-leaf-n', vec3(-16.81, 1.2, -16.8), vec3(-15.84, 3.8, -15.49), DUST2.door, 'crate');
  addBox('b-door-leaf-s', vec3(-15.96, 1.2, -14.91), vec3(-14.99, 3.8, -13.6), DUST2.door, 'crate');
  addBox('b-east-wall-mid', vec3(-16.3, 1.2, -23.8), vec3(-15.5, 7.6, -16.8), DUST2.wall, 'wall');
  addBox(
    'b-window-sill',
    vec3(-16.3, 1.2, -26.8),
    vec3(-15.5, 2.85, -23.8),
    DUST2.wallBrick,
    'wall',
  );
  addBox('b-window-lintel', vec3(-16.3, 4.85, -26.8), vec3(-15.5, 7.6, -23.8), DUST2.arch, 'wall');
  addBox(
    'b-win-step-ct-low',
    vec3(-15.5, 1.2, -25.0),
    vec3(-13.9, 1.75, -23.6),
    DUST2.crate,
    'platform',
  );
  addBox(
    'b-win-step-ct-high',
    vec3(-15.5, 1.2, -26.8),
    vec3(-13.9, 2.25, -25.0),
    DUST2.crate,
    'platform',
  );
  addBox(
    'b-win-step-b-low',
    vec3(-17.9, 1.2, -25.0),
    vec3(-16.3, 1.75, -23.6),
    DUST2.crate,
    'platform',
  );
  addBox(
    'b-win-step-b-high',
    vec3(-17.9, 1.2, -26.8),
    vec3(-16.3, 2.25, -25.0),
    DUST2.crate,
    'platform',
  );
  addBox('b-east-wall-n', vec3(-16.3, 1.2, -31.2), vec3(-15.5, 7.6, -26.8), DUST2.wall, 'wall');

  // ---------------------------------------------------------------------------
  // 6. BOMB SITES A & B
  // ---------------------------------------------------------------------------
  const bombSites: BombSite[] = [
    {
      id: 'A',
      name: 'A',
      center: vec3(19.6, 2.4, -24.2),
      min: vec3(15.2, 2.1, -28.0),
      max: vec3(24.0, 5.2, -21.5),
    },
    {
      id: 'B',
      name: 'B',
      center: vec3(-21.8, 1.2, -19.5),
      min: vec3(-25.2, 0.9, -24.2),
      max: vec3(-17.8, 4.2, -14.8),
    },
  ];

  // ---------------------------------------------------------------------------
  // 7. SPAWNS (alpha = T-Spawn on South y=2.4, bravo = CT-Spawn under Short Bridge y=0.0)
  // ---------------------------------------------------------------------------
  const spawns: SpawnPoint[] = [
    { id: 't-spawn-1', team: 'alpha', position: vec3(-6.0, 2.41, 30.2), yaw: 0 },
    { id: 't-spawn-2', team: 'alpha', position: vec3(-2.0, 2.41, 30.5), yaw: 0 },
    { id: 't-spawn-3', team: 'alpha', position: vec3(2.0, 2.41, 30.5), yaw: 0 },
    { id: 't-spawn-4', team: 'alpha', position: vec3(6.0, 2.41, 30.2), yaw: 0 },
    { id: 'ct-spawn-1', team: 'bravo', position: vec3(8.5, 0.01, -20.5), yaw: Math.PI },
    { id: 'ct-spawn-2', team: 'bravo', position: vec3(10.8, 0.01, -20.5), yaw: Math.PI },
    { id: 'ct-spawn-3', team: 'bravo', position: vec3(8.5, 0.01, -18.2), yaw: Math.PI },
    { id: 'ct-spawn-4', team: 'bravo', position: vec3(10.8, 0.01, -18.2), yaw: Math.PI },
  ];

  return {
    id: 'de_dust2',
    name: 'de_dust2',
    mode: 'buy',
    size: 68,
    sizeZ: 68,
    height: 12,
    boxes,
    spawns,
    weaponSpawns: [],
    armorSpawns: [],
    bombSites,
    theme: DUST2_THEME,
  };
}

export const FY_WOW_MAP: ArenaMap = buildWowArena();
export const FY_SAND_MAP: ArenaMap = buildSandArena();
export const DE_DUST2_MAP: ArenaMap = buildDust2Arena();

export const MAPS: Record<MapId, ArenaMap> = {
  fy_wow: FY_WOW_MAP,
  fy_sand: FY_SAND_MAP,
  de_dust2: DE_DUST2_MAP,
};

export const MAP_IDS: readonly MapId[] = ['fy_sand', 'fy_wow', 'de_dust2'];
export const DEFAULT_MAP_ID: MapId = 'fy_sand';
export const ARENA_MAP: ArenaMap = FY_SAND_MAP;

export function getMapById(id: string): ArenaMap | undefined {
  const key = id.trim().toLowerCase();
  const mapId = MAP_IDS.find((candidate) => candidate === key);
  return mapId === undefined ? undefined : MAPS[mapId];
}

export function getSpawnsForTeam(map: ArenaMap, team: Team): SpawnPoint[] {
  return map.spawns.filter((spawn) => spawn.team === team);
}

export function findBombSiteAt(map: ArenaMap, position: Vec3): BombSite | null {
  for (const site of map.bombSites) {
    if (
      position.x >= site.min.x &&
      position.x <= site.max.x &&
      position.z >= site.min.z &&
      position.z <= site.max.z &&
      position.y >= site.min.y &&
      position.y <= site.max.y
    ) {
      return site;
    }
  }
  return null;
}
