import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { Server as SocketServer, type Socket } from 'socket.io';
import { NETWORK } from '../shared/config';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type InterServerEvents,
  type JoinResult,
  type ServerHello,
  type ServerToClientEvents,
  type SocketData,
} from '../shared/protocol';
import { logger } from './logger';
import { createCrosshairStore, CrosshairValidationError, type CrosshairStore } from './crosshairs';
import { RoomManager, type GameRoom } from './game/roomManager';
import type { Match, MatchEvent, MatchOptions } from './game/match';
import { RateLimiter } from './net/rateLimiter';
import {
  buySchema,
  chooseTeamSchema,
  createRoomSchema,
  inputSchema,
  joinSchema,
  pingSchema,
  setReadySchema,
} from './net/validation';
import { formatServerUrls } from './network';

const projectRoot = process.cwd();
const clientRoot = path.join(projectRoot, 'client');
const clientDist = path.join(projectRoot, 'dist', 'client');
const viteConfig = path.join(projectRoot, 'vite.config.ts');

export type GameSocketServer = SocketServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface CreateGameServerOptions {
  serveClient?: boolean;
  production?: boolean;
  matchOptions?: MatchOptions;
  crosshairStore?: CrosshairStore;
}

export interface GameServer {
  readonly app: Express;
  readonly httpServer: HttpServer;
  readonly io: GameSocketServer;
  readonly rooms: RoomManager;
  readonly match: Match;
  listen(port: number, host: string): Promise<number>;
  close(): Promise<void>;
}

interface Runtime {
  rooms: RoomManager;
  broadcastRoomEvents(room: GameRoom, events: MatchEvent[]): void;
  broadcastRoomSnapshot(room: GameRoom, now: number): void;
}

function readProtocolVersion(auth: unknown): number | undefined {
  if (typeof auth !== 'object' || auth === null || !('protocolVersion' in auth)) {
    return undefined;
  }
  const value = (auth as { protocolVersion?: unknown }).protocolVersion;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function runSafely(socketId: string, label: string, handler: () => void): void {
  try {
    handler();
  } catch (error) {
    logger.error(`Error in ${label} handler`, { socketId, error });
  }
}

function replyJoin(ack: (result: JoinResult) => void, result: JoinResult): void {
  if (typeof ack === 'function') {
    ack(result);
  }
}

function createRuntime(io: GameSocketServer, rooms: RoomManager): Runtime {
  const forEachSocketInRoom = (room: GameRoom, callback: (socketId: string) => void): void => {
    for (const player of room.match.getPlayers()) {
      if (player.socketId !== null) {
        callback(player.socketId);
      }
    }
  };

  return {
    rooms,
    broadcastRoomEvents: (room, events) => {
      for (const event of events) {
        switch (event.type) {
          case 'lobby':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('lobby', event.state));
            break;
          case 'countdown':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('countdown', event.state));
            break;
          case 'hit':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('hit', event.event));
            break;
          case 'shot':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('shot', event.event));
            break;
          case 'kill':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('kill', event.event));
            break;
          case 'pickup':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('pickup', event.event));
            break;
          case 'armor_pickup':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('armor_pickup', event.event));
            break;
          case 'grenade_thrown':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('grenade_thrown', event.event));
            break;
          case 'explosion':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('explosion', event.event));
            break;
          case 'bomb_event':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('bomb_event', event.event));
            break;
          case 'buy_result':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('buy_result', event.event));
            break;
          case 'score_update':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('score_update', event.event));
            break;
          case 'round_summary':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('round_summary', event.event));
            break;
          case 'round_end':
            forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('round_end', event.event));
            break;
        }
      }
    },
    broadcastRoomSnapshot: (room, now) => {
      const snapshot = room.match.getSnapshot(now);
      forEachSocketInRoom(room, (socketId) => io.to(socketId).emit('snapshot', snapshot));
    },
  };
}

