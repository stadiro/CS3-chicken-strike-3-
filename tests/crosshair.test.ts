import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CROSSHAIR,
  MAX_CROSSHAIR_NAME,
  sanitizeCrosshairAuthor,
  sanitizeCrosshairDraft,
  sanitizeStoredCrosshair,
} from '../shared/crosshair';
import { createCrosshairStore, CrosshairValidationError } from '../server/crosshairs';
import { createGameServer, type GameServer } from '../server/server';

const temporaryDirectories: string[] = [];
const servers: GameServer[] = [];

async function makeStorePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'wow-crosshair-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'crosshairs.json');
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('crosshair validation', () => {
  it('sanitizes a draft, clamps ranges, and normalizes the colour', () => {
    const draft = sanitizeCrosshairDraft({
      name: '  Мой\u0000   прицел  ',
      style: 'cross',
      color: '#FF00AA',
      length: 999,
      thickness: 0,
      gap: -4,
      dotSize: 42,
      opacity: 4,
    });

    expect(draft).toEqual({
      name: 'Мой прицел',
      style: 'cross',
      color: '#ff00aa',
      length: 20,
      thickness: 1,
      gap: 0,
      dotSize: 8,
      opacity: 1,
    });
    expect(
      sanitizeCrosshairDraft({ ...DEFAULT_CROSSHAIR, name: 'x'.repeat(50) })?.name,
    ).toHaveLength(MAX_CROSSHAIR_NAME);
  });

  it('rejects unknown styles and malformed colours', () => {
    expect(sanitizeCrosshairDraft({ ...DEFAULT_CROSSHAIR, style: 'triangle' })).toBeNull();
    expect(sanitizeCrosshairDraft({ ...DEFAULT_CROSSHAIR, color: 'red' })).toBeNull();
    expect(sanitizeCrosshairDraft(null)).toBeNull();
  });

  it('truncates names and falls back to anonymous authors', () => {
    expect(sanitizeCrosshairAuthor('   ')).toBe('Аноним');
    expect(sanitizeCrosshairAuthor('abcdefghijklmnopqrstuvwxyz')).toHaveLength(16);
    expect(sanitizeStoredCrosshair({ ...DEFAULT_CROSSHAIR, id: 'custom' })?.id).toBe('custom');
    expect(sanitizeStoredCrosshair({ ...DEFAULT_CROSSHAIR, id: '' })).toBeNull();
  });
});

describe('crosshair store', () => {
  it('starts with the default preset and persists new presets', async () => {
    const filePath = await makeStorePath();
    const store = createCrosshairStore(filePath);
    expect(await store.list()).toEqual([DEFAULT_CROSSHAIR]);

    const saved = await store.save('  Player\u0000 ', {
      ...DEFAULT_CROSSHAIR,
      name: 'Крестик',
      style: 'cross-dot',
      color: '#ff0000',
    });
    expect(saved.author).toBe('Player');
    expect(saved.id).not.toBe(DEFAULT_CROSSHAIR.id);

    const reloaded = createCrosshairStore(filePath);
    const presets = await reloaded.list();
    expect(presets).toHaveLength(2);
    expect(presets[1]?.name).toBe('Крестик');
    expect(presets[1]?.color).toBe('#ff0000');

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown[];
    expect(raw).toHaveLength(1);
  });

  it('removes saved presets but keeps the default preset', async () => {
    const filePath = await makeStorePath();
    const store = createCrosshairStore(filePath);
    const saved = await store.save('Player', { ...DEFAULT_CROSSHAIR, name: 'Удаляемый' });

    expect(await store.remove(DEFAULT_CROSSHAIR.id)).toBe(false);
    expect(await store.remove(saved.id)).toBe(true);
    expect(await store.list()).toEqual([DEFAULT_CROSSHAIR]);
    expect(await store.remove(saved.id)).toBe(false);
  });

  it('rejects invalid payloads without touching the file', async () => {
    const filePath = await makeStorePath();
    const store = createCrosshairStore(filePath);
    await expect(store.save('Player', { style: 'nope' })).rejects.toBeInstanceOf(
      CrosshairValidationError,
    );
    expect(await store.list()).toEqual([DEFAULT_CROSSHAIR]);
  });

  it('serves and accepts presets over the HTTP API', async () => {
    const filePath = await makeStorePath();
    const server = await createGameServer({
      serveClient: false,
      production: true,
      crosshairStore: createCrosshairStore(filePath),
    });
    servers.push(server);
    const port = await server.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${port}`;

    const initial = await fetch(`${base}/api/crosshairs`);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual([DEFAULT_CROSSHAIR]);

    const saved = await fetch(`${base}/api/crosshairs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DEFAULT_CROSSHAIR, name: 'API cross', author: 'Tester' }),
    });
    expect(saved.status).toBe(201);
    const savedBody = (await saved.json()) as { id: string; name: string; author: string };
    expect(savedBody.name).toBe('API cross');
    expect(savedBody.author).toBe('Tester');

    const after = await fetch(`${base}/api/crosshairs`);
    expect(await after.json()).toHaveLength(2);

    const removed = await fetch(`${base}/api/crosshairs/${savedBody.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
    const afterDelete = await fetch(`${base}/api/crosshairs`);
    expect(await afterDelete.json()).toEqual([DEFAULT_CROSSHAIR]);

    const missing = await fetch(`${base}/api/crosshairs/${savedBody.id}`, { method: 'DELETE' });
    expect(missing.status).toBe(404);
    const defaultDelete = await fetch(`${base}/api/crosshairs/${DEFAULT_CROSSHAIR.id}`, {
      method: 'DELETE',
    });
    expect(defaultDelete.status).toBe(404);
  });

  it('ignores corrupt stored entries', async () => {
    const filePath = await makeStorePath();
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify([{ id: 'broken' }, { ...DEFAULT_CROSSHAIR, id: 'ok' }]),
    );

    const store = createCrosshairStore(filePath);
    const presets = await store.list();
    expect(presets.map((preset) => preset.id)).toEqual([DEFAULT_CROSSHAIR.id, 'ok']);
  });
});
