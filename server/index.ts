import { createAdminServer, MIN_ADMIN_TOKEN_LENGTH, type AdminServer } from './adminServer';
import { logger } from './logger';
import { isLoopbackHost } from './network';
import { createGameServer } from './server';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_ADMIN_PORT = 3001;
const DEFAULT_ADMIN_HOST = '127.0.0.1';

function parsePort(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }
  return port;
}

async function main(): Promise<void> {
  const port = parsePort(process.env.PORT, DEFAULT_PORT, 'PORT');
  const host = process.env.HOST?.trim() || DEFAULT_HOST;
  const adminPort = parsePort(process.env.ADMIN_PORT, DEFAULT_ADMIN_PORT, 'ADMIN_PORT');
  const adminHost = process.env.ADMIN_HOST?.trim() || DEFAULT_ADMIN_HOST;
  const adminToken = process.env.ADMIN_TOKEN?.trim() || undefined;

  if (adminPort === port) {
    throw new Error('ADMIN_PORT must be different from PORT');
  }
  if (adminToken !== undefined && adminToken.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new Error(`ADMIN_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters`);
  }
  if (!isLoopbackHost(adminHost) && adminToken === undefined) {
    throw new Error('ADMIN_TOKEN is required when ADMIN_HOST is not loopback');
  }

  const production = process.env.NODE_ENV === 'production' || import.meta.url.includes('/dist/');
  const server = await createGameServer({ production });

  let adminServer: AdminServer | null = null;
  let adminReady = false;
  let gameReady = false;
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down...`);

    let failed = false;
    if (adminReady) {
      try {
        await adminServer?.close();
      } catch (error) {
        failed = true;
        logger.error('Admin panel shutdown failed', { error });
      }
    }

    if (gameReady) {
      try {
        await server.close();
        logger.info('Server stopped');
      } catch (error) {
        failed = true;
        logger.error('Graceful shutdown failed', { error });
      }
    }
    process.exitCode = failed ? 1 : 0;
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await server.listen(port, host);
    gameReady = true;
    if (shuttingDown) {
      await server.close();
      return;
    }

    adminServer = createAdminServer(server, {
      token: adminToken,
      onQuit: () => {
        void shutdown('admin');
      },
    });
    await adminServer.listen(adminPort, adminHost);
    adminReady = true;
    if (shuttingDown) {
      await adminServer.close();
      await server.close();
      return;
    }
  } catch (error) {
    try {
      await adminServer?.close();
    } catch (closeError) {
      logger.error('Admin panel cleanup failed', { error: closeError });
    }
    try {
      await server.close();
    } catch (closeError) {
      logger.error('Game server cleanup failed', { error: closeError });
    }
    throw error;
  }
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

main().catch((error: unknown) => {
  logger.error('Fatal startup error', { error });
  process.exitCode = 1;
});
