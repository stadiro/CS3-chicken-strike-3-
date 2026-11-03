import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import express, { type ErrorRequestHandler, type Request } from 'express';
import {
  executeAdminCommand,
  getAdminState,
  type AdminCommand,
  type AdminCommandResult,
} from './admin';
import { ADMIN_PAGE } from './adminUi';
import { logger } from './logger';
import { getLanAddresses, isLoopbackHost, normalizeHostname } from './network';
import type { GameServer } from './server';

export const MIN_ADMIN_TOKEN_LENGTH = 8;

export interface AdminServerOptions {
  /** When set, every /api request must provide this token. */
  token?: string;
  /** Called after a successful `quit` response has been flushed. */
  onQuit?: () => void;
}

export interface AdminServer {
  listen(port: number, host: string): Promise<number>;
  close(): Promise<void>;
}

function readProvidedToken(request: Request): string | null {
  const header = request.get('x-admin-token');
  if (header !== undefined && header.length > 0) {
    return header;
  }

  const authorization = request.get('authorization');
  if (authorization !== undefined) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (match !== null) {
      const bearer = match[1]?.trim() ?? '';
      return bearer.length > 0 ? bearer : null;
    }
  }

  return null;
}

function digestToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function tokensMatch(expectedDigest: Buffer, provided: string | null): boolean {
  if (provided === null) {
    return false;
  }
  return timingSafeEqual(expectedDigest, digestToken(provided));
}

function readHostname(hostHeader: string | undefined): string | null {
  if (hostHeader === undefined) {
    return null;
  }

  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    return end > 1 ? normalizeHostname(trimmed.slice(1, end)) : null;
  }

  const colon = trimmed.lastIndexOf(':');
  return normalizeHostname(colon === -1 ? trimmed : trimmed.slice(0, colon));
}

function isSameOrigin(request: Request): boolean {
  const origin = request.get('origin');
  if (origin === undefined) {
    return true;
  }
  if (origin === 'null') {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const requestHost = request.get('host')?.trim().toLowerCase();
  return requestHost !== undefined && parsed.host.toLowerCase() === requestHost;
}

function createAuthFailureLimiter(): {
  isLimited(ip: string, now: number): boolean;
  recordFailure(ip: string, now: number): void;
  clear(ip: string): void;
} {
  const windowMs = 60_000;
  const limit = 10;
  const maxTrackedIps = 10_000;
  const failures = new Map<string, number[]>();

  const recentFailures = (ip: string, now: number): number[] => {
    const entries = failures.get(ip);
    if (entries === undefined) {
      return [];
    }
    const recent = entries.filter((timestamp) => now - timestamp < windowMs);
    if (recent.length === 0) {
      failures.delete(ip);
    } else {
      failures.set(ip, recent);
    }
    return recent;
  };

  return {
    isLimited: (ip, now) => recentFailures(ip, now).length >= limit,
    recordFailure: (ip, now) => {
      const recent = recentFailures(ip, now);
      recent.push(now);
      if (!failures.has(ip) && failures.size >= maxTrackedIps) {
        const oldestIp = failures.keys().next().value;
        if (oldestIp !== undefined) {
          failures.delete(oldestIp);
        }
      }
      failures.set(ip, recent);
    },
    clear: (ip) => {
      failures.delete(ip);
    },
  };
}

function readAdminCommand(body: unknown): AdminCommand | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const rawCommand = record.command;
  if (typeof rawCommand !== 'string') {
    return null;
  }
  const command = rawCommand.trim();
  if (command.length === 0 || command.length > 64) {
    return null;
  }

  const rawArgs = record.args;
  if (rawArgs === undefined) {
    return { command, args: [] };
  }
  if (!Array.isArray(rawArgs) || rawArgs.length > 16) {
    return null;
  }

  const args: string[] = [];
  for (const arg of rawArgs) {
    if (typeof arg !== 'string' || arg.length > 256) {
      return null;
    }
    args.push(arg);
  }

  return { command, args };
}

function logAdminAddress(port: number, host: string): void {
  const boundHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const displayHost =
    boundHost.startsWith('[') || !boundHost.includes(':') ? boundHost : `[${boundHost}]`;
  logger.info(`Admin panel: http://${displayHost}:${port}`);

  if (host === '0.0.0.0' || host === '::') {
    for (const { address, interfaceName } of getLanAddresses()) {
      logger.info(`Admin panel (LAN): http://${address}:${port} (${interfaceName})`);
    }
  }
}

