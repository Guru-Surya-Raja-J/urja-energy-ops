import { Router } from 'express';
import { resolveRange } from '../../domain/readings.js';
import { notFound, parse } from '../errors.js';
import { RangeQuery, TransformerListQuery, TransformerParams } from '../schemas.js';
import { toApiMeter } from '../toApiMeter.js';

const countIf = (status) => ({ $sum: { $cond: [{ $eq: ['$status', status] }, 1, 0] } });
const round2 = (n) => Math.round(n * 100) / 100;

/** Meter count, status counts and network path per transformer code. */
async function rollups(col, transformerCodes) {
  const rows = await col.meters
    .aggregate([
      ...(transformerCodes ? [{ $match: { transformerCode: { $in: transformerCodes } } }] : []),
      {
        $group: {
          _id: '$transformerCode',
          meterCount: { $sum: 1 },
          installed: countIf('installed'),
          faulty: countIf('faulty'),
          decommissioned: countIf('decommissioned'),
          network: { $first: '$network' },
        },
      },
    ])
    .toArray();
  return new Map(rows.map((r) => [r._id, r]));
}

function shape(t, r) {
  return {
    code: t.code,
    name: t.name,
    feederCode: t.feederCode,
    capacityKva: t.capacityKva,
    meterCount: r?.meterCount ?? 0,
    statusCounts: { installed: r?.installed ?? 0, faulty: r?.faulty ?? 0, decommissioned: r?.decommissioned ?? 0 },
    network: r?.network ?? null,
  };
}

export function transformersRouter({ col, catalog, readings }) {
  const router = Router();

  async function findTransformer(code) {
    await catalog.ensureFresh();
    const t = await col.transformers.findOne({ _id: code });
    if (!t) throw notFound(`No transformer with code ${code}`);
    return t;
  }

  router.get('/', async (req, res) => {
    const { feeder } = parse(TransformerListQuery, req.query);
    await catalog.ensureFresh();
    const [transformers, byCode] = await Promise.all([
      col.transformers.find(feeder ? { feederCode: feeder } : {}).sort({ _id: 1 }).toArray(),
      rollups(col),
    ]);
    res.json({ data: transformers.map((t) => shape(t, byCode.get(t.code))), total: transformers.length });
  });

  router.get('/:code', async (req, res) => {
    const { code } = parse(TransformerParams, req.params);
    const t = await findTransformer(code);
    const [byCode, meters] = await Promise.all([rollups(col, [code]), col.meters.find({ transformerCode: code }).sort({ _id: 1 }).toArray()]);
    res.json({ ...shape(t, byCode.get(code)), meters: meters.map(toApiMeter) });
  });

  /**
   * Daily load on a transformer, summed from its meters. The portal has no such view; this
   * costs one portal call per meter (cached), so ~10-13 calls for a typical transformer.
   */
  router.get('/:code/load', async (req, res) => {
    const { code } = parse(TransformerParams, req.params);
    const { from, to } = parse(RangeQuery, req.query);
    const t = await findTransformer(code);
    const meters = await col.meters.find({ transformerCode: code }).sort({ _id: 1 }).toArray();
    const range = resolveRange(from, to);

    const warnings = [];
    const days = new Map();
    const perMeter = [];

    // Three at a time: the shared rate limiter in the portal client does the real pacing.
    const queue = [...meters];
    const worker = async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        try {
          const r = await readings.get(m.meterId, range);
          let total = 0;
          for (const d of r.days) {
            const day = days.get(d.date) ?? { kwh: 0, kvah: 0, metersReporting: 0, allComplete: true };
            day.kwh += d.kwh;
            day.kvah += d.kvah;
            day.metersReporting++;
            day.allComplete &&= d.complete;
            days.set(d.date, day);
            total += d.kwh;
          }
          perMeter.push({ meterId: m.meterId, status: m.status, interval: r.interval, kwh: Math.round(total * 1000) / 1000 });
          if (r.stale) warnings.push(`${m.meterId}: served from an older cached copy.`);
        } catch (err) {
          warnings.push(`${m.meterId}: readings unavailable (${err.message}).`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    if (meters.length > 0 && perMeter.length === 0) throw new Error(`Could not load readings for any meter on ${code}`);
    const decommissioned = perMeter.filter((m) => m.status === 'decommissioned' && m.kwh > 0).length;
    if (decommissioned) warnings.push(`${decommissioned} decommissioned meter(s) still report consumption and are included.`);

    res.json({
      transformerCode: t.code,
      capacityKva: t.capacityKva,
      days: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({
          date,
          kwh: round2(d.kwh),
          kvah: round2(d.kvah),
          avgKva: round2(d.kvah / 24),
          utilizationPct: round2((d.kvah / 24 / t.capacityKva) * 100),
          metersReporting: d.metersReporting,
          complete: d.allComplete && d.metersReporting === meters.length,
        })),
      meters: perMeter.sort((a, b) => a.meterId.localeCompare(b.meterId)),
      warnings,
    });
  });

  return router;
}
