import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type CreateRoomRequest,
  type CreateRoomResult,
  type JoinRequest,
  type JoinResult,
  type RoomSummary,
  type ServerToClientEvents,
  type Snapshot,
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

function createRoom(client: TestClient, request: CreateRoomRequest): Promise<CreateRoomResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('create_room timeout')), 10_000);
    client.emit('create_room', request, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

function listRooms(client: TestClient): Promise<RoomSummary[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('list_rooms timeout')), 10_000);
    client.emit('list_rooms', (rooms) => {
      clearTimeout(timeout);
      resolve(rooms);
    });
  });
}

describe('multi-room networking', () => {
  it('allows clients to list rooms, create rooms, and play in parallel rooms', async () => {
    const { server, url } = await startServer();

    const client1 = createClient(url);
    const client2 = createClient(url);
    const client3 = createClient(url);

    await Promise.all([waitForConnect(client1), waitForConnect(client2), waitForConnect(client3)]);

    // Check initial room list (has default room)
    const initialRooms = await listRooms(client1);
    expect(initialRooms.length).toBeGreaterThanOrEqual(1);

    // Client 1 creates a new Dust2 room
    const created1 = await createRoom(client1, {
      name: 'Dust2 Battle',
      mapId: 'de_dust2',
    });
    expect(created1.ok).toBe(true);
    expect(created1.roomId).toBeDefined();
    const dustRoomId = created1.roomId!;

    // Client 3 creates a Wow room
    const created2 = await createRoom(client3, {
      name: 'Wow Arena',
      mapId: 'fy_wow',
    });
    expect(created2.ok).toBe(true);
    expect(created2.roomId).toBeDefined();
    const wowRoomId = created2.roomId!;

    // Client 2 lists rooms and sees both new rooms
    const updatedRooms = await listRooms(client2);
    expect(updatedRooms.some((r) => r.id === dustRoomId)).toBe(true);
    expect(updatedRooms.some((r) => r.id === wowRoomId)).toBe(true);

    // Client 1 and Client 2 join the Dust2 room
    const join1 = await join(client1, { name: 'Player1', roomId: dustRoomId });
    const join2 = await join(client2, { name: 'Player2', roomId: dustRoomId });
    expect(join1.ok).toBe(true);
    expect(join2.ok).toBe(true);
    expect(join1.mapId).toBe('de_dust2');
    expect(join2.mapId).toBe('de_dust2');

    // Client 3 joins the Wow room
    const join3 = await join(client3, { name: 'Player3', roomId: wowRoomId });
    expect(join3.ok).toBe(true);
    expect(join3.mapId).toBe('fy_wow');

    // Wait for Dust2 match to start
    const dustRoom = server.rooms.getRoom(dustRoomId);
    expect(dustRoom).toBeDefined();
    await waitUntil(() => dustRoom!.match.currentPhase === 'live' || dustRoom!.match.currentPhase === 'countdown');

    // Verify isolation: Dust2 room has exactly 2 players (Player1 and Player2), Wow room has 1 player (Player3)
    expect(dustRoom!.match.getPlayers().length).toBe(2);
    const wowRoom = server.rooms.getRoom(wowRoomId);
    expect(wowRoom!.match.getPlayers().length).toBe(1);

    // Snapshots received by client3 are for Wow, not Dust2
    let client3Snapshot: Snapshot | null = null;
    client3.on('snapshot', (s) => {
      client3Snapshot = s;
    });
    await waitUntil(() => client3Snapshot !== null);
    expect(client3Snapshot!.mapId).toBe('fy_wow');

    // Client 3 leaves the room -> wow room becomes empty and should be cleaned up immediately
    client3.emit('leave');
    await waitUntil(() => server.rooms.getRoom(wowRoomId) === undefined);
    expect(server.rooms.getRoom(wowRoomId)).toBeUndefined();
  });
});
