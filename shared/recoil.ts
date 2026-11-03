import type { WeaponDefinition } from './weapons';

export interface RecoilKick {
  /** Horizontal aim kick in radians. */
  yaw: number;
  /** Vertical aim kick in radians. */
  pitch: number;
}

/**
 * CS2-style spray: the first shots mostly climb, then the pattern drifts
 * left/right while a random jitter keeps every spray slightly different.
 * Knives and weapons without recoil never move the aim.
 */
const HORIZONTAL_PATTERN = [
  0.16, -0.2, 0.27, -0.36, 0.48, -0.58, 0.62, -0.5, 0.34, -0.2, 0.12, -0.08,
] as const;

export function computeRecoilKick(
  weapon: WeaponDefinition,
  shotIndex: number,
  random: () => number = Math.random,
): RecoilKick {
  if (weapon.slot === 'knife' || weapon.recoil <= 0) {
    return { yaw: 0, pitch: 0 };
  }

  const index = Math.max(0, Math.floor(shotIndex));
  const progress = Math.min(1, index / 12);
  const pattern = HORIZONTAL_PATTERN[index % HORIZONTAL_PATTERN.length] ?? 0;
  const horizontalJitter = (random() - 0.5) * 0.5;
  const pitchJitter = (random() - 0.5) * 0.16;
  const horizontalScale = 0.55 + progress * 0.55;
  const verticalScale = 0.72 + progress * 0.5;

  return {
    yaw: weapon.recoil * (pattern + horizontalJitter) * horizontalScale,
    pitch: weapon.recoil * (verticalScale + pitchJitter),
  };
}
