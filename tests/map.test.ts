import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../shared/config';
import {
  ARENA_MAP,
  DE_DUST2_MAP,
  DEFAULT_MAP_ID,
  FY_SAND_MAP,
  FY_WOW_MAP,
  MAP_IDS,
  MAPS,
  findBombSiteAt,
  getMapById,
  getSpawnsForTeam,
  type ArenaMap,
} from '../shared/map';
import { canStand, isSupported } from '../server/game/physics';
import { createPlayer } from '../server/game/player';

const FIREARMS = ['deagle', 'ak47', 'm4a1', 'awp', 'mp5', 'm249'] as const;

function expectGeometryInsideBounds(map: ArenaMap): void {
  const limitX = map.size / 2 + 0.5;
  const limitZ = map.sizeZ / 2 + 0.5;
  for (const box of map.boxes) {
    expect(box.min.x, box.id).toBeGreaterThanOrEqual(-limitX);
    expect(box.max.x, box.id).toBeLessThanOrEqual(limitX);
    expect(box.min.z, box.id).toBeGreaterThanOrEqual(-limitZ);
    expect(box.max.z, box.id).toBeLessThanOrEqual(limitZ);
    expect(box.min.y, box.id).toBeLessThanOrEqual(box.max.y);
  }
}

function expectUniqueIds(map: ArenaMap): void {
  const ids = [
    ...map.boxes.map((box) => box.id),
    ...map.spawns.map((spawn) => spawn.id),
    ...map.weaponSpawns.map((spawn) => spawn.id),
    ...map.armorSpawns.map((spawn) => spawn.id),
  ];
  expect(new Set(ids).size, map.id).toBe(ids.length);
}

function expectPickupsClearOfSolidGeometry(map: ArenaMap): void {
  const pickups = [
    ...map.weaponSpawns.map((spawn) => ({ id: spawn.id, position: spawn.position })),
    ...map.armorSpawns.map((spawn) => ({ id: spawn.id, position: spawn.position })),
  ];
  for (const pickup of pickups) {
    for (const box of map.boxes) {
      if (box.kind === 'floor' || box.kind === 'platform') {
        continue;
      }
      const { x, y, z } = pickup.position;
      const inside =
        x > box.min.x &&
        x < box.max.x &&
        y > box.min.y &&
        y < box.max.y &&
        z > box.min.z &&
        z < box.max.z;
      expect(inside, `${map.id}/${pickup.id} intersects ${box.id}`).toBe(false);
    }
  }
}

describe('map registry', () => {
  it('exposes all maps with fy_sand as the default', () => {
    expect(MAP_IDS).toEqual(['fy_sand', 'fy_wow', 'de_dust2']);
    expect(DEFAULT_MAP_ID).toBe('fy_sand');
    expect(ARENA_MAP).toBe(FY_SAND_MAP);
    expect(MAPS.fy_sand).toBe(FY_SAND_MAP);
    expect(MAPS.fy_wow).toBe(FY_WOW_MAP);
    expect(MAPS.de_dust2).toBe(DE_DUST2_MAP);
  });

  it('looks maps up by id and rejects unknown or inherited ids', () => {
    expect(getMapById('fy_sand')).toBe(FY_SAND_MAP);
    expect(getMapById(' FY_WOW ')).toBe(FY_WOW_MAP);
    expect(getMapById('de_dust2')).toBe(DE_DUST2_MAP);
    expect(getMapById('de_mirage')).toBeUndefined();
    expect(getMapById('__proto__')).toBeUndefined();
    expect(getMapById('constructor')).toBeUndefined();
    expect(getMapById('toString')).toBeUndefined();
  });
});

