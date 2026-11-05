import { describe, expect, it } from 'vitest';
import { DE_DUST2_MAP } from '../shared/map';
import { hasLineOfSight } from '../shared/visibility';

describe('visibility', () => {
  it('sees a target in open space directly ahead', () => {
    // Looking down Long A from Pit
    const pit = { x: 28.0, y: 0.1, z: 8.0 };
    const long = { x: 28.0, y: 1.6, z: -5.0 };
    // Pit looking north (towards negative Z): yaw 0
    expect(hasLineOfSight(DE_DUST2_MAP, pit, 0, long)).toBe(true);
  });

  it('does not see a target directly behind the player', () => {
    const pit = { x: 28.0, y: 0.1, z: 8.0 };
    const long = { x: 28.0, y: 1.6, z: -5.0 };
    // Pit looking south (towards positive Z): yaw PI
    expect(hasLineOfSight(DE_DUST2_MAP, pit, Math.PI, long)).toBe(false);
  });

  it('does not see through solid walls', () => {
    // Inside B site vs outside Long A (separated by entire Dust 2 complex)
    const bSite = { x: -22.0, y: 1.2, z: -19.5 };
    const longA = { x: 28.0, y: 1.6, z: -5.0 };
    expect(hasLineOfSight(DE_DUST2_MAP, bSite, 0, longA)).toBe(false);
  });
});
