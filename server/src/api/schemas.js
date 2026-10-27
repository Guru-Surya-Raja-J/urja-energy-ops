// Zod schemas: used to validate requests, to generate openapi.json, and in the HTTP tests
// to check every response matches what we document.
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { LEVELS } from '../domain/levels.js';

extendZodWithOpenApi(z);

// ---------- shared ----------

export const MeterStatus = z.enum(['installed', 'faulty', 'decommissioned']).openapi('MeterStatus');
export const Phase = z.enum(['single', 'three']).openapi('Phase');
export const InstallationType = z.enum(['whole_current', 'ct_operated']).openapi('InstallationType');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Not a real date');

export const NetworkNode = z
  .object({ code: z.string().nullable(), name: z.string().nullable() })
  .openapi('NetworkNode', { example: { code: 'F-001', name: 'Feeder 1' } });

export const NetworkPath = z
  .object(Object.fromEntries(LEVELS.map((l) => [l, NetworkNode])))
  .openapi('NetworkPath', { description: 'Where the meter sits, from zone down to its distribution transformer.' });

export const StatusCounts = z
  .object({ installed: z.number().int(), faulty: z.number().int(), decommissioned: z.number().int() })
  .openapi('StatusCounts');

export const Problem = z
  .object({ type: z.string(), title: z.string(), status: z.number().int(), detail: z.string().optional() })
  .openapi('Problem', { description: 'RFC 9457 problem details.' });

// ---------- meters ----------

export const Meter = z
  .object({
    meterId: z.string().openapi({ example: 'J100004' }),
    serialNo: z.string().openapi({ example: 'SE65293' }),
    make: z.string().openapi({ example: 'Genus' }),
    phase: Phase,
    status: MeterStatus,
    installationType: InstallationType,
    recordFormat: z.string().openapi({ description: 'Portal-internal record format ("legacy" or "v2").', example: 'v2' }),
    transformerCode: z.string().openapi({ example: 'DT-005' }),
    network: NetworkPath,
    location: z.object({ lat: z.number(), lng: z.number() }),
    distanceKm: z.number().optional().openapi({ description: 'Only present when `near` was given.' }),
  })
  .openapi('Meter');

const csv = (description) => z.string().optional().openapi({ description: `${description} Comma-separated for several values.` });

