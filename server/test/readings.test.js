import { describe, expect, it } from 'vitest';
import { dailyConsumption, detectInterval, normalizeReadings, parsePortalTimestamp, resolveRange, summarize } from '../src/domain/readings.js';
import { rawReadings } from './fixtures.js';

describe('parsePortalTimestamp', () => {
  it('turns DD/MM/YYYY HH:mm into ISO with the IST offset', () => {
    expect(parsePortalTimestamp('23/06/2026 23:30')).toBe('2026-06-23T23:30:00+05:30');
  });
  it('rejects anything else', () => {
    expect(parsePortalTimestamp('2026-06-23 23:30')).toBeNull();
  });
});

describe('normalizeReadings', () => {
  it('parses numbers and keeps the complete row when a timestamp is duplicated', () => {
    // Real portal quirk: a trailing copy of the last row with kWh and voltage blanked out.
    const { readings, dropped } = normalizeReadings([
      { timestamp: '29/06/2026 00:00', kwh: '12724.7', kvah: '13742.67', voltR: '232' },
      { timestamp: '30/06/2026 00:00', kwh: '12732.34', kvah: '13750.93', voltR: '229' },
      { timestamp: '30/06/2026 00:00', kwh: '', kvah: '13750.93', voltR: '' },
    ]);
    expect(readings).toHaveLength(2);
    expect(readings[1]).toEqual({ timestamp: '2026-06-30T00:00:00+05:30', kwh: 12732.34, kvah: 13750.93, voltageR: 229 });
    expect(dropped).toEqual([{ timestamp: '2026-06-30T00:00:00+05:30', reason: expect.stringContaining('duplicate') }]);
  });

  it('sorts readings and drops unparseable timestamps', () => {
    const { readings, dropped } = normalizeReadings([
      { timestamp: '02/06/2026 00:00', kwh: '2', kvah: '2', voltR: '230' },
      { timestamp: 'garbage', kwh: '1', kvah: '1', voltR: '230' },
      { timestamp: '01/06/2026 00:00', kwh: '1', kvah: '1', voltR: '230' },
    ]);
    expect(readings.map((r) => r.kwh)).toEqual([1, 2]);
    expect(dropped[0].reason).toBe('unparseable timestamp');
  });
});

describe('daily consumption', () => {
  it('gives the same per-day totals for half-hourly and daily meters', () => {
    const half = normalizeReadings(rawReadings({ days: 3, stepMinutes: 30, perStep: 0.5 })).readings;
    const daily = normalizeReadings(rawReadings({ days: 3, stepMinutes: 1440, perStep: 24 })).readings;
    expect(detectInterval(half)).toBe('PT30M');
    expect(detectInterval(daily)).toBe('P1D');

    const a = dailyConsumption(half, 'PT30M').days.map((d) => [d.date, d.kwh, d.complete]);
    const b = dailyConsumption(daily, 'P1D').days.map((d) => [d.date, d.kwh, d.complete]);
    expect(a).toEqual([
      ['2026-06-01', 24, true],
      ['2026-06-02', 24, true],
      ['2026-06-03', 24, true],
    ]);
    expect(b).toEqual(a);
  });

  it('marks a partial last day as incomplete and excludes it from the daily average', () => {
    const rows = rawReadings({ days: 2, stepMinutes: 30, perStep: 0.5 }).slice(0, -1); // ends 02/06 23:30
    const readings = normalizeReadings(rows).readings;
    const { days } = dailyConsumption(readings, 'PT30M');
    expect(days[1]).toMatchObject({ date: '2026-06-02', intervals: 47, complete: false });
    const summary = summarize(readings, days);
    expect(summary.avgDailyKwh).toBe(24);
    expect(summary.powerFactor).toBeCloseTo(1 / 1.08, 3);
  });

  it('ignores intervals where the register goes backwards', () => {
    const readings = normalizeReadings([
      { timestamp: '01/06/2026 00:00', kwh: '100', kvah: '108', voltR: '230' },
      { timestamp: '02/06/2026 00:00', kwh: '90', kvah: '97', voltR: '230' },
      { timestamp: '03/06/2026 00:00', kwh: '110', kvah: '119', voltR: '230' },
    ]).readings;
    const r = dailyConsumption(readings, 'P1D');
    expect(r.negativeDeltas).toBe(1);
    expect(r.days).toEqual([expect.objectContaining({ date: '2026-06-02', kwh: 20 })]);
  });
});

describe('resolveRange', () => {
  it('anchors a 7-day window on whichever bound is given', () => {
    expect(resolveRange('2026-06-01')).toEqual({ from: '2026-06-01', to: '2026-06-07' });
    expect(resolveRange(undefined, '2026-06-30')).toEqual({ from: '2026-06-24', to: '2026-06-30' });
    expect(resolveRange()).toEqual({});
  });
  it('rejects inverted or oversized windows', () => {
    expect(() => resolveRange('2026-06-30', '2026-06-01')).toThrow(RangeError);
    expect(() => resolveRange('2024-01-01', '2026-01-01')).toThrow(/366/);
  });
});
