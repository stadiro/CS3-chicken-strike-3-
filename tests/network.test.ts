import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createGameServer, type GameServer } from '../server/server';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type PongMessage,
  type ServerHello,
  type ServerToClientEvents,
} from '../shared/protocol';

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

async function startTestServer(): Promise<string> {
  const server = await createGameServer({ serveClient: false, production: true });
  servers.push(server);
  const port = await server.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${port}`;
}

function createClient(url: string, protocolVersion = PROTOCOL_VERSION): TestClient {
  const client: TestClient = io(url, {
    auth: { protocolVersion },
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
    const timeout = setTimeout(() => reject(new Error('connect timeout')), 3000);
    client.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    client.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForHello(client: TestClient): Promise<ServerHello> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('serverHello timeout')), 3000);
    client.once('serverHello', (hello) => {
      clearTimeout(timeout);
      resolve(hello);
    });
  });
}

function waitForPong(client: TestClient): Promise<PongMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('pong timeout')), 3000);
    client.once('pong', (pong) => {
      clearTimeout(timeout);
      resolve(pong);
    });
  });
}

describe('network handshake', () => {
  it('accepts a client with the matching protocol version and sends serverHello', async () => {
    const url = await startTestServer();
    const client = createClient(url);
    const helloPromise = waitForHello(client);

    client.connect();
    await waitForConnect(client);
    const hello = await helloPromise;

    expect(hello.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(hello.tickRate).toBe(30);
    expect(hello.serverTime).toBeGreaterThan(0);
    expect(hello.mapId).toBe('fy_sand');
    expect(hello.mapName).toBe('fy_sand');
    expect(hello.mode).toBe('arena');
  });

  it('answers ping with pong and echoes clientTime', async () => {
    const url = await startTestServer();
    const client = createClient(url);

    client.connect();
    await waitForConnect(client);

    const pongPromise = waitForPong(client);
    client.emit('ping', { clientTime: 123.5 });
    const pong = await pongPromise;

    expect(pong.clientTime).toBe(123.5);
    expect(pong.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(pong.serverTime).toBeGreaterThan(0);
  });

  it('rejects a client with a different protocol version', async () => {
    const url = await startTestServer();
    const client = createClient(url, PROTOCOL_VERSION + 1);

    const error = await new Promise<Error>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('connect_error timeout')), 3000);
      client.once('connect_error', (connectError) => {
        clearTimeout(timeout);
        resolve(connectError);
      });
      client.connect();
    });

    expect(error.message).toContain('Protocol mismatch');
    expect(client.connected).toBe(false);
  });

  it('survives an invalid ping payload and keeps serving valid pings', async () => {
    const url = await startTestServer();
    const client = createClient(url);

    client.connect();
    await waitForConnect(client);

    client.emit('ping', { clientTime: -1 });
    const pongPromise = waitForPong(client);
    client.emit('ping', { clientTime: 42 });
    const pong = await pongPromise;

    expect(pong.clientTime).toBe(42);
  });
});
