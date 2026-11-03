import {
  DEFAULT_CROSSHAIR,
  sanitizeStoredCrosshair,
  type CrosshairPreset,
} from '../../../shared/crosshair';

export interface StoredSession {
  playerId: string;
  sessionToken: string;
  name: string;
}

const SESSION_KEY = 'wow-arena.session.v1';
const NAME_KEY = 'wow-arena.name.v1';
const CROSSHAIR_KEY = 'wow-arena.crosshair.v1';

function getStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadSession(): StoredSession | null {
  const storage = getStorage();
  if (storage === null) {
    return null;
  }

  const raw = storage.getItem(SESSION_KEY);
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.playerId !== 'string' ||
      typeof record.sessionToken !== 'string' ||
      typeof record.name !== 'string'
    ) {
      return null;
    }
    return {
      playerId: record.playerId,
      sessionToken: record.sessionToken,
      name: record.name,
    };
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  const storage = getStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage can be disabled; the game still works without reconnect support.
  }
}

export function clearSession(): void {
  const storage = getStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function loadPlayerName(): string {
  const storage = getStorage();
  if (storage === null) {
    return '';
  }
  try {
    return storage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePlayerName(name: string): void {
  const storage = getStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(NAME_KEY, name);
  } catch {
    // Ignore storage failures.
  }
}

export function loadCrosshairPreset(): CrosshairPreset {
  const storage = getStorage();
  if (storage === null) {
    return DEFAULT_CROSSHAIR;
  }
  try {
    const raw = storage.getItem(CROSSHAIR_KEY);
    if (raw === null) {
      return DEFAULT_CROSSHAIR;
    }
    const preset = sanitizeStoredCrosshair(JSON.parse(raw) as unknown);
    return preset ?? DEFAULT_CROSSHAIR;
  } catch {
    return DEFAULT_CROSSHAIR;
  }
}

export function saveCrosshairPreset(preset: CrosshairPreset): void {
  const storage = getStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(CROSSHAIR_KEY, JSON.stringify(preset));
  } catch {
    // The default crosshair remains usable when storage is unavailable.
  }
}
