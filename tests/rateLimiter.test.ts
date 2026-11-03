import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../server/net/rateLimiter';

describe('sliding-window rate limiter', () => {
  it('allows events up to the limit', () => {
    const limiter = new RateLimiter(3, 1_000);
    expect(limiter.allow(0)).toBe(true);
    expect(limiter.allow(100)).toBe(true);
    expect(limiter.allow(200)).toBe(true);
    expect(limiter.allow(300)).toBe(false);
  });

  it('frees capacity as the window slides', () => {
    const limiter = new RateLimiter(2, 1_000);
    expect(limiter.allow(0)).toBe(true);
    expect(limiter.allow(500)).toBe(true);
    expect(limiter.allow(900)).toBe(false);
    expect(limiter.allow(1_000)).toBe(true);
    expect(limiter.allow(1_500)).toBe(true);
    expect(limiter.allow(1_501)).toBe(false);
  });

  it('does not allow an unlimited burst over long time', () => {
    const limiter = new RateLimiter(5, 100);
    for (let index = 0; index < 5; index += 1) {
      expect(limiter.allow(index * 10)).toBe(true);
    }
    expect(limiter.allow(60)).toBe(false);
    expect(limiter.allow(100)).toBe(true);
  });
});
