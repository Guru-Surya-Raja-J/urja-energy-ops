import { Router } from 'express';
import { parse } from '../errors.js';
import { DataIssuesQuery } from '../schemas.js';

export function metaRouter({ col, catalog }) {
  const router = Router();

  async function catalogState() {
    await catalog.ensureFresh();
    return col.state.findOne({ _id: 'catalog' });
  }

  router.get('/hierarchy', async (_req, res) => {
    const state = await catalogState();
    res.json({ data: state?.hierarchy ?? [] });
  });

  router.get('/data-issues', async (req, res) => {
    const { type } = parse(DataIssuesQuery, req.query);
    const all = (await catalogState())?.issues ?? [];
    const byType = {};
    for (const i of all) byType[i.type] = (byType[i.type] ?? 0) + 1;
    const data = type ? all.filter((i) => i.type === type) : all;
    res.json({ total: data.length, byType, data });
  });

  router.get('/stats', async (_req, res) => {
    const state = await catalogState();
    const by = (field) => [{ $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $sort: { _id: 1 } }];
    const [facets] = await col.meters
      .aggregate([
        {
          $facet: {
            byStatus: by('status'),
            byMake: by('make'),
            byPhase: by('phase'),
            byInstallationType: by('installationType'),
            byZone: by('network.zone.code'),
          },
        },
      ])
      .toArray();
    const flat = (rows = []) => Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.n]));
    res.json({
      meters: state?.meterCount ?? 0,
      transformers: state?.transformerCount ?? 0,
      syncedAt: state?.syncedAt.toISOString() ?? null,
      byStatus: flat(facets?.byStatus),
      byMake: flat(facets?.byMake),
      byPhase: flat(facets?.byPhase),
      byInstallationType: flat(facets?.byInstallationType),
      byZone: flat(facets?.byZone),
    });
  });

  return router;
}
