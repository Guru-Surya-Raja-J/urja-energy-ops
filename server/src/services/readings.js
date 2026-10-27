import { dailyConsumption, detectInterval, normalizeReadings } from '../domain/readings.js';
import { PortalError } from '../portal/client.js';

/**
 * Per-meter reading windows, fetched on demand and cached in Mongo.
 *
 * Readings aren't in the bulk export, so each window costs one portal call. The cache keeps
 * us well inside the portal's ~120 req/min limit. If the portal fails, an expired cached copy
 * is served with `stale: true` rather than an error.
 */
export class ReadingsService {
  #inFlight = new Map();

  constructor(col, portal, ttlMs, now = Date.now) {
    this.col = col;
    this.portal = portal;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  /** Returns { meterId, fetchedAt, interval, readings, dropped, days, negativeDeltas, stale }. */
  get(meterId, range) {
    const key = `${meterId}|${range.from ?? ''}|${range.to ?? ''}`;
    let pending = this.#inFlight.get(key);
    if (!pending) {
      pending = this.#load(key, meterId, range).finally(() => this.#inFlight.delete(key));
      this.#inFlight.set(key, pending);
    }
    return pending;
  }

  async #load(key, meterId, range) {
    const cached = await this.col.readings.findOne({ _id: key });
    if (cached && this.now() - cached.fetchedAt.getTime() < this.ttlMs) return strip(cached, false);

    let raw;
    try {
      raw = await this.portal.getReadings(meterId, range);
    } catch (err) {
      if (cached && err instanceof PortalError && err.code !== 'not_found') return strip(cached, true);
      throw err;
    }
    const { readings, dropped } = normalizeReadings(raw);
    const interval = detectInterval(readings);
    const { days, negativeDeltas } = dailyConsumption(readings, interval);
    const doc = { _id: key, meterId, fetchedAt: new Date(this.now()), interval, readings, dropped, days, negativeDeltas };
    await this.col.readings.replaceOne({ _id: key }, doc, { upsert: true });
    return strip(doc, false);
  }
}

function strip({ _id, ...rest }, stale) {
  return { ...rest, stale };
}
