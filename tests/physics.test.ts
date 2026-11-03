import { describe, expect, it } from 'vitest';
import { addWeapon } from '../server/game/inventory';
import {
  aabbOverlaps,
  canStand,
  isSupported,
  overlappingBoxes,
  playerAabb,
  simulatePlayer,
} from '../server/game/physics';
import { playerHeight } from '../server/game/player';
import { vec3 } from '../shared/math';
import type { ArenaMap } from '../shared/map';
import { makeFlatMap, makeInput, makePlayer } from './helpers';

function mapWithBoxes(boxes: ArenaMap['boxes']): ArenaMap {
  const map = makeFlatMap();
  map.boxes.push(...boxes);
  return map;
}

const stepMap = mapWithBoxes([
  {
    id: 'step',
    min: vec3(-1, 0, -1),
    max: vec3(1, 0.2, -0.5),
    color: '#222222',
    kind: 'ramp',
  },
]);

const wallMap = mapWithBoxes([
  {
    id: 'wall',
    min: vec3(-2, 0, -2),
    max: vec3(2, 3, -1.5),
    color: '#222222',
    kind: 'wall',
  },
]);

const ceilingMap = mapWithBoxes([
  {
    id: 'ceiling',
    min: vec3(-2, 1.2, -2),
    max: vec3(2, 2.2, 2),
    color: '#222222',
    kind: 'wall',
  },
]);

