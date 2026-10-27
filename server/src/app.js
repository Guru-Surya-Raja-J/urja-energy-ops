import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { errorHandler, notFound } from './api/errors.js';
import { buildOpenApiDocument } from './api/openapi.js';
import { metaRouter } from './api/routes/meta.js';
import { metersRouter } from './api/routes/meters.js';
import { transformersRouter } from './api/routes/transformers.js';

const CLIENT_DIST = path.resolve(import.meta.dirname, '../../client/dist');

/**
 * @param {{ col: object, catalog: import('./services/catalog.js').CatalogService,
 *           readings: import('./services/readings.js').ReadingsService, log: (msg: string) => void }} deps
 */
export function createApp(deps) {
  const app = express();
  app.disable('x-powered-by');
  const openapi = buildOpenApiDocument();

  app.get('/api/health', async (_req, res) => {
    const catalog = await deps.catalog.status();
    res.json({ status: catalog.lastError || catalog.stale ? 'degraded' : 'ok', catalog });
  });
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Urja Meter API' }));

  app.use('/api/v1/meters', metersRouter(deps));
  app.use('/api/v1/transformers', transformersRouter(deps));
  app.use('/api/v1', metaRouter(deps));
  app.use('/api', (req, _res, next) => next(notFound(`No route for ${req.method} ${req.originalUrl}`)));

  // In production the React client is served from the same origin; in dev Vite proxies /api here.
  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  app.use(errorHandler(deps.log));
  return app;
}