function registerSocketHandlers(io: GameSocketServer, runtime: Runtime): void {
  const { rooms } = runtime;

  io.use((socket, next) => {
    const clientVersion = readProtocolVersion(socket.handshake.auth);
    if (clientVersion !== PROTOCOL_VERSION) {
      logger.warn('Rejected client with incompatible protocol', {
        socketId: socket.id,
        clientVersion: clientVersion ?? 'missing',
        serverVersion: PROTOCOL_VERSION,
      });
      next(
        new Error(
          `Protocol mismatch: server=${PROTOCOL_VERSION}, client=${clientVersion ?? 'missing'}. Reload the page.`,
        ),
      );
      return;
    }
    next();
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    const inputLimiter = new RateLimiter(NETWORK.maxInputsPerSecond, 1000);
    const pingLimiter = new RateLimiter(NETWORK.maxPingPerSecond, 1000);
    const joinLimiter = new RateLimiter(NETWORK.maxJoinsPerMinute, 60_000);
    const rematchLimiter = new RateLimiter(NETWORK.maxRematchPerMinute, 60_000);
    const buyLimiter = new RateLimiter(40, 60_000);

    const defaultRoom = rooms.getDefaultRoom();
    const hello: ServerHello = {
      protocolVersion: PROTOCOL_VERSION,
      tickRate: defaultRoom?.match.config.tickRate ?? 30,
      serverTime: Date.now(),
      mapId: defaultRoom?.map.id ?? 'fy_sand',
      mapName: defaultRoom?.map.name ?? 'fy_sand',
      mode: defaultRoom?.match.getMode() ?? 'arena',
    };
    socket.emit('serverHello', hello);

    socket.on('list_rooms', (ack) => {
      runSafely(socket.id, 'list_rooms', () => {
        if (typeof ack === 'function') {
          ack(rooms.listRooms());
        }
      });
    });

    socket.on('create_room', (payload, ack) => {
      runSafely(socket.id, 'create_room', () => {
        const parsed = createRoomSchema.safeParse(payload);
        if (!parsed.success) {
          if (typeof ack === 'function') {
            ack({ ok: false, error: 'Некорректные параметры игры' });
          }
          return;
        }
        try {
          const room = rooms.createRoom({
            name: parsed.data.name,
            mapId: parsed.data.mapId,
            roomMode: parsed.data.roomMode ?? '1v1',
          });
          io.emit('rooms_update', rooms.listRooms());
          if (typeof ack === 'function') {
            ack({ ok: true, roomId: room.id });
          }
        } catch (error) {
          if (typeof ack === 'function') {
            ack({
              ok: false,
              error: error instanceof Error ? error.message : 'Не удалось создать игру',
            });
          }
        }
      });
    });

    socket.on('join', (payload, ack) => {
      runSafely(socket.id, 'join', () => {
        const now = Date.now();
        if (!joinLimiter.allow(now)) {
          replyJoin(ack, { ok: false, error: 'Слишком много попыток входа' });
          return;
        }
        if (socket.data.playerId !== undefined) {
          replyJoin(ack, { ok: false, error: 'Вы уже находитесь в игре' });
          return;
        }

        const parsed = joinSchema.safeParse(payload);
        if (!parsed.success) {
          replyJoin(ack, { ok: false, error: 'Некорректные данные входа' });
          return;
        }

        let targetRoom: GameRoom | undefined;
        if (parsed.data.roomId !== undefined) {
          targetRoom = rooms.getRoom(parsed.data.roomId);
          if (targetRoom === undefined) {
            replyJoin(ack, { ok: false, error: 'Игра не найдена или уже завершена' });
            return;
          }
        } else if (parsed.data.playerId !== undefined) {
          targetRoom = rooms.findRoomForPlayer(parsed.data.playerId) ?? rooms.getDefaultRoom();
        } else {
          targetRoom = rooms.getDefaultRoom();
        }

        if (targetRoom === undefined) {
          replyJoin(ack, { ok: false, error: 'Нет доступных игр' });
          return;
        }

        const outcome = targetRoom.match.join(socket.id, parsed.data, now);
        if (!outcome.result.ok) {
          replyJoin(ack, outcome.result);
          return;
        }

        const result: JoinResult = {
          ...outcome.result,
          roomId: targetRoom.id,
          mapId: targetRoom.map.id,
          mapName: targetRoom.map.name,
          mode: targetRoom.match.getMode(),
        };

        if (result.playerId !== undefined) {
          socket.data.playerId = result.playerId;
        }
        socket.data.roomId = targetRoom.id;
        socket.join(targetRoom.id);

        if (outcome.replacedSocketId !== undefined) {
          io.sockets.sockets.get(outcome.replacedSocketId)?.disconnect(true);
        }
        replyJoin(ack, result);
        runtime.broadcastRoomEvents(targetRoom, targetRoom.match.drainEvents());
        runtime.broadcastRoomSnapshot(targetRoom, now);
        io.emit('rooms_update', rooms.listRooms());
      });
    });

    const getSocketRoom = (): GameRoom | undefined => {
      if (socket.data.roomId !== undefined) {
        return rooms.getRoom(socket.data.roomId);
      }
      if (socket.data.playerId !== undefined) {
        return rooms.findRoomForPlayer(socket.data.playerId);
      }
      return undefined;
    };

    socket.on('input', (payload) => {
      runSafely(socket.id, 'input', () => {
        const playerId = socket.data.playerId;
        const room = getSocketRoom();
        if (playerId === undefined || room === undefined) {
          return;
        }
        const now = Date.now();
        if (!inputLimiter.allow(now)) {
          return;
        }
        const parsed = inputSchema.safeParse(payload);
        if (!parsed.success) {
          logger.debug('Rejected invalid input', { socketId: socket.id });
          return;
        }
        room.match.setInput(playerId, parsed.data, now);
      });
    });

    const handleBuy =
      (action: 'buy' | 'refund') =>
      (payload: unknown): void => {
        runSafely(socket.id, action, () => {
          const playerId = socket.data.playerId;
          const room = getSocketRoom();
          if (playerId === undefined || room === undefined) {
            return;
          }
          const now = Date.now();
          if (!buyLimiter.allow(now)) {
            return;
          }
          const parsed = buySchema.safeParse(payload);
          if (!parsed.success) {
            return;
          }
          if (action === 'buy') {
            room.match.buy(playerId, parsed.data.itemId, now);
          } else {
            room.match.refund(playerId, parsed.data.itemId, now);
          }
          runtime.broadcastRoomEvents(room, room.match.drainEvents());
          runtime.broadcastRoomSnapshot(room, now);
        });
      };

    socket.on('buy', handleBuy('buy'));
    socket.on('refund', handleBuy('refund'));

    socket.on('rematch', () => {
      runSafely(socket.id, 'rematch', () => {
        const playerId = socket.data.playerId;
        const room = getSocketRoom();
        if (playerId === undefined || room === undefined) {
          return;
        }
        const now = Date.now();
        if (!rematchLimiter.allow(now)) {
          return;
        }
        room.match.voteRematch(playerId, now);
        runtime.broadcastRoomEvents(room, room.match.drainEvents());
        runtime.broadcastRoomSnapshot(room, now);
      });
    });

    socket.on('choose_team', (payload) => {
      runSafely(socket.id, 'choose_team', () => {
        const playerId = socket.data.playerId;
        const room = getSocketRoom();
        if (playerId === undefined || room === undefined) {
          return;
        }
        const parsed = chooseTeamSchema.safeParse(payload);
        if (!parsed.success) {
          return;
        }
        const now = Date.now();
        room.match.chooseTeam(playerId, parsed.data.team, now);
        runtime.broadcastRoomEvents(room, room.match.drainEvents());
        runtime.broadcastRoomSnapshot(room, now);
      });
    });

    socket.on('set_ready', (payload) => {
      runSafely(socket.id, 'set_ready', () => {
        const playerId = socket.data.playerId;
        const room = getSocketRoom();
        if (playerId === undefined || room === undefined) {
          return;
        }
        const parsed = setReadySchema.safeParse(payload);
        if (!parsed.success) {
          return;
        }
        const now = Date.now();
        room.match.setReady(playerId, parsed.data.ready, now);
        runtime.broadcastRoomEvents(room, room.match.drainEvents());
        runtime.broadcastRoomSnapshot(room, now);
      });
    });

    socket.on('leave', () => {
      runSafely(socket.id, 'leave', () => {
        const playerId = socket.data.playerId;
        const room = getSocketRoom();
        if (playerId === undefined || room === undefined) {
          return;
        }
        const now = Date.now();
        room.match.leave(playerId, now);
        socket.leave(room.id);
        socket.data.playerId = undefined;
        socket.data.roomId = undefined;
        runtime.broadcastRoomEvents(room, room.match.drainEvents());
        runtime.broadcastRoomSnapshot(room, now);
        rooms.cleanupEmptyRoom(room.id);
        io.emit('rooms_update', rooms.listRooms());
      });
    });

    socket.on('ping', (payload) => {
      runSafely(socket.id, 'ping', () => {
        const now = Date.now();
        if (!pingLimiter.allow(now)) {
          return;
        }
        const parsed = pingSchema.safeParse(payload);
        if (!parsed.success) {
          logger.debug('Rejected invalid ping payload', { socketId: socket.id });
          return;
        }

        socket.emit('pong', {
          clientTime: parsed.data.clientTime,
          serverTime: now,
          protocolVersion: PROTOCOL_VERSION,
        });
      });
    });

    socket.on('disconnect', (reason) => {
      runSafely(socket.id, 'disconnect', () => {
        const playerId = socket.data.playerId;
        const room = getSocketRoom();
        if (playerId !== undefined && room !== undefined) {
          const now = Date.now();
          room.match.disconnect(playerId, now, socket.id);
          socket.leave(room.id);
          socket.data.playerId = undefined;
          socket.data.roomId = undefined;
          runtime.broadcastRoomEvents(room, room.match.drainEvents());
          runtime.broadcastRoomSnapshot(room, now);
          rooms.cleanupEmptyRoom(room.id);
          io.emit('rooms_update', rooms.listRooms());
        }
      });
      logger.info(`Socket disconnected: ${socket.id} (${reason})`);
    });
  });
}

