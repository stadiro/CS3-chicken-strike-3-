import { clamp } from './math';

export const CROSSHAIR_STYLES = ['dot', 'cross', 'cross-dot', 'none'] as const;
export type CrosshairStyle = (typeof CROSSHAIR_STYLES)[number];

export interface CrosshairDraft {
  name: string;
  style: CrosshairStyle;
  color: string;
  length: number;
  thickness: number;
  gap: number;
  dotSize: number;
  opacity: number;
}

export interface CrosshairPreset extends CrosshairDraft {
  id: string;
  author: string;
}

export const DEFAULT_CROSSHAIR: CrosshairPreset = {
  id: 'default',
  name: 'Классическая точка',
  author: 'WOW Arena',
  style: 'dot',
  color: '#5eead4',
  length: 8,
  thickness: 2,
  gap: 4,
  dotSize: 3,
  opacity: 1,
};

export const MAX_CROSSHAIR_NAME = 24;
export const MAX_CROSSHAIR_AUTHOR = 16;
export const MAX_CROSSHAIRS = 100;

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clamp(finiteNumber(value, fallback), min, max));
}

function text(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const cleaned = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, maxLength).join('') || fallback;
}

export function sanitizeCrosshairAuthor(value: unknown): string {
  return text(value, MAX_CROSSHAIR_AUTHOR, 'Аноним');
}

export function sanitizeCrosshairDraft(raw: unknown): CrosshairDraft | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const style = record.style;
  if (!CROSSHAIR_STYLES.includes(style as CrosshairStyle)) {
    return null;
  }
  const color = typeof record.color === 'string' ? record.color.trim().toLowerCase() : '';
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    return null;
  }

  return {
    name: text(record.name, MAX_CROSSHAIR_NAME, 'Мой прицел'),
    style: style as CrosshairStyle,
    color,
    length: integer(record.length, 2, 20, DEFAULT_CROSSHAIR.length),
    thickness: integer(record.thickness, 1, 6, DEFAULT_CROSSHAIR.thickness),
    gap: integer(record.gap, 0, 14, DEFAULT_CROSSHAIR.gap),
    dotSize: integer(record.dotSize, 1, 8, DEFAULT_CROSSHAIR.dotSize),
    opacity: clamp(finiteNumber(record.opacity, DEFAULT_CROSSHAIR.opacity), 0.2, 1),
  };
}

export function sanitizeStoredCrosshair(raw: unknown): CrosshairPreset | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return null;
  }
  const draft = sanitizeCrosshairDraft(record);
  if (draft === null) {
    return null;
  }
  return {
    ...draft,
    id: record.id,
    author: sanitizeCrosshairAuthor(record.author),
  };
}