export function createAdminServer(
  gameServer: GameServer,
  options: AdminServerOptions = {},
): AdminServer {
  const app = express();
  app.disable('x-powered-by');

  const expectedToken = options.token?.trim() || null;
  if (expectedToken !== null && expectedToken.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new Error(`ADMIN_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters`);
  }
  const expectedTokenDigest = expectedToken === null ? null : digestToken(expectedToken);
  const authFailures = createAuthFailureLimiter();

  app.use((_request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  app.use((request, response, next) => {
    const host = readHostname(request.get('host'));
    if (host === null || (expectedTokenDigest === null && !isLoopbackHost(host))) {
      response.status(403).json({ error: 'Forbidden host' });
      return;
    }
    if (!isSameOrigin(request)) {
      response.status(403).json({ error: 'Forbidden origin' });
      return;
    }
    next();
  });

  // Authenticate before parsing JSON so unauthenticated clients cannot make
  // the server read a request body.
  app.use('/api', (request, response, next) => {
    if (expectedTokenDigest === null) {
      next();
      return;
    }

    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    if (authFailures.isLimited(ip, now)) {
      response.status(429).json({
        error: 'Слишком много неудачных попыток',
        authRequired: true,
      });
      return;
    }

    if (!tokensMatch(expectedTokenDigest, readProvidedToken(request))) {
      authFailures.recordFailure(ip, now);
      logger.warn('Rejected admin token', { ip });
      response.status(401).json({
        error: 'Требуется токен администратора',
        authRequired: true,
      });
      return;
    }

    authFailures.clear(ip);
    next();
  });

  app.use(express.json({ limit: '8kb' }));

  app.get('/', (_request, response) => {
    response.type('html').send(ADMIN_PAGE);
  });

  app.get('/favicon.ico', (_request, response) => {
    response.status(204).end();
  });

  app.get('/api/state', (_request, response) => {
    response.json(getAdminState(gameServer));
  });

  app.post('/api/command', (request, response) => {
    const command = readAdminCommand(request.body);
    if (command === null) {
      response.status(400).json({ error: 'Некорректная команда' });
      return;
    }

    let result: AdminCommandResult;
    try {
      result = executeAdminCommand(gameServer, command);
    } catch (error) {
      logger.error('Admin command failed', { command: command.command, error });
      response.status(500).json({ error: 'Команда не выполнена' });
      return;
    }

    logger.info('Admin command', {
      command: command.command,
      argCount: command.args.length,
      ip: request.ip ?? request.socket.remoteAddress ?? 'unknown',
    });

    if (result.shutdown) {
      let shutdownScheduled = false;
      const scheduleShutdown = (): void => {
        if (shutdownScheduled) {
          return;
        }
        shutdownScheduled = true;
        setTimeout(() => options.onQuit?.(), 50);
      };
      response.once('finish', scheduleShutdown);
      response.once('close', scheduleShutdown);
    }
    response.json(result);
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : 500;
    const httpStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;

    if (httpStatus < 500) {
      response.status(httpStatus).json({
        error: httpStatus === 413 ? 'Слишком большое тело запроса' : 'Некорректный запрос',
      });
      return;
    }

    logger.error('Admin request failed', { error });
    response.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);

  const httpServer = createHttpServer(app);
  httpServer.headersTimeout = 10_000;
  httpServer.requestTimeout = 15_000;
  httpServer.keepAliveTimeout = 5_000;
  httpServer.maxConnections = 100;
  let closed = false;

  return {
    listen: (port, host) => {
      if (expectedToken === null && !isLoopbackHost(host)) {
        return Promise.reject(new Error('ADMIN_TOKEN is required when ADMIN_HOST is not loopback'));
      }

      return new Promise<number>((resolve, reject) => {
        const onError = (error: Error): void => {
          httpServer.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          httpServer.off('error', onError);
          const address = httpServer.address();
          const actualPort = typeof address === 'object' && address !== null ? address.port : port;
          logAdminAddress(actualPort, host);
          if (expectedToken !== null) {
            logger.info('Admin panel requires ADMIN_TOKEN');
          }
          resolve(actualPort);
        };

        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port, host);
      });
    },
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;

      if (!httpServer.listening) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
        httpServer.closeAllConnections();
      });
    },
  };
}