describe('fy_sand arena map', () => {
  it('is a 44x33.2 BSP-derived desert arena', () => {
    expect(FY_SAND_MAP.id).toBe('fy_sand');
    expect(FY_SAND_MAP.name).toBe('fy_sand');
    expect(FY_SAND_MAP.size).toBe(44);
    expect(FY_SAND_MAP.sizeZ).toBe(33.2);
    expect(FY_SAND_MAP.height).toBe(10);
    expect(FY_SAND_MAP.boxes.length).toBeGreaterThan(70);
    expect(FY_SAND_MAP.theme.accent).toBeTruthy();
  });

  it('has unique box, spawn, and pickup ids', () => {
    expectUniqueIds(FY_SAND_MAP);
  });

  it('provides twelve spawns for each team on opposite bases', () => {
    const alpha = getSpawnsForTeam(FY_SAND_MAP, 'alpha');
    const bravo = getSpawnsForTeam(FY_SAND_MAP, 'bravo');
    expect(alpha).toHaveLength(12);
    expect(bravo).toHaveLength(12);
    expect(alpha.every((spawn) => spawn.position.x < 0)).toBe(true);
    expect(bravo.every((spawn) => spawn.position.x > 0)).toBe(true);
    expect(alpha.every((spawn) => spawn.position.y > 0)).toBe(true);
    expect(bravo.every((spawn) => spawn.position.y > 0)).toBe(true);
  });

  it('contains two-storey buildings, garages, roofs, ladders, and stairs', () => {
    const kinds = new Set(FY_SAND_MAP.boxes.map((box) => box.kind));
    expect(kinds).toContain('floor');
    expect(kinds).toContain('wall');
    expect(kinds).toContain('crate');
    expect(kinds).toContain('platform');
    expect(kinds).toContain('column');
    expect(kinds).toContain('roof');
    expect(kinds).toContain('ladder');
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'tl-garage')).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'br-garage')).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'tl-garage-ladder')).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'br-garage-ladder')).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'tr-floor2')).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'bl-floor2')).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'tr-roof')).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'bl-roof')).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id.startsWith('tr-stair-'))).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id.startsWith('bl-stair-'))).toBe(true);

    const lowBarrier = FY_SAND_MAP.boxes.find((box) => box.id.startsWith('center-peek-'));
    expect(lowBarrier?.max.y).toBeLessThanOrEqual(2);
  });

  it('opens doors toward spawns and aligns stair tops with the upper floor', () => {
    const groundTrEast = FY_SAND_MAP.boxes.filter(
      (box) => box.id.startsWith('tr-east') && box.min.y < 3.45,
    );
    const doorTr = groundTrEast.filter(
      (box) => box.min.z < -3.2 && box.max.z > -4.6 && box.min.y < 2.39,
    );
    expect(doorTr).toHaveLength(0);

    const groundBlWest = FY_SAND_MAP.boxes.filter(
      (box) => box.id.startsWith('bl-west') && box.min.y < 3.85,
    );
    const doorBl = groundBlWest.filter(
      (box) => box.min.z < 7.6 && box.max.z > 6.0 && box.min.y < 2.39,
    );
    expect(doorBl).toHaveLength(0);

    for (const [wall, z0, z1, floor] of [
      ['tr-east', -9.8, -8.6, 3.45],
      ['bl-west', 3.2, 4.4, 3.85],
    ] as const) {
      const below = FY_SAND_MAP.boxes.find(
        (box) =>
          box.id.startsWith(wall) &&
          box.id.includes('below') &&
          box.min.z <= z0 + 0.01 &&
          box.max.z >= z1 - 0.01,
      );
      const above = FY_SAND_MAP.boxes.find(
        (box) =>
          box.id.startsWith(wall) &&
          box.id.includes('above') &&
          box.min.z <= z0 + 0.01 &&
          box.max.z >= z1 - 0.01,
      );
      expect(below?.max.y).toBeCloseTo(1.2, 2);
      expect(above?.min.y).toBeCloseTo(2.2, 2);
      expect(above?.max.y).toBeCloseTo(floor, 2);
    }

    const trTop = FY_SAND_MAP.boxes.find((box) => box.id === 'tr-stair-10');
    const blTop = FY_SAND_MAP.boxes.find((box) => box.id === 'bl-stair-10');
    expect(trTop?.max.y).toBeCloseTo(3.45, 2);
    expect(blTop?.max.y).toBeCloseTo(3.85, 2);
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'tr-stair-rail')).toBe(true);
    expect(FY_SAND_MAP.boxes.some((box) => box.id === 'bl-stair-rail')).toBe(true);
  });

  it('offers twelve firearms, four HE grenades, and two armor pickups', () => {
    expect(FY_SAND_MAP.weaponSpawns).toHaveLength(16);
    for (const weapon of FIREARMS) {
      expect(FY_SAND_MAP.weaponSpawns.filter((spawn) => spawn.weapon === weapon)).toHaveLength(2);
    }
    expect(FY_SAND_MAP.weaponSpawns.filter((spawn) => spawn.weapon === 'hegrenade')).toHaveLength(
      4,
    );
    expect(FY_SAND_MAP.armorSpawns).toHaveLength(2);
    expect(FY_SAND_MAP.armorSpawns.every((spawn) => spawn.amount === 100)).toBe(true);
  });

  it('keeps geometry and pickups clear of each other', () => {
    expectGeometryInsideBounds(FY_SAND_MAP);
    expectPickupsClearOfSolidGeometry(FY_SAND_MAP);
  });
});

