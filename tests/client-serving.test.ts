import { afterEach, describe, expect, it } from 'vitest';
import { createGameServer, type GameServer } from '../server/server';

const servers: GameServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

describe('client serving', () => {
  it('serves the Vite-powered client from the game server port', async () => {
    const server = await createGameServer({ serveClient: true, production: false });
    servers.push(server);
    const port = await server.listen(0, '127.0.0.1');

    const response = await fetch(`http://127.0.0.1:${port}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('WOW Arena');
    expect(html).toContain('/src/main.ts');
  }, 30_000);
});
