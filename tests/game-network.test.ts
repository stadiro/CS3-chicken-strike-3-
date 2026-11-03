import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createGameServer, type GameServer } from '../server/server';
import { addWeapon } from '../server/game/inventory';
import { recordHistory } from '../server/game/history';
import { vec3 } from '../shared/math';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type JoinRequest,
  type JoinResult,
  type KillEvent,
  type RoundEndEvent,
  type ServerToClientEvents,
  type Snapshot,
} from '../shared/protocol';
import { makeFlatMap } from './helpers';

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

const servers: GameServer[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.disconnect();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

async function startServer(): Promise<{ server: GameServer; url: string }> {
  const server = await createGameServer({
    serveClient: false,
    production: true,
    matchOptions: {
      map: makeFlatMap(),
      seed: 7,
      config: {
        tickRate: 60,
        fragLimit: 10,
        countdownMs: 50,
        respawnMs: 0,
        roundResetMs: 50,
        matchDurationMs: 60_000,
        reconnectWindowMs: 2_000,
      },
    },
  });
  servers.push(server);
  const port = await server.listen(0, '127.0.0.1');
  return { server, url: `http://127.0.0.1:${port}` };
}

function createClient(url: string): TestClient {
  const client: TestClient = io(url, {
    auth: { protocolVersion: PROTOCOL_VERSION },
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  clients.push(client);
  return client;
}

function waitForConnect(client: TestClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('connect timeout')), 10_000);
    client.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    client.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    client.connect();
  });
}

function join(client: TestClient, request: JoinRequest): Promise<JoinResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('join timeout')), 10_000);
    client.emit('join', request, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

function waitForSnapshot(client: TestClient): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('snapshot timeout')), 10_000);
    client.once('snapshot', (snapshot) => {
      clearTimeout(timeout);
      resolve(snapshot);
    });
  });
}

function waitForKill(client: TestClient, victimId: string): Promise<KillEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('kill timeout')), 10_000);
    const listener = (event: KillEvent): void => {
      if (event.victimId !== victimId) {
        return;
      }
      clearTimeout(timeout);
      client.off('kill', listener);
      resolve(event);
    };
    client.on('kill', listener);
  });
}

function waitForRoundEnd(client: TestClient): Promise<RoundEndEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('round_end timeout')), 15_000);
    client.once('round_end', (event) => {
      clearTimeout(timeout);
      resolve(event);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitUntil timeout');
    }
    await delay(10);
  }
}

describe('networked 1v1 match', () => {
  it('plays a full ten-round match over Socket.IO', async () => {
    const { server, url } = await startServer();
    const alpha = createClient(url);
    const bravo = createClient(url);
    await Promise.all([waitForConnect(alpha), waitForConnect(bravo)]);

    const alphaJoin = await join(alpha, { name: 'Alpha' });
    const bravoJoin = await join(bravo, { name: 'Bravo' });
    expect(alphaJoin.ok).toBe(true);
    expect(bravoJoin.ok).toBe(true);
    expect(alphaJoin.playerId).toBeDefined();
    expect(bravoJoin.playerId).toBeDefined();

    const initial = await waitForSnapshot(alpha);
    expect(initial.players).toHaveLength(2);
    expect(initial.mapId).toBe('fy_wow');
    expect(initial.armorPickups).toEqual([]);
    await waitUntil(() => server.match.currentPhase === 'live');

    const alphaId = alphaJoin.playerId;
    const bravoId = bravoJoin.playerId;
    if (alphaId === undefined || bravoId === undefined) {
      throw new Error('Missing player ids');
    }
    const shooter = server.match.getPlayer(alphaId);
    const victim = server.match.getPlayer(bravoId);
    if (shooter === undefined || victim === undefined) {
      throw new Error('Missing player state');
    }

    addWeapon(shooter, 'ak47');
    const roundEndPromise = waitForRoundEnd(alpha);
    let sequence = 0;

    for (let killIndex = 0; killIndex < 10; killIndex += 1) {
      await waitUntil(() => server.match.currentPhase === 'live' && victim.alive);
      addWeapon(shooter, 'ak47');
      shooter.position = vec3(0, 0, -4);
      shooter.velocity = vec3();
      victim.position = vec3(0, 0, 4);
      victim.velocity = vec3();
      victim.health = 1;
      victim.armor = 0;
      victim.history = [];
      const now = Date.now();
      recordHistory(victim, now);

      sequence += 1;
      const killPromise = waitForKill(alpha, bravoId);
      alpha.emit('input', {
        seq: sequence,
        clientTime: now,
        aimTime: now,
        forward: 0,
        strafe: 0,
        yaw: Math.PI,
        pitch: -0.08,
        jump: false,
        crouch: false,
        walk: false,
        fire: true,
        scoped: false,
        reload: false,
        use: false,
        drop: false,
        switchTo: null,
      });
      const kill = await killPromise;
      expect(kill.killerId).toBe(alphaId);
      expect(kill.victimId).toBe(bravoId);

      sequence += 1;
      alpha.emit('input', {
        seq: sequence,
        clientTime: Date.now(),
        aimTime: Date.now(),
        forward: 0,
        strafe: 0,
        yaw: Math.PI,
        pitch: -0.08,
        jump: false,
        crouch: false,
        walk: false,
        fire: false,
        scoped: false,
        reload: false,
        use: false,
        drop: false,
        switchTo: null,
      });
      await delay(110);
    }

    const roundEnd = await roundEndPromise;
    expect(roundEnd.winnerId).toBe(alphaId);
    expect(roundEnd.reason).toBe('frags');
    expect(roundEnd.scores.alpha).toBe(10);
    expect(server.match.currentPhase).toBe('ended');
    expect(server.match.getLobbyState().scores).toEqual({ alpha: 10, bravo: 0 });
  }, 30_000);
});
