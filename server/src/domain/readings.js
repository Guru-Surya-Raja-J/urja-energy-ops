/**
 * The portal prints wall-clock times with no zone. The utility is in Jaipur and the default
 * window ends at 23:30, so we read them as IST (UTC+05:30) — an assumption, see README.
 */
export const UTC_OFFSET = '+05:30';

const TIMESTAMP = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;

/** "23/06/2026 23:30" -> "2026-06-23T23:30:00+05:30" (null if it doesn't match). */
export function parsePortalTimestamp(s) {
  const m = TIMESTAMP.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00${UTC_OFFSET}`;
}

function num(s) {
  if (s === undefined || s === null || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const filled = (r) => [r.kwh, r.kvah, r.voltageR].filter((v) => v !== null).length;

/**
 * Portal rows ({timestamp, kwh, kvah, voltR}, all strings) -> sorted readings with numbers and
 * ISO timestamps. Duplicate timestamps keep the most complete row; discarded rows are returned
 * in `dropped` so the API can say what it threw away.
 */
export function normalizeReadings(raw) {
  const byTime = new Map();
  const dropped = [];
  for (const row of raw) {
    const timestamp = parsePortalTimestamp(row.timestamp);
    if (!timestamp) {
      dropped.push({ timestamp: row.timestamp, reason: 'unparseable timestamp' });
      continue;
    }
    const reading = { timestamp, kwh: num(row.kwh), kvah: num(row.kvah), voltageR: num(row.voltR) };
    const existing = byTime.get(timestamp);
    if (!existing) {
      byTime.set(timestamp, reading);
      continue;
    }
    byTime.set(timestamp, filled(reading) > filled(existing) ? reading : existing);
    dropped.push({ timestamp, reason: 'duplicate timestamp; kept the more complete row' });
  }
  const readings = [...byTime.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { readings, dropped };
}

const STEP_MS = { PT30M: 30 * 60_000, P1D: 86_400_000 };

/** Meters report either half-hourly or once a day (at 00:00); detect which from the median step. */
export function detectInterval(readings) {
  if (readings.length < 2) return 'unknown';
  const steps = readings.slice(1).map((r, i) => Date.parse(r.timestamp) - Date.parse(readings[i].timestamp));
  steps.sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)];
  if (median === STEP_MS.PT30M) return 'PT30M';
  if (median === STEP_MS.P1D) return 'P1D';
  return 'irregular';
}

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Turns cumulative registers into per-day consumption. Each delta between consecutive readings
 * is credited to the local date the interval started on, so a daily meter's 01/06 00:00 -> 02/06
 * 00:00 delta counts as 1 June, the same as the 48 half-hour deltas of a half-hourly meter.
 *
 * Returns { days: [{date, kwh, kvah, intervals, complete}], negativeDeltas }.
 */
export function dailyConsumption(readings, interval) {
  const valid = readings.filter((r) => r.kwh !== null && r.kvah !== null);
  const perDay = interval === 'PT30M' ? 48 : 1;
  const days = new Map();
  let negativeDeltas = 0;
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1];
    const b = valid[i];
    const dk = b.kwh - a.kwh;
    const dv = b.kvah - a.kvah;
    if (dk < 0 || dv < 0) {
      negativeDeltas++; // register went backwards: meter reset or bad data; don't count it
      continue;
    }
    const date = a.timestamp.slice(0, 10);
    const day = days.get(date) ?? { date, kwh: 0, kvah: 0, intervals: 0 };
    day.kwh += dk;
    day.kvah += dv;
    day.intervals++;
    days.set(date, day);
  }
  return {
    days: [...days.values()].map((d) => ({ ...d, kwh: round(d.kwh), kvah: round(d.kvah), complete: d.intervals >= perDay })),
    negativeDeltas,
  };
}

export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 366;

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Our window semantics, made explicit so we never rely on the portal's own defaults
 * (which differ by one reading depending on which bound you omit):
 *   both given -> as given; only one given -> a 7-day window anchored on it;
 *   neither -> {}, meaning "the portal's latest 7 days".
 */
export function resolveRange(from, to) {
  if (from && to) {
    if (from > to) throw new RangeError('`from` must be on or before `to`');
    const span = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    if (span > MAX_WINDOW_DAYS) throw new RangeError(`Window is limited to ${MAX_WINDOW_DAYS} days`);
    return { from, to };
  }
  if (from) return { from, to: addDays(from, DEFAULT_WINDOW_DAYS - 1) };
  if (to) return { from: addDays(to, -(DEFAULT_WINDOW_DAYS - 1)), to };
  return {};
}

/** Totals, mean over complete days, power factor and voltage range for a window. */
export function summarize(readings, days) {
  const totalKwh = round(days.reduce((s, d) => s + d.kwh, 0));
  const totalKvah = round(days.reduce((s, d) => s + d.kvah, 0));
  const complete = days.filter((d) => d.complete);
  const volts = readings.map((r) => r.voltageR).filter((v) => v !== null);
  return {
    readingCount: readings.length,
    firstReadingAt: readings[0]?.timestamp ?? null,
    lastReadingAt: readings.at(-1)?.timestamp ?? null,
    totalKwh,
    totalKvah,
    avgDailyKwh: complete.length ? round(complete.reduce((s, d) => s + d.kwh, 0) / complete.length) : null,
    powerFactor: totalKvah > 0 ? round(totalKwh / totalKvah) : null,
    voltageR: volts.length
      ? { min: Math.min(...volts), max: Math.max(...volts), avg: round(volts.reduce((s, v) => s + v, 0) / volts.length) }
      : null,
  };
}
