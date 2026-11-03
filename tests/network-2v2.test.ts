import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type CountdownState,
  type CreateRoomRequest,
  type CreateRoomResult,
  type JoinResult,
  type LobbyState,
  type RoomSummary,
  type ServerToClientEvents,
} from '../shared/protocol';
import { createGameServer, type GameServer } from '../server/server';

function waitUntil(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(interval);
        reject(new Error('waitUntil timeout'));
      }
    }, 10);
  });
}

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;

const servers: GameServer[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients) {
    client.removeAllListeners();
    client.disconnect();
  }
  clients.length = 0;
  for (const server of servers) {
    await server.close();
  }
  servers.length = 0;
});

async function startServer(): Promise<{ server: GameServer; url: string }> {
  const server = await createGameServer({
    serveClient: false,
    production: true,
  });
  servers.push(server);
  const port = await server.listen(0, '127.0.0.1');
  return { server, url: `http://127.0.0.1:${port}` };
}

function createClient(url: string): TestClient {
  const client: TestClient = io(url, {
    auth: { protocolVersion: PROTOCOL_VERSION },
    transports: ['websocket'],
    reconnection: false,
  });
  clients.push(client);
  return client;
}

function waitForConnect(client: TestClient): Promise<void> {
  return new Promise((resolve) => {
    if (client.connected) {
      resolve();
    } else {
      client.once('connect', () => resolve());
    }
  });
}

describe('2v2 networking flow', () => {
  it('creates a 2v2 room, connects 4 players, chooses teams, readies up, and launches countdown', async () => {
    const { url } = await startServer();

    const host = createClient(url);
    await waitForConnect(host);

    // 1. Create a 2v2 room
    const createReq: CreateRoomRequest = {
      name: 'Dust 2v2 Battle',
      mapId: 'de_dust2',
      roomMode: '2v2',
    };
    const createRes = await new Promise<CreateRoomResult>((resolve) => {
      host.emit('create_room', createReq, resolve);
    });
    expect(createRes.ok).toBe(true);
    const roomId = createRes.roomId!;

    // 2. Check room list has 2v2 metadata
    const roomsList = await new Promise<RoomSummary[]>((resolve) => {
      host.emit('list_rooms', resolve);
    });
    const createdSummary = roomsList.find((r) => r.id === roomId);
    expect(createdSummary).toBeDefined();
    expect(createdSummary?.roomMode).toBe('2v2');
    expect(createdSummary?.maxPlayers).toBe(4);

    // 3. Connect 4 players into this room
    const c1 = host;
    const c2 = createClient(url);
    const c3 = createClient(url);
    const c4 = createClient(url);
    await Promise.all([waitForConnect(c2), waitForConnect(c3), waitForConnect(c4)]);

    let latestLobby: LobbyState | null = null;
    c1.on('lobby', (state) => {
      latestLobby = state;
    });

    let countdownReceived: CountdownState | null = null;
    c1.on('countdown', (state) => {
      countdownReceived = state;
    });

    const join = (client: TestClient, name: string): Promise<JoinResult> =>
      new Promise((resolve) => {
        client.emit('join', { name, roomId }, resolve);
      });

    const [j1, j2, j3, j4] = await Promise.all([
      join(c1, 'Player1'),
      join(c2, 'Player2'),
      join(c3, 'Player3'),
      join(c4, 'Player4'),
    ]);

    expect(j1.ok).toBe(true);
    expect(j2.ok).toBe(true);
    expect(j3.ok).toBe(true);
    expect(j4.ok).toBe(true);

    await waitUntil(() => latestLobby !== null && latestLobby.players.length === 4);
    expect(latestLobby!.roomMode).toBe('2v2');
    expect(latestLobby!.maxPlayers).toBe(4);
    expect(latestLobby!.phase).toBe('lobby');

    // 4. Test team switching over socket
    c1.emit('choose_team', { team: 'alpha' });

    // 5. Ready up all 4 players
    c1.emit('set_ready', { ready: true });
    c2.emit('set_ready', { ready: true });
    c3.emit('set_ready', { ready: true });
    c4.emit('set_ready', { ready: true });

    // 6. Match countdown begins!
    await waitUntil(() => countdownReceived !== null, 5000);
    expect(countdownReceived).toBeDefined();
    expect(countdownReceived!.seconds).toBeGreaterThan(0);
  });
});