async function attachClient(
  app: Express,
  httpServer: HttpServer,
  options: { serveClient: boolean; production: boolean },
): Promise<() => Promise<void>> {
  if (!options.serveClient) {
    return async () => undefined;
  }

  if (options.production) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'), (error) => {
        if (error) {
          next(error);
        }
      });
    });
    return async () => undefined;
  }

  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    configFile: viteConfig,
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
      allowedHosts: true,
    },
    appType: 'spa',
  });

  app.use(vite.middlewares as unknown as RequestHandler);
  app.use(async (req, res, next) => {
    if (req.method !== 'GET' || !req.accepts('html')) {
      next();
      return;
    }

    try {
      const template = await readFile(path.join(clientRoot, 'index.html'), 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (error) {
      if (error instanceof Error) {
        vite.ssrFixStacktrace(error);
      }
      next(error);
    }
  });

  return async () => {
    await vite.close();
  };
}

export async function createGameServer(options: CreateGameServerOptions = {}): Promise<GameServer> {
  const serveClient = options.serveClient ?? true;
  const production = options.production ?? process.env.NODE_ENV === 'production';

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  const crosshairStore = options.crosshairStore ?? createCrosshairStore();
  const crosshairLimiter = new RateLimiter(20, 60_000);
  app.get('/api/crosshairs', async (_req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store').json(await crosshairStore.list());
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/crosshairs', async (req, res, next) => {
    try {
      if (!crosshairLimiter.allow(Date.now())) {
        res.status(429).json({ error: 'Слишком много сохранений прицела' });
        return;
      }
      const body: unknown = req.body;
      const author =
        typeof body === 'object' && body !== null && 'author' in body
          ? (body as { author?: unknown }).author
          : undefined;
      const preset = await crosshairStore.save(author, body);
      res.status(201).json(preset);
    } catch (error) {
      if (error instanceof CrosshairValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });
  app.delete('/api/crosshairs/:id', async (req, res, next) => {
    try {
      if (!crosshairLimiter.allow(Date.now())) {
        res.status(429).json({ error: 'Слишком много изменений каталога' });
        return;
      }
      const id = req.params.id;
      if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
        res.status(400).json({ error: 'Некорректный идентификатор прицела' });
        return;
      }
      const removed = await crosshairStore.remove(id);
      if (!removed) {
        res.status(404).json({ error: 'Прицел не найден' });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  const httpServer = createHttpServer(app);
  const io: GameSocketServer = new SocketServer(httpServer, {
    serveClient: false,
    pingInterval: 10_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 64 * 1024,
  });

  const rooms = new RoomManager(
    options.matchOptions !== undefined
      ? {
          id: 'default',
          name: 'Основная игра',
          mapId: options.matchOptions.map?.id ?? 'fy_sand',
          matchOptions: options.matchOptions,
          isDefault: true,
        }
      : undefined,
  );
  const runtime = createRuntime(io, rooms);
  registerSocketHandlers(io, runtime);
  const closeClient = await attachClient(app, httpServer, { serveClient, production });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    logger.error('HTTP request failed', { error });
    if (res.headersSent) {
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);

  const tickRate = options.matchOptions?.config?.tickRate ?? 30;
  const tickMs = 1000 / tickRate;
  let tickTimer: NodeJS.Timeout | null = null;
  let ticking = false;
  let nextTickAt = 0;
  let closed = false;

  const scheduleTick = (): void => {
    if (!ticking) {
      return;
    }

    const nowPerf = performance.now();
    let steps = 0;
    while (nowPerf >= nextTickAt && steps < 5) {
      const now = Date.now();
      try {
        for (const room of rooms.getAllRooms()) {
          room.match.tick(now, tickMs / 1000);
          runtime.broadcastRoomEvents(room, room.match.drainEvents());
          runtime.broadcastRoomSnapshot(room, now);
        }
      } catch (error) {
        logger.error('Game tick failed', { error });
      }
      nextTickAt += tickMs;
      steps += 1;
    }

    if (steps === 5) {
      nextTickAt = nowPerf + tickMs;
    }

    tickTimer = setTimeout(scheduleTick, Math.max(0, nextTickAt - performance.now()));
  };

  const startTicking = (): void => {
    if (ticking) {
      return;
    }
    ticking = true;
    nextTickAt = performance.now() + tickMs;
    tickTimer = setTimeout(scheduleTick, tickMs);
  };

  const stopTicking = (): void => {
    ticking = false;
    if (tickTimer !== null) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
  };

  return {
    app,
    httpServer,
    io,
    rooms,
    get match(): Match {
      let room = rooms.getDefaultRoom() ?? rooms.getAllRooms()[0];
      if (!room) {
        room = rooms.createRoom({
          id: 'default',
          name: 'Основная игра',
          mapId: 'fy_sand',
          isDefault: true,
        });
      }
      return room.match;
    },
    listen: (port, host) =>
      new Promise<number>((resolve, reject) => {
        const onError = (error: Error): void => {
          httpServer.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          httpServer.off('error', onError);
          const address = httpServer.address();
          const actualPort = typeof address === 'object' && address !== null ? address.port : port;
          logger.info(`Listening on ${host}:${actualPort}`);
          for (const line of formatServerUrls(actualPort, host)) {
            logger.info(line);
          }
          startTicking();
          resolve(actualPort);
        };

        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port, host);
      }),
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      stopTicking();

      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
      await closeClient();

      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  };
}
