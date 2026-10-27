import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connect, getCollections } from './db.js';
import { PortalClient } from './portal/client.js';
import { CatalogService } from './services/catalog.js';
import { ReadingsService } from './services/readings.js';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // No .env file: rely on the real environment.
}

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const config = loadConfig();

const { client, db } = await connect(config.mongoUri);
const col = await getCollections(db);
const portal = new PortalClient({ ...config.portal, log });
const catalog = new CatalogService(col, portal, config.catalogTtlSeconds * 1000, log);
const readings = new ReadingsService(col, portal, config.readingsTtlSeconds * 1000);

const app = createApp({ col, catalog, readings, log });
const server = app.listen(config.port, () => {
  log(`Urja Meter API on http://localhost:${config.port}  (docs: /api/docs)`);
});

// Warm the catalogue at startup so the first request is fast, then keep it fresh even when idle.
// Failures are recorded and reported by /api/health; the last good copy keeps being served.
catalog.ensureFresh().catch(() => undefined);
setInterval(() => catalog.ensureFresh().catch(() => undefined), config.catalogTtlSeconds * 1000).unref();

const shutdown = () => server.close(() => client.close().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
