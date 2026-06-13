'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');

const logger = require('./logger');
const { register, metricsMiddleware } = require('./middleware/metrics');
const infoRoutes = require('./routes/info');
const { router: healthRoutes } = require('./routes/health');

function createApp() {
  const app = express();

  // Trust the first proxy hop (Traefik / ingress) for correct client IPs.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers, including a strict Content-Security-Policy.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    })
  );

  app.use(compression());
  app.use(express.json({ limit: '10kb' }));

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
      },
    })
  );

  // Rate limit only the API surface, not health/metrics scraping.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 100),
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter);
  app.use(metricsMiddleware);

  // Static UI.
  app.use(
    express.static(path.join(__dirname, 'public'), {
      maxAge: '1h',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    })
  );

  // Routes.
  app.use('/', infoRoutes);
  app.use('/', healthRoutes);

  // Prometheus scrape endpoint.
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // 404 handler.
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  // Central error handler — never leak stack traces to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err }, 'unhandled_error');
    res.status(500).json({ error: 'internal_server_error' });
  });

  return app;
}

module.exports = createApp;