describe('fy_wow arena map', () => {
  it('keeps the original 40x40 arena', () => {
    expect(FY_WOW_MAP.id).toBe('fy_wow');
    expect(FY_WOW_MAP.name).toBe('fy_wow');
    expect(FY_WOW_MAP.size).toBe(40);
    expect(FY_WOW_MAP.boxes.length).toBeGreaterThan(20);
    expect(FY_WOW_MAP.armorSpawns).toHaveLength(0);
  });

  it('has unique box, spawn, and pickup ids', () => {
    expectUniqueIds(FY_WOW_MAP);
  });

  it('provides two spawns for each team on opposite bases', () => {
    const alpha = getSpawnsForTeam(FY_WOW_MAP, 'alpha');
    const bravo = getSpawnsForTeam(FY_WOW_MAP, 'bravo');
    expect(alpha).toHaveLength(2);
    expect(bravo).toHaveLength(2);
    expect(alpha.every((spawn) => spawn.position.z < 0)).toBe(true);
    expect(bravo.every((spawn) => spawn.position.z > 0)).toBe(true);
  });

  it('mirrors the two bases and includes cover', () => {
    const kinds = new Set(FY_WOW_MAP.boxes.map((box) => box.kind));
    expect(kinds).toContain('floor');
    expect(kinds).toContain('wall');
    expect(kinds).toContain('crate');
    expect(kinds).toContain('platform');
    expect(kinds).toContain('column');
    expect(FY_WOW_MAP.boxes.some((box) => box.id.startsWith('center-'))).toBe(false);
    const lowBarrier = FY_WOW_MAP.boxes.find((box) => box.id === 'low-barrier-a');
    expect(lowBarrier?.max.y).toBeLessThanOrEqual(MOVEMENT.stepHeight);
  });

  it('has no ground weapon pickups in the buy mode', () => {
    expect(FY_WOW_MAP.weaponSpawns).toHaveLength(0);
    expect(FY_WOW_MAP.armorSpawns).toHaveLength(0);
  });

  it('keeps geometry and pickups clear of each other', () => {
    expectGeometryInsideBounds(FY_WOW_MAP);
    expectPickupsClearOfSolidGeometry(FY_WOW_MAP);
  });
});

