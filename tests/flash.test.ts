import { describe, expect, it } from 'vitest';
import { flashBlindDurationMs, MAX_FLASH_DISTANCE } from '../server/game/flash';

describe('flash exposure', () => {
  it('gives a full-duration blind at close/medium range in the centre of view', () => {
    expect(flashBlindDurationMs({ distance: 2, angle: 0, blocked: false })).toBe(4_870);
    expect(flashBlindDurationMs({ distance: 8, angle: 0, blocked: false })).toBe(4_870);
  });

  it('still blinds strongly when looking directly at a distant flash (CS2 behaviour)', () => {
    const near = flashBlindDurationMs({ distance: 10, angle: 0, blocked: false });
    const mid = flashBlindDurationMs({ distance: 30, angle: 0, blocked: false });
    const far = flashBlindDurationMs({ distance: 55, angle: 0, blocked: false });
    expect(mid).toBeLessThan(near);
    expect(far).toBeLessThan(mid);
    expect(mid).toBeGreaterThan(3_000);
    expect(far).toBeGreaterThan(2_500);
    expect(flashBlindDurationMs({ distance: MAX_FLASH_DISTANCE, angle: 0, blocked: false })).toBe(
      0,
    );
  });

  it('weakens the blind when the flash is outside the centre of view and ignores distant back-turned flashes', () => {
    const direct = flashBlindDurationMs({ distance: 5, angle: 0, blocked: false });
    const side = flashBlindDurationMs({ distance: 5, angle: Math.PI / 2, blocked: false });
    const behindClose = flashBlindDurationMs({ distance: 5, angle: Math.PI, blocked: false });
    const behindFar = flashBlindDurationMs({ distance: 20, angle: Math.PI, blocked: false });
    expect(side).toBeLessThan(direct);
    expect(behindClose).toBeLessThan(side);
    expect(behindClose).toBeGreaterThan(0);
    expect(behindFar).toBe(0);
  });

  it('does not blind through a wall', () => {
    expect(flashBlindDurationMs({ distance: 1, angle: 0, blocked: true })).toBe(0);
  });
});
