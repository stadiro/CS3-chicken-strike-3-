import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createGameServer, type GameServer } from '../server/server';
import {
  PROTOCOL_VERSION,
  type BuyResultEvent,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
  type Snapshot,
} from '../shared/protocol';
import { makeFlatMap, makeInput } from './helpers';

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

async function startBuyServer(): Promise<{ server: GameServer; url: string }> {
  const server = await createGameServer({
    serveClient: false,
    production: true,
    matchOptions: {
      map: { ...makeFlatMap(), mode: 'buy' },
      seed: 11,
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

function join(client: TestClient, name: string): Promise<JoinResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('join timeout')), 10_000);
    client.emit('join', { name }, (result) => {
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

function waitForBuyResult(client: TestClient): Promise<BuyResultEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('buy_result timeout')), 10_000);
    client.once('buy_result', (event) => {
      clearTimeout(timeout);
      resolve(event);
    });
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitUntil timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('networked buy mode', () => {
  it('accepts buy/refund over Socket.IO and rejects the wrong side', async () => {
    const { server, url } = await startBuyServer();
    const alpha = createClient(url);
    const bravo = createClient(url);
    await Promise.all([waitForConnect(alpha), waitForConnect(bravo)]);

    const alphaJoin = await join(alpha, 'Alpha');
    const bravoJoin = await join(bravo, 'Bravo');
    expect(alphaJoin.ok).toBe(true);
    expect(bravoJoin.ok).toBe(true);
    await waitUntil(() => server.match.currentPhase === 'live');

    const snapshot = await waitForSnapshot(alpha);
    expect(snapshot.match.mode).toBe('buy');
    const alphaId = alphaJoin.playerId;
    if (alphaId === undefined) {
      throw new Error('Missing alpha id');
    }
    expect(server.match.getPlayer(alphaId)?.money).toBe(800);

    const buyPromise = waitForBuyResult(alpha);
    alpha.emit('buy', { itemId: 'p250' });
    const bought = await buyPromise;
    expect(bought.ok).toBe(true);
    expect(bought.action).toBe('buy');
    expect(bought.itemId).toBe('p250');
    expect(bought.money).toBe(500);
    expect(bought.playerId).toBe(alphaId);
    expect(server.match.getPlayer(alphaId)?.inventory.secondary?.id).toBe('p250');

    const sidePromise = waitForBuyResult(alpha);
    alpha.emit('buy', { itemId: 'usp' });
    const wrongSide = await sidePromise;
    expect(wrongSide.ok).toBe(false);
    expect(wrongSide.error).toContain('стороны');

    const refundPromise = waitForBuyResult(alpha);
    alpha.emit('refund', { itemId: 'p250' });
    const refunded = await refundPromise;
    expect(refunded.ok).toBe(true);
    expect(refunded.action).toBe('refund');
    expect(refunded.money).toBe(800);
    expect(server.match.getPlayer(alphaId)?.inventory.secondary?.id).toBe('glock');
  });

  it('plants and defuses the bomb over Socket.IO', async () => {
    const server = await createGameServer({
      serveClient: false,
      production: true,
      matchOptions: {
        map: {
          ...makeFlatMap(),
          mode: 'buy',
          bombSites: [
            {
              id: 'A',
              name: 'ПЛЕНТ A',
              center: { x: 0, y: 0, z: 0 },
              min: { x: -18, y: 0, z: -18 },
              max: { x: 18, y: 3, z: 18 },
            },
          ],
        },
        seed: 19,
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
    const url = `http://127.0.0.1:${port}`;

    const alpha = createClient(url);
    const bravo = createClient(url);
    await Promise.all([waitForConnect(alpha), waitForConnect(bravo)]);

    const alphaJoin = await join(alpha, 'Alpha');
    const bravoJoin = await join(bravo, 'Bravo');
    expect(alphaJoin.ok).toBe(true);
    expect(bravoJoin.ok).toBe(true);
    await waitUntil(() => server.match.currentPhase === 'live');

    const alphaPlayer = server.match.getPlayer(alphaJoin.playerId ?? '');
    const bravoPlayer = server.match.getPlayer(bravoJoin.playerId ?? '');
    if (alphaPlayer === undefined || bravoPlayer === undefined) {
      throw new Error('Missing players');
    }
    expect(alphaPlayer.side).toBe('t');
    expect(bravoPlayer.side).toBe('ct');

    alphaPlayer.position = { x: 0, y: 0, z: 0 };
    alphaPlayer.grounded = true;
    bravoPlayer.position = { x: 0.5, y: 0, z: 0 };
    bravoPlayer.grounded = true;
    bravoPlayer.defuseKit = true;

    let seq = 1;
    const plantInterval = setInterval(() => {
      alpha.emit('input', makeInput({ seq: seq++, clientTime: Date.now(), useHeld: true }));
    }, 25);

    await waitUntil(() => server.match.getBomb()?.state === 'planted', 6_000);
    clearInterval(plantInterval);
    alpha.emit('input', makeInput({ seq: seq++, clientTime: Date.now(), useHeld: false }));

    let ctSeq = 1;
    const defuseInterval = setInterval(() => {
      bravo.emit('input', makeInput({ seq: ctSeq++, clientTime: Date.now(), useHeld: true }));
    }, 25);

    await waitUntil(() => server.match.getBomb()?.state === 'defused', 7_000);
    clearInterval(defuseInterval);
    expect(server.match.getSnapshot(Date.now()).match.scores.bravo).toBe(1);
  }, 15_000);
});
