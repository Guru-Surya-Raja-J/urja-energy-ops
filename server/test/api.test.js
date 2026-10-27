// End-to-end over HTTP: Express + a real (in-memory) MongoDB + a fake portal.
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as S from '../src/api/schemas.js';
import { createApp } from '../src/app.js';
import { getCollections } from '../src/db.js';
import { PortalError } from '../src/portal/client.js';
import { CatalogService } from '../src/services/catalog.js';
import { ReadingsService } from '../src/services/readings.js';
import { meters, rawReadings, transformers } from './fixtures.js';

let mongod = null;
let client;
let db;
let app;
let portalCalls = 0;

// A stand-in with the same three methods the services use.
const fakePortal = {
  exportMeters: async () => meters,
  listTransformers: async () => transformers,
  getReadings: async (meterId) => {
    portalCalls++;
    if (meterId === 'J100004') return rawReadings({ days: 3, stepMinutes: 1440, perStep: 30 });
    if (!meters.some((m) => m.meterId === meterId)) throw new PortalError('nope', 404, 'not_found');
    return rawReadings({ days: 3, stepMinutes: 30, perStep: 0.5 });
  },
};

// Set TEST_MONGODB_URI to use an existing MongoDB instead of downloading a test binary.
beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  }
  client = await MongoClient.connect(uri);
  db = client.db(`urja_test_${Date.now()}`);
  const col = await getCollections(db);
  const catalog = new CatalogService(col, fakePortal, 60_000);
  await catalog.sync();
  app = createApp({ col, catalog, readings: new ReadingsService(col, fakePortal, 60_000), log: () => {} });
}, 180_000);

afterAll(async () => {
  await db?.dropDatabase();
  await client?.close();
  await mongod?.stop();
});

const ids = (res) => res.body.data.map((m) => m.meterId);

describe('meters', () => {
  it('lists meters with pagination, matching the documented schema', async () => {
    const res = await request(app).get('/api/v1/meters?pageSize=2').expect(200);
    expect(S.MeterPage.parse(res.body)).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(ids(res)).toEqual(['J100000', 'J100001']);
  });

  it('combines filters the portal cannot (status + make, case-insensitive)', async () => {
    const res = await request(app).get('/api/v1/meters?status=faulty,decommissioned&make=l%26t').expect(200);
    expect(ids(res)).toEqual(['J100001']);
  });

  it('filters by network level and searches by substring', async () => {
    expect((await request(app).get('/api/v1/meters?zone=Z-02').expect(200)).body.total).toBe(1);
    expect(ids(await request(app).get('/api/v1/meters?q=00003').expect(200))).toEqual(['J100003']);
  });

  it('sorts by distance with `near` and honours radiusKm', async () => {
    const res = await request(app).get('/api/v1/meters?near=27.0,75.9&radiusKm=1').expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ meterId: 'J100004', distanceKm: 0 });
  });

  it('serves repaired network data on a meter', async () => {
    const res = await request(app).get('/api/v1/meters/J100001').expect(200);
    expect(S.Meter.parse(res.body).network.circle).toEqual({ code: 'C-01', name: 'Circle 1' });
  });

  it('returns problem+json for unknown meters and bad input', async () => {
    const missing = await request(app).get('/api/v1/meters/NOPE').expect(404);
    expect(missing.headers['content-type']).toMatch('application/problem+json');
    expect(S.Problem.parse(missing.body).status).toBe(404);

    const bad = await request(app).get('/api/v1/meters/J100000/readings?from=01/06/2026').expect(400);
    expect(bad.body.detail).toMatch(/from/);
    await request(app).get('/api/v1/meters/J100000/readings?from=2026-06-30&to=2026-06-01').expect(400);
  });
});

describe('readings and consumption', () => {
  it('returns typed readings and caches the window', async () => {
    const before = portalCalls;
    const url = '/api/v1/meters/J100000/readings?from=2026-06-01&to=2026-06-03';
    const body = S.ReadingsResponse.parse((await request(app).get(url).expect(200)).body);
    expect(body.interval).toBe('PT30M');
    expect(body.readings[0]).toEqual({ timestamp: '2026-06-01T00:00:00+05:30', kwh: 1000, kvah: 1080, voltageR: 230 });

    await request(app).get(url).expect(200);
    expect(portalCalls).toBe(before + 1);
  });

  it('flags decommissioned meters whose register still advances', async () => {
    const body = S.ConsumptionResponse.parse((await request(app).get('/api/v1/meters/J100002/consumption').expect(200)).body);
    expect(body.summary.avgDailyKwh).toBe(24);
    expect(body.warnings).toContainEqual(expect.stringMatching(/decommissioned/));
  });
});

describe('network', () => {
  it('lists transformers with meter counts', async () => {
    const res = await request(app).get('/api/v1/transformers').expect(200);
    const dt1 = S.TransformerList.parse(res.body).data.find((t) => t.code === 'DT-001');
    expect(dt1).toMatchObject({ meterCount: 4, statusCounts: { installed: 2, faulty: 1, decommissioned: 1 } });
  });

  it('sums daily load on a transformer', async () => {
    const res = await request(app).get('/api/v1/transformers/DT-002/load?from=2026-06-01&to=2026-06-03').expect(200);
    const body = S.TransformerLoad.parse(res.body);
    expect(body.days[0]).toMatchObject({ date: '2026-06-01', kwh: 30, metersReporting: 1 });
    expect(body.days[0].utilizationPct).toBeCloseTo(((30 * 1.08) / 24 / 63) * 100, 1);
  });

  it('serves the hierarchy tree and data issues', async () => {
    const tree = await request(app).get('/api/v1/hierarchy').expect(200);
    expect(tree.body.data.map((z) => z.id)).toEqual(['Z-01', 'Z-02']);
    const issues = await request(app).get('/api/v1/data-issues?type=missing_code').expect(200);
    expect(S.DataIssues.parse(issues.body).data).toHaveLength(1);
  });

  it('serves stats, health and the OpenAPI document', async () => {
    const stats = await request(app).get('/api/v1/stats').expect(200);
    expect(S.Stats.parse(stats.body).byStatus).toEqual({ decommissioned: 1, faulty: 1, installed: 3 });
    const health = await request(app).get('/api/health').expect(200);
    expect(S.Health.parse(health.body).status).toBe('ok');
    const doc = await request(app).get('/api/openapi.json').expect(200);
    expect(doc.body.openapi).toBe('3.0.3');
    expect(Object.keys(doc.body.paths)).toContain('/api/v1/meters/{meterId}/consumption');
  });
});