describe('player physics', () => {
  it('builds player AABBs with the correct crouch height', () => {
    const player = makePlayer({ position: vec3(1, 0, 2) });
    const standing = playerAabb(player);
    expect(standing.min.x).toBeCloseTo(0.64);
    expect(standing.min.y).toBeCloseTo(0);
    expect(standing.min.z).toBeCloseTo(1.64);
    expect(standing.max.x).toBeCloseTo(1.36);
    expect(standing.max.y).toBeCloseTo(1.8);
    expect(standing.max.z).toBeCloseTo(2.36);
    player.crouching = true;
    expect(playerHeight(player)).toBe(1.2);
    expect(playerAabb(player).max.y).toBe(1.2);
  });

  it('detects AABB overlap and support', () => {
    expect(
      aabbOverlaps(
        { min: vec3(0, 0, 0), max: vec3(1, 1, 1) },
        { min: vec3(0.5, 0.5, 0.5), max: vec3(2, 2, 2) },
      ),
    ).toBe(true);
    expect(
      aabbOverlaps(
        { min: vec3(0, 0, 0), max: vec3(1, 1, 1) },
        { min: vec3(1, 0, 0), max: vec3(2, 1, 1) },
      ),
    ).toBe(false);

    const player = makePlayer({ position: vec3(0, 0, 0) });
    expect(isSupported(player, makeFlatMap())).toBe(true);
    player.position.y = 1;
    expect(isSupported(player, makeFlatMap())).toBe(false);
  });

  it('accelerates forward and stays grounded on flat ground', () => {
    const player = makePlayer({ position: vec3(0, 0, 0) });
    const map = makeFlatMap();
    for (let index = 0; index < 12; index += 1) {
      simulatePlayer(player, makeInput({ forward: 1, yaw: 0 }), 1 / 30, map, 1_000 + index * 33);
    }
    expect(player.position.z).toBeLessThan(-0.15);
    expect(player.position.y).toBeCloseTo(0);
    expect(player.grounded).toBe(true);
    expect(Math.abs(player.velocity.x)).toBeLessThan(0.001);
  });

  it('jumps, falls, and lands on the floor', () => {
    const player = makePlayer({ position: vec3(0, 0, 0) });
    const map = makeFlatMap();
    simulatePlayer(player, makeInput({ jump: true }), 1 / 30, map, 1_000);
    expect(player.position.y).toBeGreaterThan(0);
    expect(player.velocity.y).toBeGreaterThan(0);
    expect(player.grounded).toBe(false);

    for (let index = 0; index < 120; index += 1) {
      simulatePlayer(player, makeInput({ seq: 2 + index }), 1 / 30, map, 1_100 + index * 33);
    }
    expect(player.position.y).toBeCloseTo(0);
    expect(player.grounded).toBe(true);
  });

  it('crouches and stands back up when there is room', () => {
    const player = makePlayer({ position: vec3(0, 0, 0) });
    const map = makeFlatMap();
    simulatePlayer(player, makeInput({ crouch: true }), 1 / 30, map, 1_000);
    expect(player.crouching).toBe(true);
    expect(playerHeight(player)).toBe(1.2);

    simulatePlayer(player, makeInput({ crouch: false }), 1 / 30, map, 1_033);
    expect(player.crouching).toBe(false);
    expect(playerHeight(player)).toBe(1.8);
  });

  it('refuses to stand under a low ceiling', () => {
    const player = makePlayer({ position: vec3(0, 0, 0), crouching: true });
    expect(canStand(player, ceilingMap)).toBe(false);
    expect(overlappingBoxes(player, ceilingMap)).toHaveLength(0);
  });

  it('steps onto low geometry', () => {
    const player = makePlayer({ position: vec3(0, 0, 0) });
    for (let index = 0; index < 8; index += 1) {
      simulatePlayer(
        player,
        makeInput({ forward: 1, seq: index + 1 }),
        1 / 30,
        stepMap,
        1_000 + index * 33,
      );
    }
    expect(player.position.y).toBeCloseTo(0.201, 2);
    expect(player.position.z).toBeLessThan(-0.5);
  });

  it('is blocked by tall walls', () => {
    const player = makePlayer({ position: vec3(0, 0, 0) });
    for (let index = 0; index < 40; index += 1) {
      simulatePlayer(
        player,
        makeInput({ forward: 1, seq: index + 1 }),
        1 / 30,
        wallMap,
        1_000 + index * 33,
      );
    }
    expect(player.position.z).toBeGreaterThan(-1.25);
    expect(player.position.y).toBeCloseTo(0);
  });

  it('climbs a ladder while forward is held', () => {
    const ladderMap = mapWithBoxes([
      {
        id: 'ladder',
        min: vec3(-0.5, 0, -0.5),
        max: vec3(0.5, 3, 0.5),
        color: '#222222',
        kind: 'ladder',
      },
    ]);
    const player = makePlayer({ position: vec3(0, 0, 0) });
    simulatePlayer(player, makeInput({ forward: 1 }), 1 / 30, ladderMap, 1_000);
    expect(player.position.y).toBeGreaterThan(0);
    expect(player.velocity.y).toBeCloseTo(3.6);
    expect(player.grounded).toBe(false);
  });

  it('moves slower while walk is held', () => {
    const map = makeFlatMap();
    const normal = makePlayer({ position: vec3(0, 0, 0) });
    const walking = makePlayer({ position: vec3(0, 0, 0) });
    for (let index = 0; index < 24; index += 1) {
      simulatePlayer(
        normal,
        makeInput({ forward: 1, seq: index + 1 }),
        1 / 30,
        map,
        1_000 + index * 33,
      );
      simulatePlayer(
        walking,
        makeInput({ forward: 1, walk: true, seq: index + 1 }),
        1 / 30,
        map,
        1_000 + index * 33,
      );
    }
    expect(Math.abs(walking.position.z)).toBeLessThan(Math.abs(normal.position.z) * 0.75);
  });

  it('grabs a ladder from its side and snaps to the centre line', () => {
    const ladderMap = mapWithBoxes([
      {
        id: 'wide-ladder',
        min: vec3(-1, 0, -0.1),
        max: vec3(1, 3, 0.1),
        color: '#222222',
        kind: 'ladder',
      },
    ]);
    const player = makePlayer({ position: vec3(0.82, 0, 0.7) });
    for (let index = 0; index < 10; index += 1) {
      simulatePlayer(
        player,
        makeInput({ forward: 1, seq: index + 1 }),
        1 / 30,
        ladderMap,
        1_000 + index * 33,
      );
    }
    expect(player.position.x).toBeCloseTo(0, 1);
    expect(player.position.y).toBeGreaterThan(0.5);
    expect(player.grounded).toBe(false);
  });

  it('reports fall speed on landing', () => {
    const player = makePlayer({ position: vec3(0, 8, 0), grounded: false });
    const map = makeFlatMap();
    let fallSpeed = 0;
    for (let index = 0; index < 120; index += 1) {
      const result = simulatePlayer(
        player,
        makeInput({ seq: index + 1 }),
        1 / 30,
        map,
        1_000 + index * 33,
      );
      fallSpeed = Math.max(fallSpeed, result.fallSpeed);
      if (player.grounded && index > 1) {
        break;
      }
    }
    expect(fallSpeed).toBeGreaterThan(12.8);
    expect(player.position.y).toBeCloseTo(0);
  });

  it('clamps movement to the arena bounds', () => {
    const player = makePlayer({ position: vec3(19.5, 0, 0), velocity: vec3(20, 0, 0) });
    const map = makeFlatMap();
    simulatePlayer(player, makeInput({ strafe: 1, yaw: 0 }), 1 / 30, map, 1_000);
    expect(player.position.x).toBeLessThanOrEqual(19.59);
  });

  it('runs slightly faster with a knife than with a pistol or rifle', () => {
    const map = makeFlatMap();
    const knifePlayer = makePlayer({ position: vec3(0, 0, 0), activeSlot: 'knife' });
    const pistolPlayer = makePlayer({ position: vec3(0, 0, 0), activeSlot: 'secondary' });
    const riflePlayer = makePlayer({ position: vec3(0, 0, 0) });
    addWeapon(riflePlayer, 'ak47');

    for (let index = 0; index < 24; index += 1) {
      const input = makeInput({ forward: 1, seq: index + 1 });
      const now = 1_000 + index * 33;
      simulatePlayer(knifePlayer, input, 1 / 30, map, now);
      simulatePlayer(pistolPlayer, input, 1 / 30, map, now);
      simulatePlayer(riflePlayer, input, 1 / 30, map, now);
    }

    expect(Math.abs(knifePlayer.position.z)).toBeGreaterThan(Math.abs(pistolPlayer.position.z));
    expect(Math.abs(pistolPlayer.position.z)).toBeGreaterThan(Math.abs(riflePlayer.position.z));
  });

  it('allows players to walk through Dust2 doors without being teleported', async () => {
    const { DE_DUST2_MAP } = await import('../shared/map');

    // 1. Walk from CT landing towards B site through B doors:
    const bToCt = makePlayer({ position: vec3(-13.5, 1.2, -15.2) });
    for (let i = 1; i <= 30; i++) {
      simulatePlayer(
        bToCt,
        makeInput({ forward: 1, yaw: Math.PI / 2, seq: i }), // moves towards -X
        1 / 30,
        DE_DUST2_MAP,
        1_000 + i * 33,
      );
    }
    expect(bToCt.position.y).toBeCloseTo(1.2, 1);
    expect(bToCt.position.x).toBeLessThan(-17.0);

    // 2. Walk from B site back to CT landing through B doors:
    const ctToB = makePlayer({ position: vec3(-18.0, 1.2, -15.1) });
    for (let i = 1; i <= 30; i++) {
      simulatePlayer(
        ctToB,
        makeInput({ forward: 1, yaw: -Math.PI / 2, seq: i }), // moves towards +X
        1 / 30,
        DE_DUST2_MAP,
        1_000 + i * 33,
      );
    }
    expect(ctToB.position.y).toBeCloseTo(1.2, 1);
    expect(ctToB.position.x).toBeGreaterThan(-14.5);

    // 3. Walk through Mid doors:
    const midPlayer = makePlayer({ position: vec3(-1.7, 0.0, -2.5) });
    const yawMid = Math.atan2(-1.65, -1.6);
    for (let i = 1; i <= 30; i++) {
      simulatePlayer(
        midPlayer,
        makeInput({ forward: 1, yaw: yawMid, seq: i }),
        1 / 30,
        DE_DUST2_MAP,
        1_000 + i * 33,
      );
    }
    expect(midPlayer.position.y).toBeCloseTo(0.0, 1);
    expect(midPlayer.position.z).toBeGreaterThan(-1.0);

    // 4. Walk through Banka South doors:
    const bankaSouth = makePlayer({ position: vec3(17.6, 1.6, 14.0) });
    for (let i = 1; i <= 45; i++) {
      simulatePlayer(
        bankaSouth,
        makeInput({ forward: 1, yaw: 0, seq: i }),
        1 / 30,
        DE_DUST2_MAP,
        1_000 + i * 33,
      );
    }
    expect(bankaSouth.position.y).toBeCloseTo(1.6, 1);
    expect(bankaSouth.position.z).toBeLessThan(8.0);

    // 5. Walk through Banka North doors:
    const bankaNorth = makePlayer({ position: vec3(17.6, 1.6, 5.0) });
    for (let i = 1; i <= 45; i++) {
      simulatePlayer(
        bankaNorth,
        makeInput({ forward: 1, yaw: 0, seq: i }),
        1 / 30,
        DE_DUST2_MAP,
        1_000 + i * 33,
      );
    }
    expect(bankaNorth.position.y).toBeCloseTo(1.6, 1);
    expect(bankaNorth.position.z).toBeLessThan(0.0);

    // 6. Running into door and jumping should NOT teleport above the map (e.g. y >= 7) or below map (y < 0)
    const jumper = makePlayer({ position: vec3(-16.0, 1.2, -16.17) });
    for (let i = 1; i <= 30; i++) {
      simulatePlayer(
        jumper,
        makeInput({ forward: 1, jump: true, yaw: Math.PI / 2, strafe: 0.5, seq: i }),
        1 / 30,
        DE_DUST2_MAP,
        1_000 + i * 33,
      );
      expect(jumper.position.y).toBeGreaterThanOrEqual(1.15);
      expect(jumper.position.y).toBeLessThan(3.5);
    }
  });
});
