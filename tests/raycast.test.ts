import { describe, expect, it } from 'vitest';
import { Rng } from '../server/game/rng';
import {
  applySpread,
  computeSpread,
  rayAabb,
  raycastMap,
  raycastPlayers,
  raycastWorld,
} from '../server/game/raycast';
import { getWeapon } from '../shared/weapons';
import { MOVEMENT, PLAYER } from '../shared/config';
import { vec3 } from '../shared/math';
import { makeFlatMap, makePlayer } from './helpers';

const wallMap = (() => {
  const map = makeFlatMap();
  map.boxes.push({
    id: 'wall',
    min: vec3(-5, 0, 2),
    max: vec3(5, 3, 2.5),
    color: '#333333',
    kind: 'wall',
  });
  return map;
})();

describe('ray casting', () => {
  it('intersects an AABB and reports the entry point', () => {
    const hit = rayAabb(
      vec3(0, 1, 0),
      vec3(0, 0, 1),
      { min: vec3(-1, 0, 3), max: vec3(1, 2, 4) },
      10,
    );
    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(3);
    expect(hit?.point).toEqual({ x: 0, y: 1, z: 3 });
  });

  it('misses AABBs behind or parallel to the ray', () => {
    expect(
      rayAabb(vec3(0, 1, 0), vec3(0, 0, 1), { min: vec3(-1, 0, -4), max: vec3(1, 2, -3) }),
    ).toBeNull();
    expect(
      rayAabb(vec3(5, 1, 0), vec3(0, 0, 1), { min: vec3(-1, 0, 3), max: vec3(1, 2, 4) }),
    ).toBeNull();
  });

  it('finds the nearest wall in the map', () => {
    const hit = raycastMap(wallMap, vec3(0, 1, 0), vec3(0, 0, 1), 100);
    expect(hit?.boxId).toBe('wall');
    expect(hit?.distance).toBeCloseTo(2);
  });

  it('classifies head, body, and leg hits', () => {
    const shooter = makePlayer({ id: 'shooter', team: 'alpha' });
    const victim = makePlayer({
      id: 'victim',
      team: 'bravo',
      position: vec3(0, 0, 5),
      armor: 0,
    });
    const players = [shooter, victim];
    const head = raycastPlayers(players, shooter, vec3(0, 1.65, 0), vec3(0, 0, 1), 20, 1_000);
    const body = raycastPlayers(players, shooter, vec3(0, 1.0, 0), vec3(0, 0, 1), 20, 1_000);
    const legs = raycastPlayers(players, shooter, vec3(0, 0.3, 0), vec3(0, 0, 1), 20, 1_000);
    expect(head?.zone).toBe('head');
    expect(body?.zone).toBe('body');
    expect(legs?.zone).toBe('legs');
  });

  it('uses tight rounded hitboxes instead of oversized AABB corners', () => {
    const shooter = makePlayer({ id: 'shooter', team: 'alpha' });
    const victim = makePlayer({
      id: 'victim',
      team: 'bravo',
      position: vec3(0, 0, 5),
      armor: 0,
    });
    const players = [shooter, victim];

    const headEdge = raycastPlayers(
      players,
      shooter,
      vec3(0.12, 1.65, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );
    const bodyEdge = raycastPlayers(players, shooter, vec3(0.3, 1.0, 0), vec3(0, 0, 1), 20, 1_000);
    const legEdge = raycastPlayers(players, shooter, vec3(0.25, 0.3, 0), vec3(0, 0, 1), 20, 1_000);
    const neck = raycastPlayers(players, shooter, vec3(0.25, 1.55, 0), vec3(0, 0, 1), 20, 1_000);
    const headCornerMiss = raycastPlayers(
      players,
      shooter,
      vec3(0.3, 1.65, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );
    const legCornerMiss = raycastPlayers(
      players,
      shooter,
      vec3(0.3, 0.3, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );

    expect(headEdge?.zone).toBe('head');
    expect(bodyEdge?.zone).toBe('body');
    expect(legEdge?.zone).toBe('legs');
    expect(neck?.zone).toBe('body');
    expect(headCornerMiss).toBeNull();
    expect(legCornerMiss).toBeNull();
  });

  it('pins the configured head and leg hitbox boundaries', () => {
    const shooter = makePlayer({ id: 'shooter', team: 'alpha' });
    const victim = makePlayer({
      id: 'victim',
      team: 'bravo',
      position: vec3(0, 0, 5),
      armor: 0,
    });
    const players = [shooter, victim];
    const headY = MOVEMENT.standHeight - PLAYER.headRadius;
    const headSectionRadius = Math.sqrt(PLAYER.headRadius ** 2 - 0.05 ** 2);

    const headInside = raycastPlayers(
      players,
      shooter,
      vec3(headSectionRadius - 0.01, headY + 0.05, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );
    const headOutside = raycastPlayers(
      players,
      shooter,
      vec3(headSectionRadius + 0.01, headY + 0.05, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );
    const legInside = raycastPlayers(
      players,
      shooter,
      vec3(PLAYER.legRadius - 0.01, 0.3, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );
    const legOutside = raycastPlayers(
      players,
      shooter,
      vec3(PLAYER.legRadius + 0.01, 0.3, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );

    expect(headInside?.zone).toBe('head');
    expect(headOutside).toBeNull();
    expect(legInside?.zone).toBe('legs');
    expect(legOutside).toBeNull();
  });

  it('keeps hitboxes aligned with the crouched player height', () => {
    const shooter = makePlayer({ id: 'shooter', team: 'alpha' });
    const victim = makePlayer({
      id: 'victim',
      team: 'bravo',
      position: vec3(0, 0, 5),
      armor: 0,
      crouching: true,
    });
    const players = [shooter, victim];

    const head = raycastPlayers(players, shooter, vec3(0, 1.0, 0), vec3(0, 0, 1), 20, 1_000);
    const body = raycastPlayers(players, shooter, vec3(0, 0.7, 0), vec3(0, 0, 1), 20, 1_000);
    const legs = raycastPlayers(players, shooter, vec3(0, 0.3, 0), vec3(0, 0, 1), 20, 1_000);

    expect(head?.zone).toBe('head');
    expect(body?.zone).toBe('body');
    expect(legs?.zone).toBe('legs');
  });

  it('ignores teammates, dead players, and the shooter', () => {
    const shooter = makePlayer({ id: 'shooter', team: 'alpha' });
    const teammate = makePlayer({ id: 'mate', team: 'alpha', position: vec3(0, 0, 5) });
    const dead = makePlayer({ id: 'dead', team: 'bravo', position: vec3(0, 0, 5), alive: false });
    expect(
      raycastPlayers([shooter, teammate, dead], shooter, vec3(0, 1.2, 0), vec3(0, 0, 1), 20, 1_000),
    ).toBeNull();
  });

  it('prefers a player hit before an occluding wall', () => {
    const shooter = makePlayer({ id: 'shooter', team: 'alpha' });
    const victim = makePlayer({ id: 'victim', team: 'bravo', position: vec3(0, 0, 5) });
    const clear = raycastWorld(
      makeFlatMap(),
      [shooter, victim],
      shooter,
      vec3(0, 1.2, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );
    expect(clear.type).toBe('player');
    expect(clear.type === 'player' ? clear.playerHit.player.id : null).toBe('victim');

    const occluded = raycastWorld(
      wallMap,
      [shooter, victim],
      shooter,
      vec3(0, 1.2, 0),
      vec3(0, 0, 1),
      1.5,
      1_000,
    );
    expect(occluded.type).toBe('none');
  });

  it('returns a wall when no player is hit', () => {
    const shooter = makePlayer({ id: 'shooter', team: 'alpha' });
    const hit = raycastWorld(
      wallMap,
      [shooter],
      shooter,
      vec3(0, 1.2, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );
    expect(hit.type).toBe('wall');
    if (hit.type === 'wall') {
      expect(hit.wallHit.boxId).toBe('wall');
    }
  });

  it('returns a far point when nothing is hit', () => {
    const shooter = makePlayer({ id: 'shooter', team: 'alpha' });
    const hit = raycastWorld(
      makeFlatMap(),
      [shooter],
      shooter,
      vec3(0, 1.2, 0),
      vec3(0, 0, 1),
      20,
      1_000,
    );
    expect(hit.type).toBe('none');
    expect(hit.distance).toBe(20);
    expect(hit.point.z).toBeCloseTo(20);
  });

  it('applies deterministic spread and preserves normalization', () => {
    const direction = vec3(0, 0, -1);
    expect(applySpread(direction, 0, new Rng(1))).toBe(direction);
    const spread = applySpread(direction, 0.05, new Rng(1));
    expect(Math.hypot(spread.x, spread.y, spread.z)).toBeCloseTo(1);
    expect(spread).not.toEqual(direction);
  });

  it('uses a wider AWP spread when unscoped', () => {
    const awp = getWeapon('awp');
    expect(computeSpread(awp, 0, false, true, true)).toBe(0);
    expect(computeSpread(awp, 0, false, true, false)).toBeCloseTo(awp.unscopedSpread ?? awp.spread);
  });

  it('scales spread with movement, crouch, and air state', () => {
    const deagle = getWeapon('deagle');
    const still = computeSpread(deagle, 0, false, true);
    const moving = computeSpread(deagle, 6.4, false, true);
    const crouched = computeSpread(deagle, 6.4, true, true);
    const airborne = computeSpread(deagle, 6.4, false, false);
    expect(still).toBe(0);
    expect(moving).toBeGreaterThan(still);
    expect(crouched).toBeLessThan(moving);
    expect(airborne).toBeGreaterThan(moving);
  });

  it('keeps the first shots precise and opens the spray cone', () => {
    const ak = getWeapon('ak47');
    expect(computeSpread(ak, 0, false, true, false, 0)).toBe(0);
    expect(computeSpread(ak, 0, false, true, false, 1)).toBe(0);
    expect(computeSpread(ak, 0, false, true, false, 4)).toBeCloseTo(ak.spread + 0.0225);
    expect(computeSpread(ak, 0, false, true, false, 100)).toBeCloseTo(ak.spread + 0.065);
  });
});