describe('de_dust2 bomb map', () => {
  it('is a 68x68 tactical CS2 Dust2 map in buy mode with bomb sites A and B', () => {
    expect(DE_DUST2_MAP.id).toBe('de_dust2');
    expect(DE_DUST2_MAP.name).toBe('de_dust2');
    expect(DE_DUST2_MAP.mode).toBe('buy');
    expect(DE_DUST2_MAP.size).toBe(68);
    expect(DE_DUST2_MAP.sizeZ).toBe(68);
    expect(DE_DUST2_MAP.weaponSpawns).toEqual([]);
    expect(DE_DUST2_MAP.armorSpawns).toEqual([]);
    expect(DE_DUST2_MAP.bombSites.map((s) => s.id)).toEqual(['A', 'B']);
    for (const site of DE_DUST2_MAP.bombSites) {
      expect(findBombSiteAt(DE_DUST2_MAP, site.center)?.id).toBe(site.id);
    }
  });

  it('has unique ids, in-bounds geometry, and unobstructed supported spawns', () => {
    expectUniqueIds(DE_DUST2_MAP);
    expectGeometryInsideBounds(DE_DUST2_MAP);

    const alpha = getSpawnsForTeam(DE_DUST2_MAP, 'alpha');
    const bravo = getSpawnsForTeam(DE_DUST2_MAP, 'bravo');
    expect(alpha.length).toBeGreaterThanOrEqual(4);
    expect(bravo.length).toBeGreaterThanOrEqual(4);

    for (const spawn of DE_DUST2_MAP.spawns) {
      const dummy = createPlayer(
        spawn.id,
        'tok',
        'Test',
        spawn.team,
        1_000,
        spawn.position,
        spawn.yaw,
      );
      expect(canStand(dummy, DE_DUST2_MAP), `canStand at ${spawn.id}`).toBe(true);
      expect(isSupported(dummy, DE_DUST2_MAP), `isSupported at ${spawn.id}`).toBe(true);
    }
  });

  it('has zero overlapping 3D box volumes to prevent Z-fighting', () => {
    const boxes = DE_DUST2_MAP.boxes;
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      const a = boxes[i]!;
      for (let j = i + 1; j < boxes.length; j += 1) {
        const b = boxes[j]!;
        const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
        const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
        const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
        if (ox > 0.001 && oy > 0.001 && oz > 0.001) {
          overlaps.push(`${a.id} <-> ${b.id} (${ox.toFixed(2)}x${oy.toFixed(2)}x${oz.toFixed(2)})`);
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('includes all CS2 Dust2 callouts and supports standing at every key zone (including 2-level Short bridge / CT underpass and passable doorways)', () => {
    const ids = new Set(DE_DUST2_MAP.boxes.map((box) => box.id));
    expect(ids.has('xbox-step')).toBe(true);
    expect(ids.has('xbox-main')).toBe(true);
    expect(ids.has('mid-door-leaf-w')).toBe(true);
    expect(ids.has('mid-door-leaf-e')).toBe(true);
    expect(ids.has('parapet-flat-entry')).toBe(true);
    expect(ids.has('parapet-west-fence')).toBe(true);
    expect(ids.has('ziga-floor')).toBe(true);
    expect(ids.has('ziga-ct-divider-wall')).toBe(true);
    expect(ids.has('ziga-west-fence')).toBe(true);
    expect(ids.has('short-west-solid-wall')).toBe(true);
    expect(ids.has('short-bridge-west-wall')).toBe(true);
    expect(ids.has('short-bridge-deck')).toBe(true);
    expect(ids.has('short-bridge-east-parapet')).toBe(true);
    expect(ids.has('t-spawn-suicide-fence')).toBe(true);
    expect(ids.has('ct-north-wall')).toBe(true);
    expect(ids.has('a-ninja-crate1')).toBe(true);
    expect(ids.has('banka-west-wall')).toBe(true);
    expect(ids.has('banka-roof')).toBe(true);
    expect(ids.has('long-blue-container')).toBe(true);
    expect(ids.has('prosvet-headshot-box')).toBe(true);
    expect(ids.has('a-goose-plat')).toBe(true);
    expect(ids.has('a-south-parapet')).toBe(true);
    expect(ids.has('a-east-parapet')).toBe(true);
    expect(ids.has('a-default-box1')).toBe(true);
    expect(ids.has('ct-boost-low')).toBe(true);
    expect(ids.has('upper-tuns-roof')).toBe(true);
    expect(ids.has('lower-tuns-roof')).toBe(true);
    expect(ids.has('lower-tuns-mid-arch')).toBe(true);
    expect(ids.has('vint-upper-landing')).toBe(true);
    expect(ids.has('vint-sight-blocker')).toBe(true);
    expect(ids.has('vint-stairs-step-1')).toBe(true);
    expect(ids.has('b-big-box')).toBe(true);
    expect(ids.has('b-b2-pillar')).toBe(true);
    expect(ids.has('b-b3-crate')).toBe(true);
    expect(ids.has('b-dancefloor-fence')).toBe(true);
    expect(ids.has('b-window-sill')).toBe(true);
    expect(ids.has('b-win-step-ct-high')).toBe(true);
    expect(ids.has('b-win-step-b-high')).toBe(true);
    expect(ids.has('b-back-plat')).toBe(true);
    expect(ids.has('suicide-ceiling')).toBe(true);

    const calloutPositions: ReadonlyArray<readonly [string, number, number, number]> = [
      ['T-Spawn', 0, 2.41, 30.2],
      ['Titanic', -18.0, 2.41, 25.0],
      ['Peski (Outside Tunnels)', -22.0, 1.21, 10.0],
      ['Suicide (20 Low Alley under Ceiling)', 0.0, 0.61, 19.5],
      ['Ploschad (Outside Long)', 16.0, 1.21, 20.0],
      ['Palm / Top Mid', -1.0, 1.21, 11.5],
      ['Mid Flat Before Doors', -1.2, 0.01, 1.0],
      ['Mid Doors Diagonal Passage (CT Entry)', -1.7, 0.01, -2.5],
      ['Mid Doors Diagonal Passage (Middle)', -1.0, 0.01, -1.7],
      ['Mid Doors Diagonal Passage (Xbox Exit)', -0.05, 0.01, -0.9],
      ['Parapet Entry', 3.0, 1.21, 8.0],
      ['Ziga', 6.0, 2.01, -2.5],
      ['A-Short Flat', 9.8, 2.01, -8.5],
      ['Short Bridge (Upper Level)', 9.8, 2.41, -18.5],
      ['CT Spawn Under Bridge (Lower Level)', 9.6, 0.01, -19.2],
      ['Banka South Doors Gap', 17.6, 1.61, 11.65],
      ['Banka (Long House)', 17.6, 1.61, 7.0],
      ['Banka North Doors Gap', 17.6, 1.61, 2.85],
      ['Long Doors Spacious Yard', 19.5, 1.61, -1.5],
      ['Pit (Deep Yama)', 28.0, 0.01, 8.0],
      ['Long A (Narrower Dlina)', 28.0, 1.61, -8.0],
      ['Prosvet', 20.0, 1.61, -18.5],
      ['Bombsite A', 19.6, 2.41, -25.6],
      ['Goose (Gus)', 26.5, 2.41, -29.0],
      ['CT Mid', -1.5, 0.01, -12.0],
      ['B Doors Landing', -13.5, 1.21, -15.2],
      ['B Doors Diagonal Passage', -16.45, 1.21, -15.2],
      ['B Window Sill (Jumpable from Both Sides)', -15.9, 2.86, -25.3],
      ['Upper B Tunnels (Temka)', -22.5, 1.21, 0.5],
      ['B Tunnel Narrow Exit', -26.8, 1.21, -7.0],
      ['Vint Circular Landing', -12.5, 1.21, 4.5],
      ['Lower B Tunnels (Temka Niz)', -6.5, 0.01, -1.0],
      ['Bombsite B', -22.8, 1.21, -19.5],
      ['Dancefloor (Tancpol)', -28.5, 1.21, -20.5],
      ['Back Plat (Dalniy)', -26.0, 1.66, -28.0],
    ];

    for (const [name, x, y, z] of calloutPositions) {
      const dummy = createPlayer(name, 'tok', name, 'alpha', 1_000, { x, y, z }, 0);
      expect(canStand(dummy, DE_DUST2_MAP), `canStand at ${name}`).toBe(true);
      expect(isSupported(dummy, DE_DUST2_MAP), `isSupported at ${name}`).toBe(true);
    }
  });
});
