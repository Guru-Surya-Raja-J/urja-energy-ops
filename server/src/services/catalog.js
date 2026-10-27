import { randomUUID } from 'node:crypto';
import { toMeter } from '../domain/meters.js';
import { buildHierarchy, repairNetwork } from '../domain/network.js';

/**
 * Keeps a local copy of the meter + transformer catalogue in MongoDB.
 *
 * A full sync is 3 portal calls (one signed bulk export + two transformer pages), so we pull
 * everything rather than per-meter pages. Reads are served from Mongo; when the copy is older
 * than the TTL we refresh in the background and keep serving the old copy meanwhile.
 */
export class CatalogService {
  #inFlight = null;
  #lastError = null;

  constructor(col, portal, ttlMs, log = () => {}, now = Date.now) {
    this.col = col;
    this.portal = portal;
    this.ttlMs = ttlMs;
    this.log = log;
    this.now = now;
  }

  /** Blocks only when there is no copy at all; otherwise kicks off a background refresh if stale. */
  async ensureFresh() {
    const state = await this.col.state.findOne({ _id: 'catalog' }, { projection: { syncedAt: 1 } });
    if (!state) return this.sync();
    if (this.now() - state.syncedAt.getTime() > this.ttlMs) {
      this.sync().catch(() => undefined); // recorded in lastError and surfaced by /api/health
    }
  }

  /** Single-flight full re-sync. */
  sync() {
    this.#inFlight ??= this.#doSync()
      .then(() => {
        this.#lastError = null;
      })
      .catch((err) => {
        this.#lastError = err.message;
        this.log(`catalog sync failed: ${err.message}`);
        throw err;
      })
      .finally(() => {
        this.#inFlight = null;
      });
    return this.#inFlight;
  }

  async status() {
    const state = await this.col.state.findOne({ _id: 'catalog' }, { projection: { syncedAt: 1 } });
    const age = state ? Math.round((this.now() - state.syncedAt.getTime()) / 1000) : null;
    return {
      syncedAt: state?.syncedAt.toISOString() ?? null,
      ageSeconds: age,
      stale: age === null || age * 1000 > this.ttlMs,
      syncing: this.#inFlight !== null,
      lastError: this.#lastError,
    };
  }

  async #doSync() {
    const started = this.now();
    const [rawMeters, rawTransformers] = await Promise.all([this.portal.exportMeters(), this.portal.listTransformers()]);
    const { paths, issues } = repairNetwork(rawMeters, rawTransformers);
    const meters = rawMeters.map((raw) => toMeter(raw, paths.get(raw.meterId)));
    const syncId = randomUUID();

    const meterDocs = meters.map((m) => ({
      ...m,
      _id: m.meterId,
      geo: { type: 'Point', coordinates: [m.location.lng, m.location.lat] },
      searchText: `${m.meterId} ${m.serialNo}`.toLowerCase(),
      syncId,
    }));
    const transformerDocs = rawTransformers.map((t) => ({ ...t, _id: t.code, syncId }));
    const upsertAll = (docs) => docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } }));

    // Upsert everything tagged with this sync, then delete whatever the portal no longer has.
    await this.col.meters.bulkWrite(upsertAll(meterDocs));
    await this.col.meters.deleteMany({ syncId: { $ne: syncId } });
    await this.col.transformers.bulkWrite(upsertAll(transformerDocs));
    await this.col.transformers.deleteMany({ syncId: { $ne: syncId } });
    await this.col.state.replaceOne(
      { _id: 'catalog' },
      {
        syncId,
        syncedAt: new Date(this.now()),
        meterCount: meters.length,
        transformerCount: rawTransformers.length,
        hierarchy: buildHierarchy(meters),
        issues,
      },
      { upsert: true },
    );
    this.log(`catalog synced: ${meters.length} meters, ${rawTransformers.length} transformers, ${issues.length} issues in ${this.now() - started}ms`);
  }
}
