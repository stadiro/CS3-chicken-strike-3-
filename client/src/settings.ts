export interface GameSettings {
  sensitivity: number;
  awpSensitivity: number;
  fov: number;
  masterVolume: number;
  effectsVolume: number;
  toggleWalk: boolean;
  toggleScope: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 1,
  awpSensitivity: 0.7,
  fov: 78,
  masterVolume: 0.7,
  effectsVolume: 0.8,
  toggleWalk: false,
  toggleScope: true,
};

const STORAGE_KEY = 'wow-settings-v1';

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeSettings(value: unknown): GameSettings {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    sensitivity: clampNumber(raw.sensitivity, DEFAULT_SETTINGS.sensitivity, 0.2, 3),
    awpSensitivity: clampNumber(raw.awpSensitivity, DEFAULT_SETTINGS.awpSensitivity, 0.2, 2),
    fov: Math.round(clampNumber(raw.fov, DEFAULT_SETTINGS.fov, 60, 110)),
    masterVolume: clampNumber(raw.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 1),
    effectsVolume: clampNumber(raw.effectsVolume, DEFAULT_SETTINGS.effectsVolume, 0, 1),
    toggleWalk: clampBoolean(raw.toggleWalk, DEFAULT_SETTINGS.toggleWalk),
    toggleScope: clampBoolean(raw.toggleScope, DEFAULT_SETTINGS.toggleScope),
  };
}

function storage(): SettingsStorage | null {
  try {
    return (globalThis as { localStorage?: SettingsStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(target: SettingsStorage | null = storage()): GameSettings {
  if (target === null) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = target.getItem(STORAGE_KEY);
    return raw === null ? { ...DEFAULT_SETTINGS } : normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: GameSettings,
  target: SettingsStorage | null = storage(),
): void {
  if (target === null) {
    return;
  }
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    // Private browsing or a full storage quota must not break the game.
  }
}
