import { Router } from 'express';
import { LEVELS } from '../../domain/levels.js';
import { resolveRange, summarize } from '../../domain/readings.js';
import { notFound, parse } from '../errors.js';
import { MeterIdParams, MeterListQuery, RangeQuery } from '../schemas.js';
import { toApiMeter } from '../toApiMeter.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const list = (s) => s.split(',').map((v) => v.trim()).filter(Boolean);

/** Turn validated query params into a Mongo filter. */
function buildFilter(q) {
  const filter = {};
  if (q.q) filter.searchText = { $regex: escapeRegex(q.q.toLowerCase()) };
  if (q.status) filter.status = { $in: list(q.status.toLowerCase()) };
  if (q.make) filter.make = { $in: list(q.make).map((m) => new RegExp(`^${escapeRegex(m)}$`, 'i')) };
  if (q.phase) filter.phase = q.phase;
  if (q.installationType) filter.installationType = q.installationType;
  for (const level of LEVELS) {
    if (q[level]) filter[`network.${level}.code`] = q[level];
  }
  return filter;
}

export function metersRouter({ col, catalog, readings }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const q = parse(MeterListQuery, req.query);
    await catalog.ensureFresh();
    const filter = buildFilter(q);
    const skip = (q.page - 1) * q.pageSize;

    let docs;
    let total;
    if (q.near) {
      const [lat, lng] = q.near.split(',').map(Number);
      const [result] = await col.meters
        .aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [lng, lat] },
              distanceField: 'distanceM',
              spherical: true,
              query: filter,
              ...(q.radiusKm ? { maxDistance: q.radiusKm * 1000 } : {}),
            },
          },
          { $facet: { data: [{ $skip: skip }, { $limit: q.pageSize }], total: [{ $count: 'n' }] } },
        ])
        .toArray();
      docs = result?.data ?? [];
      total = result?.total[0]?.n ?? 0;
    } else {
      [docs, total] = await Promise.all([
        col.meters.find(filter).sort({ _id: 1 }).skip(skip).limit(q.pageSize).toArray(),
        col.meters.countDocuments(filter),
      ]);
    }
    res.json({ data: docs.map(toApiMeter), page: q.page, pageSize: q.pageSize, total });
  });

  async function findMeter(meterId) {
    await catalog.ensureFresh();
    const doc = await col.meters.findOne({ _id: meterId });
    if (!doc) throw notFound(`No meter with ID ${meterId} (IDs are case-sensitive)`);
    return doc;
  }

  router.get('/:meterId', async (req, res) => {
    const { meterId } = parse(MeterIdParams, req.params);
    res.json(toApiMeter(await findMeter(meterId)));
  });

  router.get('/:meterId/readings', async (req, res) => {
    const { meterId } = parse(MeterIdParams, req.params);
    const { from, to } = parse(RangeQuery, req.query);
    await findMeter(meterId);
    const r = await readings.get(meterId, resolveRange(from, to));
    res.json({
      meterId,
      interval: r.interval,
      fetchedAt: r.fetchedAt.toISOString(),
      stale: r.stale,
      readings: r.readings,
      dropped: r.dropped,
    });
  });

  router.get('/:meterId/consumption', async (req, res) => {
    const { meterId } = parse(MeterIdParams, req.params);
    const { from, to } = parse(RangeQuery, req.query);
    const meter = await findMeter(meterId);
    const r = await readings.get(meterId, resolveRange(from, to));
    const summary = summarize(r.readings, r.days);

    const warnings = [];
    if (r.readings.length === 0) warnings.push('No readings in this window.');
    if (r.dropped.length) warnings.push(`${r.dropped.length} portal row(s) discarded: ${[...new Set(r.dropped.map((d) => d.reason))].join(', ')}.`);
    if (r.negativeDeltas) warnings.push(`${r.negativeDeltas} interval(s) where the register went backwards were ignored.`);
    if (r.interval === 'irregular') warnings.push('Readings are irregularly spaced.');
    if (meter.status === 'decommissioned' && summary.totalKwh > 0) {
      warnings.push('Meter is marked decommissioned but its register is still advancing.');
    }
    if (r.stale) warnings.push('Portal unavailable; serving an older cached copy.');

    res.json({
      meterId,
      status: meter.status,
      interval: r.interval,
      fetchedAt: r.fetchedAt.toISOString(),
      stale: r.stale,
      days: r.days,
      summary,
      warnings,
    });
  });

  return router;
}
