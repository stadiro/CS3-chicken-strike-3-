import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CROSSHAIR,
  MAX_CROSSHAIRS,
  sanitizeCrosshairAuthor,
  sanitizeCrosshairDraft,
  sanitizeStoredCrosshair,
  type CrosshairPreset,
} from '../shared/crosshair';
import { logger } from './logger';

export interface CrosshairStore {
  list(): Promise<CrosshairPreset[]>;
  save(author: unknown, raw: unknown): Promise<CrosshairPreset>;
  remove(id: string): Promise<boolean>;
}

export class CrosshairValidationError extends Error {}

export function createCrosshairStore(
  filePath = path.join(process.cwd(), 'data', 'crosshairs.json'),
): CrosshairStore {
  let cache: CrosshairPreset[] | null = null;
  let queue: Promise<void> = Promise.resolve();

  const load = async (): Promise<CrosshairPreset[]> => {
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((entry) => sanitizeStoredCrosshair(entry))
        .filter(
          (entry): entry is CrosshairPreset => entry !== null && entry.id !== DEFAULT_CROSSHAIR.id,
        );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.warn('Could not read crosshair store', { error });
      }
      return [];
    }
  };

  const persist = async (crosshairs: CrosshairPreset[]): Promise<void> => {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(crosshairs, null, 2)}\n`, 'utf8');
    await rename(temporary, filePath);
  };

  const list = async (): Promise<CrosshairPreset[]> => {
    await queue;
    if (cache === null) {
      cache = await load();
    }
    return [DEFAULT_CROSSHAIR, ...cache];
  };

  const save = async (author: unknown, raw: unknown): Promise<CrosshairPreset> => {
    const draft = sanitizeCrosshairDraft(raw);
    if (draft === null) {
      throw new CrosshairValidationError('Некорректные параметры прицела');
    }

    const task = queue.then(async (): Promise<CrosshairPreset> => {
      if (cache === null) {
        cache = await load();
      }
      if (cache.length >= MAX_CROSSHAIRS) {
        throw new CrosshairValidationError('Каталог прицелов заполнен');
      }
      const preset: CrosshairPreset = {
        ...draft,
        id: randomUUID(),
        author: sanitizeCrosshairAuthor(author),
      };
      const next = [...cache, preset];
      await persist(next);
      cache = next;
      return preset;
    });
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  const remove = async (id: string): Promise<boolean> => {
    const task = queue.then(async (): Promise<boolean> => {
      if (id === DEFAULT_CROSSHAIR.id || id.length === 0) {
        return false;
      }
      if (cache === null) {
        cache = await load();
      }
      const index = cache.findIndex((preset) => preset.id === id);
      if (index === -1) {
        return false;
      }
      const next = cache.filter((preset) => preset.id !== id);
      await persist(next);
      cache = next;
      return true;
    });
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  return { list, save, remove };
}
