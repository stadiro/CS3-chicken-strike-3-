/**
 * CS2-style flash exposure model.
 *
 * A flash blinds players with line of sight up to long range (covering full
 * map sightlines such as A Long and Mid on de_dust2). When looking toward the
 * detonation (<= 72 degrees), even distant flashes apply a strong blind, while
 * turning away (> 101 degrees) avoids distant flashes and only briefly
 * half-blinds at close range.
 */
export interface FlashExposure {
  /** Distance from the victim's eye to the detonation, in metres. */
  distance: number;
  /** Angle between the victim's aim and the detonation, in radians. */
  angle: number;
  /** True when a wall blocks the view from the victim's eye to the flash. */
  blocked: boolean;
}

export const MAX_FLASH_DISTANCE = 75;
const FULL_EFFECT_DISTANCE = 8;

const ANGLE_BANDS: ReadonlyArray<{
  maxAngleDegrees: number;
  totalDurationMs: number;
  maxDistance: number;
  minDistanceFactor: number;
}> = [
  {
    maxAngleDegrees: 53,
    totalDurationMs: 4_870,
    maxDistance: MAX_FLASH_DISTANCE,
    minDistanceFactor: 0.52,
  },
  { maxAngleDegrees: 72, totalDurationMs: 3_400, maxDistance: 65, minDistanceFactor: 0.38 },
  { maxAngleDegrees: 101, totalDurationMs: 1_950, maxDistance: 40, minDistanceFactor: 0 },
  { maxAngleDegrees: 180, totalDurationMs: 950, maxDistance: 14, minDistanceFactor: 0 },
];

export function flashBlindDurationMs(exposure: FlashExposure): number {
  if (exposure.blocked || exposure.distance >= MAX_FLASH_DISTANCE) {
    return 0;
  }
  const degrees = (Math.abs(exposure.angle) * 180) / Math.PI;
  const band = ANGLE_BANDS.find((candidate) => degrees <= candidate.maxAngleDegrees);
  if (band === undefined || exposure.distance >= band.maxDistance) {
    return 0;
  }
  if (exposure.distance <= FULL_EFFECT_DISTANCE) {
    return band.totalDurationMs;
  }
  const span = Math.max(1, band.maxDistance - FULL_EFFECT_DISTANCE);
  const progress = Math.min(1, Math.max(0, (exposure.distance - FULL_EFFECT_DISTANCE) / span));
  const distanceFactor = 1 - progress * (1 - band.minDistanceFactor);
  return Math.round(band.totalDurationMs * distanceFactor);
}
