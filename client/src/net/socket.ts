import { io, type Socket } from 'socket.io-client';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type CreateRoomRequest,
  type CreateRoomResult,
  type JoinRequest,
  type JoinResult,
  type RoomSummary,
  type ServerHello,
  type ServerToClientEvents,
} from '../../../shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface ConnectionState {
  connected: boolean;
  pingMs: number | null;
  jitterMs: number;
  lossPercent: number;
}

export interface ConnectOptions {
  onStateChange?: (state: ConnectionState) => void;
  onError?: (message: string) => void;
  onHello?: (hello: ServerHello) => void;
}

export interface Connection {
  socket: GameSocket;
  join(request: JoinRequest): Promise<JoinResult>;
  createRoom(request: CreateRoomRequest): Promise<CreateRoomResult>;
  listRooms(): Promise<RoomSummary[]>;
  getServerTime(): number;
  getPingMs(): number | null;
  getJitterMs(): number;
  getLossPercent(): number;
  getTickRate(): number;
  dispose(): void;
}

const PING_INTERVAL_MS = 1000;
const JOIN_TIMEOUT_MS = 6000;

export function connectToGameServer(options: ConnectOptions = {}): Connection {
  const socket: GameSocket = io({
    auth: { protocolVersion: PROTOCOL_VERSION },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
  });

  let pingTimer: number | undefined;
  let pingMs: number | null = null;
  let pingJitterMs = 0;
  let lastPingRtt: number | null = null;
  let serverTimeOffset: number | null = null;
  let tickRate = 30;
  let lastSnapshotTick: number | null = null;
  let snapshotsReceived = 0;
  let snapshotsLost = 0;

  const lossPercent = (): number => {
    const total = snapshotsReceived + snapshotsLost;
    return total === 0 ? 0 : Math.round((snapshotsLost / total) * 1000) / 10;
  };

  const emitState = (): void => {
    options.onStateChange?.({
      connected: socket.connected,
      pingMs,
      jitterMs: Math.round(pingJitterMs * 10) / 10,
      lossPercent: lossPercent(),
    });
  };

  const sendPing = (): void => {
    socket.emit('ping', {
      clientTime: performance.timeOrigin + performance.now(),
    });
  };

  socket.on('connect', () => {
    pingMs = null;
    pingJitterMs = 0;
    lastPingRtt = null;
    lastSnapshotTick = null;
    snapshotsReceived = 0;
    snapshotsLost = 0;
    emitState();

    window.clearInterval(pingTimer);
    sendPing();
    pingTimer = window.setInterval(sendPing, PING_INTERVAL_MS);
  });

  socket.on('pong', (payload) => {
    const now = performance.timeOrigin + performance.now();
    const rtt = now - payload.clientTime;
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > 3000) {
      return;
    }

    const sampleOffset = payload.serverTime - (payload.clientTime + rtt / 2);
    if (!Number.isFinite(sampleOffset)) {
      return;
    }

    serverTimeOffset =
      serverTimeOffset === null ? sampleOffset : serverTimeOffset * 0.8 + sampleOffset * 0.2;
    if (lastPingRtt !== null) {
      pingJitterMs = pingJitterMs * 0.8 + Math.abs(rtt - lastPingRtt) * 0.2;
    }
    lastPingRtt = rtt;
    pingMs = Math.round(rtt);
    emitState();
  });

  socket.on('snapshot', (snapshot) => {
    if (lastSnapshotTick !== null && snapshot.tick > lastSnapshotTick) {
      const gap = snapshot.tick - lastSnapshotTick - 1;
      if (gap > 0) {
        snapshotsLost += Math.min(gap, 30);
      }
      snapshotsReceived += 1;
    } else if (lastSnapshotTick === null) {
      snapshotsReceived = 1;
    } else if (snapshot.tick < lastSnapshotTick) {
      // The server restarted or the clock was reset.
      lastSnapshotTick = null;
      snapshotsReceived = 1;
      snapshotsLost = 0;
    }
    lastSnapshotTick = snapshot.tick;
  });

  socket.on('serverHello', (hello) => {
    tickRate = hello.tickRate;
    if (serverTimeOffset === null) {
      serverTimeOffset = hello.serverTime - (performance.timeOrigin + performance.now());
    }
    options.onHello?.(hello);
  });

  socket.on('disconnect', () => {
    window.clearInterval(pingTimer);
    pingTimer = undefined;
    pingMs = null;
    pingJitterMs = 0;
    lastPingRtt = null;
    serverTimeOffset = null;
    emitState();
  });

  socket.on('connect_error', (error: Error) => {
    options.onError?.(error.message);
    emitState();
  });

  return {
    socket,
    join: (request) =>
      new Promise<JoinResult>((resolve, reject) => {
        if (!socket.connected) {
          reject(new Error('Нет соединения с сервером'));
          return;
        }

        let settled = false;

        const cleanup = (): void => {
          if (timer !== undefined) {
            window.clearTimeout(timer);
          }
          socket.off('disconnect', onDisconnect);
        };
        const finish = (result: JoinResult): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(result);
        };
        const fail = (error: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          reject(error);
        };
        const onDisconnect = (): void => {
          fail(new Error('Соединение прервано'));
        };

        const timer = window.setTimeout(() => {
          fail(new Error('Сервер не ответил на запрос входа'));
        }, JOIN_TIMEOUT_MS);
        socket.once('disconnect', onDisconnect);
        socket.emit('join', request, (result) => finish(result));
      }),
    createRoom: (request) =>
      new Promise<CreateRoomResult>((resolve, reject) => {
        if (!socket.connected) {
          reject(new Error('Нет соединения с сервером'));
          return;
        }
        const timer = window.setTimeout(() => reject(new Error('Таймаут создания игры')), 5000);
        socket.emit('create_room', request, (result) => {
          window.clearTimeout(timer);
          resolve(result);
        });
      }),
    listRooms: () =>
      new Promise<RoomSummary[]>((resolve, reject) => {
        if (!socket.connected) {
          reject(new Error('Нет соединения с сервером'));
          return;
        }
        const timer = window.setTimeout(
          () => reject(new Error('Таймаут получения списка игр')),
          5000,
        );
        socket.emit('list_rooms', (rooms) => {
          window.clearTimeout(timer);
          resolve(rooms);
        });
      }),
    getServerTime: () => performance.timeOrigin + performance.now() + (serverTimeOffset ?? 0),
    getPingMs: () => pingMs,
    getJitterMs: () => Math.round(pingJitterMs * 10) / 10,
    getLossPercent: lossPercent,
    getTickRate: () => tickRate,
    dispose: () => {
      window.clearInterval(pingTimer);
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
