import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminCommandResult, AdminStateView } from '../server/admin';
import { createAdminServer, type AdminServer } from '../server/adminServer';
import { createGameServer, type GameServer } from '../server/server';

const games: GameServer[] = [];
const admins: AdminServer[] = [];

afterEach(async () => {
  for (const admin of admins.splice(0)) {
    await admin.close();
  }
  for (const game of games.splice(0)) {
    await game.close();
  }
});

async function startTestServers(options: { token?: string; onQuit?: () => void } = {}): Promise<{
  game: GameServer;
  adminUrl: string;
}> {
  const game = await createGameServer({ serveClient: false, production: true });
  games.push(game);
  await game.listen(0, '127.0.0.1');

  const admin = createAdminServer(game, options);
  admins.push(admin);
  const adminPort = await admin.listen(0, '127.0.0.1');

  return { game, adminUrl: `http://127.0.0.1:${adminPort}` };
}

async function getState(adminUrl: string): Promise<AdminStateView> {
  const response = await fetch(`${adminUrl}/api/state`);
  expect(response.status).toBe(200);
  return (await response.json()) as AdminStateView;
}

async function postCommand(
  adminUrl: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<AdminCommandResult> {
  const response = await fetch(`${adminUrl}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as AdminCommandResult;
}

function rawGet(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(url), { headers }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
}

describe('web admin panel', () => {
  it('serves the panel and exposes the current state', async () => {
    const { adminUrl } = await startTestServers();

    const page = await fetch(adminUrl);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('Панель управления');
    expect(html).toContain('/api/state');

    const state = await getState(adminUrl);
    expect(state.mapId).toBe('fy_sand');
    expect(state.phase).toBe('lobby');
    expect(state.players).toHaveLength(0);
    expect(state.maps.map((map) => map.id)).toEqual(['fy_sand', 'fy_wow', 'de_dust2']);
  });

  it('rejects forged Host and cross-origin requests without a token', async () => {
    const { adminUrl } = await startTestServers();

    expect(await rawGet(`${adminUrl}/api/state`, { Host: 'evil.test' })).toBe(403);
    expect(await rawGet(`${adminUrl}/api/state`, { Origin: 'http://evil.test' })).toBe(403);
  });

  it('executes say and map commands through the HTTP API', async () => {
    const { adminUrl } = await startTestServers();

    const say = await postCommand(adminUrl, { command: 'SAY', args: ['hello'] });
    expect(say.ok).toBe(true);
    expect(say.lines).toContain('Объявление: hello');

    const switched = await postCommand(adminUrl, { command: 'map', args: ['fy_wow'] });
    expect(switched.ok).toBe(true);
    expect((await getState(adminUrl)).mapId).toBe('fy_wow');
  });

  it('kicks players through the HTTP API', async () => {
    const { game, adminUrl } = await startTestServers();
    const join = game.match.join('socket-http', { name: 'HTTP Player' }, Date.now());
    const playerId = join.result.playerId;
    expect(playerId).toBeDefined();

    const result = await postCommand(adminUrl, {
      command: 'kick',
      args: [playerId ?? ''],
    });

    expect(result.ok).toBe(true);
    expect(game.match.getPlayers()).toHaveLength(0);
  });

  it('rejects malformed command bodies', async () => {
    const { adminUrl } = await startTestServers();

    const response = await fetch(`${adminUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '' }),
    });

    expect(response.status).toBe(400);
  });

  it('requires the configured token for API requests', async () => {
    const { adminUrl } = await startTestServers({ token: 'secret-token' });

    const unauthorized = await fetch(`${adminUrl}/api/state`);
    expect(unauthorized.status).toBe(401);
    expect((await unauthorized.json()) as { authRequired?: boolean }).toMatchObject({
      authRequired: true,
    });

    const authorized = await fetch(`${adminUrl}/api/state`, {
      headers: { 'X-Admin-Token': 'secret-token' },
    });
    expect(authorized.status).toBe(200);

    const bearer = await fetch(`${adminUrl}/api/state`, {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(bearer.status).toBe(200);

    const lowercaseBearer = await fetch(`${adminUrl}/api/state`, {
      headers: { Authorization: 'bearer secret-token' },
    });
    expect(lowercaseBearer.status).toBe(200);

    const wrongToken = await fetch(`${adminUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'wrong-token' },
      body: JSON.stringify({ command: 'status' }),
    });
    expect(wrongToken.status).toBe(401);
  });

  it('enforces token policy at the admin server boundary', async () => {
    const game = await createGameServer({ serveClient: false, production: true });
    games.push(game);
    await game.listen(0, '127.0.0.1');

    expect(() => createAdminServer(game, { token: 'short' })).toThrow(/at least 8/);

    const admin = createAdminServer(game);
    await expect(admin.listen(0, '0.0.0.0')).rejects.toThrow(/ADMIN_TOKEN/);
  });

  it('rate limits repeated failed tokens', async () => {
    const { adminUrl } = await startTestServers({ token: 'secret-token' });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`${adminUrl}/api/state`, {
        headers: { 'X-Admin-Token': 'wrong-token' },
      });
      expect(response.status).toBe(401);
    }

    const limited = await fetch(`${adminUrl}/api/state`, {
      headers: { 'X-Admin-Token': 'wrong-token' },
    });
    expect(limited.status).toBe(429);
  });

  it('rejects unauthenticated malformed bodies before parsing JSON', async () => {
    const { adminUrl } = await startTestServers({ token: 'secret-token' });

    const response = await fetch(`${adminUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"command":',
    });

    expect(response.status).toBe(401);
  });

  it('requires a matching Origin when a token is configured', async () => {
    const { adminUrl } = await startTestServers({ token: 'secret-token' });

    expect(
      await rawGet(`${adminUrl}/api/state`, {
        Host: 'panel.test',
        Origin: 'http://panel.test',
        'X-Admin-Token': 'secret-token',
      }),
    ).toBe(200);

    expect(
      await rawGet(`${adminUrl}/api/state`, {
        Host: 'panel.test',
        Origin: 'http://evil.test',
        'X-Admin-Token': 'secret-token',
      }),
    ).toBe(403);
  });

  it('invokes onQuit after replying to a quit command', async () => {
    let quitCalls = 0;
    const { adminUrl } = await startTestServers({
      onQuit: () => {
        quitCalls += 1;
      },
    });

    const result = await postCommand(adminUrl, { command: 'quit', args: [] });
    expect(result.shutdown).toBe(true);

    await vi.waitFor(() => {
      expect(quitCalls).toBe(1);
    });
  });
});
