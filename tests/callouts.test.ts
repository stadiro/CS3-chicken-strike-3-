import { describe, expect, it } from 'vitest';
import { getCalloutName } from '../shared/callouts';

describe('callouts', () => {
  it('identifies key landmarks on de_dust2', () => {
    expect(getCalloutName('de_dust2', { x: 19.6, y: 2.4, z: -25.6 })).toContain('A PLANT');
    expect(getCalloutName('de_dust2', { x: -22.8, y: 1.2, z: -19.5 })).toContain('B PLANT');
    expect(getCalloutName('de_dust2', { x: 26.5, y: 2.4, z: -29.0 })).toContain('GOOSE');
    expect(getCalloutName('de_dust2', { x: 28.0, y: 0.1, z: 8.0 })).toContain('PIT');
    expect(getCalloutName('de_dust2', { x: 0.0, y: 2.4, z: 30.0 })).toContain('T SPAWN');
    expect(getCalloutName('de_dust2', { x: 9.6, y: 0.1, z: -19.2 })).toContain('CT SPAWN');
    expect(getCalloutName('de_dust2', { x: -1.0, y: 0.1, z: -1.7 })).toContain('MID DOORS');
    expect(getCalloutName('de_dust2', { x: -26.0, y: 1.6, z: -28.0 })).toContain('DALNIY');
  });

  it('identifies areas on fy_sand and fy_wow', () => {
    expect(getCalloutName('fy_sand', { x: -18, y: 0, z: 0 })).toContain('ALPHA BASE');
    expect(getCalloutName('fy_sand', { x: 18, y: 0, z: 0 })).toContain('BRAVO BASE');
    expect(getCalloutName('fy_wow', { x: 0, y: 0, z: 0 })).toContain('CENTER ARENA');
  });

  it('returns default map name for out-of-bounds positions', () => {
    expect(getCalloutName('de_dust2', { x: 999, y: 0, z: 999 })).toBe('DUST II');
    expect(getCalloutName('fy_sand', { x: 999, y: 0, z: 999 })).toBe('FY SAND');
  });
});