export const MeterListQuery = z.object({
  q: z.string().optional().openapi({ description: 'Case-insensitive substring of meter ID or serial number.', example: 'j1000' }),
  status: csv('Filter by status (installed, faulty, decommissioned).'),
  make: csv('Filter by manufacturer (case-insensitive), e.g. Genus.'),
  phase: Phase.optional(),
  installationType: InstallationType.optional(),
  zone: z.string().optional().openapi({ description: 'Zone code, e.g. Z-01. Same for the other network levels.' }),
  circle: z.string().optional(),
  division: z.string().optional(),
  subdivision: z.string().optional(),
  substation: z.string().optional(),
  feeder: z.string().optional().openapi({ example: 'F-007' }),
  transformer: z.string().optional().openapi({ example: 'DT-007' }),
  near: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'Use "lat,lng"')
    .optional()
    .openapi({ description: 'Sort by distance from "lat,lng" and include `distanceKm`.', example: '26.9124,75.7873' }),
  radiusKm: z.coerce.number().positive().max(500).optional().openapi({ description: 'With `near`: only meters within this radius.' }),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export const MeterPage = z
  .object({ data: z.array(Meter), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() })
  .openapi('MeterPage');

export const MeterIdParams = z.object({ meterId: z.string().openapi({ example: 'J100004' }) });

export const RangeQuery = z.object({
  from: isoDate.optional().openapi({ description: 'First day (inclusive, IST). Alone: a 7-day window starting here.', example: '2026-06-01' }),
  to: isoDate.optional().openapi({ description: 'Last day (inclusive, IST). Alone: a 7-day window ending here. Neither: the latest 7 days.', example: '2026-06-30' }),
});

export const Interval = z
  .enum(['PT30M', 'P1D', 'irregular', 'unknown'])
  .openapi('Interval', { description: 'ISO-8601 duration between readings. Meters report half-hourly or daily.' });

export const Reading = z
  .object({
    timestamp: z.string().openapi({ example: '2026-06-01T00:30:00+05:30' }),
    kwh: z.number().nullable().openapi({ description: 'Cumulative kWh register.' }),
    kvah: z.number().nullable().openapi({ description: 'Cumulative kVAh register.' }),
    voltageR: z.number().nullable().openapi({ description: 'R-phase voltage (V).' }),
  })
  .openapi('Reading');

export const DroppedRow = z.object({ timestamp: z.string(), reason: z.string() }).openapi('DroppedRow');

const freshness = {
  fetchedAt: z.string().openapi({ description: 'When we pulled this window from the portal.' }),
  stale: z.boolean().openapi({ description: 'True if the portal was unreachable and an older cached copy was served.' }),
};

export const ReadingsResponse = z
  .object({
    meterId: z.string(),
    interval: Interval,
    ...freshness,
    readings: z.array(Reading),
    dropped: z.array(DroppedRow).openapi({ description: 'Portal rows we discarded and why.' }),
  })
  .openapi('ReadingsResponse');

export const DailyConsumption = z
  .object({
    date: z.string().openapi({ example: '2026-06-01' }),
    kwh: z.number(),
    kvah: z.number(),
    intervals: z.number().int(),
    complete: z.boolean().openapi({ description: 'False when some intervals of the day are missing (e.g. the last day of the window).' }),
  })
  .openapi('DailyConsumption');

export const ConsumptionSummary = z
  .object({
    readingCount: z.number().int(),
    firstReadingAt: z.string().nullable(),
    lastReadingAt: z.string().nullable(),
    totalKwh: z.number(),
    totalKvah: z.number(),
    avgDailyKwh: z.number().nullable(),
    powerFactor: z.number().nullable(),
    voltageR: z.object({ min: z.number(), max: z.number(), avg: z.number() }).nullable(),
  })
  .openapi('ConsumptionSummary');

export const ConsumptionResponse = z
  .object({
    meterId: z.string(),
    status: MeterStatus,
    interval: Interval,
    ...freshness,
    days: z.array(DailyConsumption),
    summary: ConsumptionSummary,
    warnings: z.array(z.string()),
  })
  .openapi('ConsumptionResponse');

// ---------- transformers ----------

export const Transformer = z
  .object({
    code: z.string().openapi({ example: 'DT-007' }),
    name: z.string().openapi({ example: 'Sanganer DT 7' }),
    feederCode: z.string(),
    capacityKva: z.number(),
    meterCount: z.number().int(),
    statusCounts: StatusCounts,
    network: NetworkPath.nullable().openapi({ description: 'Path down to this transformer; null if it has no meters.' }),
  })
  .openapi('Transformer');

export const TransformerList = z.object({ data: z.array(Transformer), total: z.number().int() }).openapi('TransformerList');
export const TransformerListQuery = z.object({ feeder: z.string().optional().openapi({ example: 'F-007' }) });
export const TransformerParams = z.object({ code: z.string().openapi({ example: 'DT-007' }) });
export const TransformerDetail = Transformer.extend({ meters: z.array(Meter) }).openapi('TransformerDetail');

export const TransformerLoadDay = z
  .object({
    date: z.string(),
    kwh: z.number(),
    kvah: z.number(),
    avgKva: z.number().openapi({ description: 'kVAh / 24 — average apparent load over the day.' }),
    utilizationPct: z.number().openapi({ description: 'avgKva as a % of nameplate capacity. Averages hide peaks.' }),
    metersReporting: z.number().int(),
    complete: z.boolean().openapi({ description: 'Every meter on the transformer had a complete day.' }),
  })
  .openapi('TransformerLoadDay');

export const TransformerLoad = z
  .object({
    transformerCode: z.string(),
    capacityKva: z.number(),
    days: z.array(TransformerLoadDay),
    meters: z.array(z.object({ meterId: z.string(), status: MeterStatus, interval: Interval, kwh: z.number() })),
    warnings: z.array(z.string()),
  })
  .openapi('TransformerLoad');

// ---------- meta ----------

export const DataIssue = z
  .object({
    type: z.enum([
      'missing_code',
      'missing_name',
      'name_conflict',
      'path_conflict',
      'transformer_feeder_mismatch',
      'code_reused_across_parents',
      'unknown_transformer',
    ]),
    level: z.enum(LEVELS).optional(),
    meterId: z.string().optional(),
    code: z.string().optional(),
    detail: z.string(),
    repaired: z.boolean(),
  })
  .openapi('DataIssue');

export const DataIssuesQuery = z.object({ type: DataIssue.shape.type.optional() });
export const DataIssues = z
  .object({ total: z.number().int(), byType: z.record(z.string(), z.number().int()), data: z.array(DataIssue) })
  .openapi('DataIssues');

const Breakdown = z.record(z.string(), z.number().int());
export const Stats = z
  .object({
    meters: z.number().int(),
    transformers: z.number().int(),
    syncedAt: z.string().nullable(),
    byStatus: Breakdown,
    byMake: Breakdown,
    byPhase: Breakdown,
    byInstallationType: Breakdown,
    byZone: Breakdown,
  })
  .openapi('Stats');

export const Health = z
  .object({
    status: z.enum(['ok', 'degraded']),
    catalog: z.object({
      syncedAt: z.string().nullable(),
      ageSeconds: z.number().nullable(),
      stale: z.boolean(),
      syncing: z.boolean(),
      lastError: z.string().nullable(),
    }),
  })
  .openapi('Health');
