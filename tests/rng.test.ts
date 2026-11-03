import { describe, expect, it } from 'vitest';
import { randomSeed, Rng } from '../server/game/rng';

describe('seeded RNG', () => {
  it('reproduces the same sequence for the same seed', () => {
    const first = new Rng(123456);
    const second = new Rng(123456);
    const a = Array.from({ length: 8 }, () => first.next());
    const b = Array.from({ length: 8 }, () => second.next());
    expect(a).toEqual(b);
    expect(a.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 4 }, () => new Rng(1).next());
    const b = Array.from({ length: 4 }, () => new Rng(2).next());
    expect(a).not.toEqual(b);
  });

  it('keeps range and int within bounds', () => {
    const rng = new Rng(7);
    for (let index = 0; index < 200; index += 1) {
      const value = rng.range(-3, 5);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(5);
      const integer = rng.int(0, 4);
      expect(Number.isInteger(integer)).toBe(true);
      expect(integer).toBeGreaterThanOrEqual(0);
      expect(integer).toBeLessThan(4);
    }
  });

  it('picks from arrays and handles empty input', () => {
    const rng = new Rng(99);
    expect(rng.pick([])).toBeNull();
    const values = ['a', 'b', 'c'];
    for (let index = 0; index < 20; index += 1) {
      expect(values).toContain(rng.pick(values));
    }
  });

  it('creates a usable random seed', () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(0xffff_ffff);
  });
});
