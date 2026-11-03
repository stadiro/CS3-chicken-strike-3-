import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../client/src/settings';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('game settings', () => {
  it('normalizes invalid values and clamps ranges', () => {
    const settings = normalizeSettings({
      sensitivity: 99,
      awpSensitivity: 0,
      fov: 500,
      masterVolume: -3,
      effectsVolume: 2,
      toggleWalk: 'yes',
      toggleScope: true,
    });
    expect(settings.sensitivity).toBe(3);
    expect(settings.awpSensitivity).toBe(0.2);
    expect(settings.fov).toBe(110);
    expect(settings.masterVolume).toBe(0);
    expect(settings.effectsVolume).toBe(1);
    expect(settings.toggleWalk).toBe(DEFAULT_SETTINGS.toggleWalk);
    expect(settings.toggleScope).toBe(true);
  });

  it('falls back to defaults for missing or corrupt storage', () => {
    const storage = memoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    storage.setItem('wow-settings-v1', '{not json');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('persists normalized settings', () => {
    const storage = memoryStorage();
    saveSettings({ ...DEFAULT_SETTINGS, fov: 100, masterVolume: 0.25 }, storage);
    const loaded = loadSettings(storage);
    expect(loaded.fov).toBe(100);
    expect(loaded.masterVolume).toBe(0.25);
    expect(loaded.toggleScope).toBe(DEFAULT_SETTINGS.toggleScope);
  });
});
