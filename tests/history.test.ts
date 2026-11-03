import { describe, expect, it } from 'vitest';
import { recordHistory, sampleHistory, trimHistory } from '../server/game/history';
import { makePlayer } from './helpers';

describe('lag compensation history', () => {
  it('records and samples the current state when empty', () => {
    const player = makePlayer({ position: { x: 2, y: 0, z: -3 } });
    const sampled = sampleHistory(player, 500);
    expect(sampled.position).toEqual(player.position);
    expect(sampled.height).toBe(1.8);
    expect(sampled.alive).toBe(true);
  });

  it('interpolates position and height between samples', () => {
    const player = makePlayer();
    player.position = { x: 0, y: 0, z: 0 };
    recordHistory(player, 1_000);
    player.position = { x: 10, y: 2, z: 20 };
    player.crouching = true;
    recordHistory(player, 1_100);

    const sampled = sampleHistory(player, 1_050);
    expect(sampled.position.x).toBeCloseTo(5);
    expect(sampled.position.y).toBeCloseTo(1);
    expect(sampled.position.z).toBeCloseTo(10);
    expect(sampled.height).toBeCloseTo(1.5);
    expect(sampled.alive).toBe(true);
  });

  it('clamps to the nearest sample outside the range', () => {
    const player = makePlayer();
    player.position = { x: 1, y: 0, z: 1 };
    recordHistory(player, 1_000);
    player.position = { x: 2, y: 0, z: 2 };
    recordHistory(player, 1_100);

    expect(sampleHistory(player, 900).position).toEqual({ x: 1, y: 0, z: 1 });
    expect(sampleHistory(player, 1_200).position).toEqual({ x: 2, y: 0, z: 2 });
  });

  it('uses an alive endpoint when interpolating across death', () => {
    const player = makePlayer();
    player.position = { x: 0, y: 0, z: 0 };
    recordHistory(player, 1_000);
    player.alive = false;
    player.position = { x: 5, y: 0, z: 0 };
    recordHistory(player, 1_100);

    const sampled = sampleHistory(player, 1_050);
    expect(sampled.alive).toBe(true);
    expect(sampled.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('trims samples older than retention', () => {
    const player = makePlayer();
    for (const time of [1_000, 1_100, 1_200, 1_300]) {
      player.position = { x: time, y: 0, z: 0 };
      recordHistory(player, time);
    }
    trimHistory(player, 1_250, 100);
    expect(player.history.map((sample) => sample.time)).toEqual([1_200, 1_300]);
  });

  it('does not mutate stored positions', () => {
    const player = makePlayer();
    player.position = { x: 1, y: 2, z: 3 };
    recordHistory(player, 1_000);
    player.position.x = 99;
    expect(player.history[0]?.position.x).toBe(1);
  });
});
