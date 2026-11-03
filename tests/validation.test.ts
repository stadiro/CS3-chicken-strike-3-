import { describe, expect, it } from 'vitest';
import { inputSchema, joinSchema, pingSchema } from '../server/net/validation';
import { makeInput } from './helpers';

describe('wire validation', () => {
  it('accepts a valid ping and rejects negative or non-finite time', () => {
    expect(pingSchema.safeParse({ clientTime: 0 }).success).toBe(true);
    expect(pingSchema.safeParse({ clientTime: 123.5 }).success).toBe(true);
    expect(pingSchema.safeParse({ clientTime: -1 }).success).toBe(false);
    expect(pingSchema.safeParse({ clientTime: Number.NaN }).success).toBe(false);
    expect(pingSchema.safeParse({ clientTime: '42' }).success).toBe(false);
  });

  it('accepts names and optional session credentials', () => {
    expect(joinSchema.safeParse({ name: 'Player' }).success).toBe(true);
    expect(
      joinSchema.safeParse({
        name: 'Player',
        playerId: '123e4567-e89b-12d3-a456-426614174000',
        sessionToken: 'a'.repeat(48),
      }).success,
    ).toBe(true);
    expect(joinSchema.safeParse({ name: '' }).success).toBe(false);
    expect(joinSchema.safeParse({ name: 'x'.repeat(65) }).success).toBe(false);
    expect(joinSchema.safeParse({ name: 'Player', sessionToken: 'short' }).success).toBe(false);
  });

  it('accepts a full input frame', () => {
    expect(inputSchema.safeParse(makeInput()).success).toBe(true);
    expect(
      inputSchema.safeParse(makeInput({ forward: 1, strafe: -1, switchTo: 'primary' })).success,
    ).toBe(true);
    expect(inputSchema.safeParse(makeInput({ walk: true })).success).toBe(true);
  });

  it('requires a finite aim timestamp', () => {
    const withoutAimTime: Record<string, unknown> = { ...makeInput() };
    delete withoutAimTime.aimTime;
    expect(inputSchema.safeParse(withoutAimTime).success).toBe(false);
    expect(inputSchema.safeParse(makeInput({ aimTime: Number.NaN })).success).toBe(false);
    expect(inputSchema.safeParse(makeInput({ aimTime: Number.POSITIVE_INFINITY })).success).toBe(
      false,
    );
  });

  it('rejects out-of-range input values', () => {
    expect(inputSchema.safeParse(makeInput({ forward: 2 })).success).toBe(false);
    expect(inputSchema.safeParse(makeInput({ strafe: -2 })).success).toBe(false);
    expect(inputSchema.safeParse(makeInput({ yaw: Math.PI * 9 })).success).toBe(false);
    expect(inputSchema.safeParse(makeInput({ pitch: Math.PI })).success).toBe(false);
    expect(inputSchema.safeParse(makeInput({ seq: -1 })).success).toBe(false);
    expect(inputSchema.safeParse(makeInput({ seq: 1.5 })).success).toBe(false);
  });

  it('rejects malformed booleans and slots', () => {
    expect(inputSchema.safeParse({ ...makeInput(), fire: 1 }).success).toBe(false);
    expect(inputSchema.safeParse({ ...makeInput(), walk: 1 }).success).toBe(false);
    expect(inputSchema.safeParse(makeInput({ switchTo: 'awp' as never })).success).toBe(false);
  });
});
