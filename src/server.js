'use strict';

const createApp = require('./app');
const logger = require('./logger');
const { setReady } = require('./routes/health');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000);

const app = createApp();
const server = app.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST }, 'server_started');
  // Simulate startup readiness; flip to ready once listening.
  setReady(true);
});

// Graceful shutdown for rolling deployments / SIGTERM from K8s.
function shutdown(signal) {
  logger.info({ signal }, 'shutdown_initiated');
  setReady(false);

  const forceExit = setTimeout(() => {
    logger.error('shutdown_forced_timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'shutdown_error');
      process.exit(1);
    }
    logger.info('shutdown_complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled_rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught_exception');
  shutdown('uncaughtException');
});

module.exports = server;
