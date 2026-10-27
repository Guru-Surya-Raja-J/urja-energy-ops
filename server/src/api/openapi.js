import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { LEVELS } from '../domain/levels.js';
import * as S from './schemas.js';

const json = (schema, description) => ({ description, content: { 'application/json': { schema } } });
const problem = (description) => ({ description, content: { 'application/problem+json': { schema: S.Problem } } });
const upstream = {
  502: problem('The portal returned something unexpected.'),
  503: problem('The portal is unreachable or kept rate-limiting us.'),
};

/** Builds the OpenAPI 3 document from the same zod schemas the routes validate with. */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  // Recursive tree: easier to describe by hand than through zod.
  registry.register('StatusCounts', S.StatusCounts);
  registry.registerComponent('schemas', 'HierarchyNode', {
    type: 'object',
    required: ['id', 'level', 'code', 'name', 'meterCount', 'statusCounts', 'children'],
    properties: {
      id: { type: 'string', description: 'Path-scoped id, e.g. "Z-01/C-04/D-10". Codes alone are not unique.', example: 'Z-01/C-04' },
      level: { type: 'string', enum: LEVELS },
      code: { type: 'string', nullable: true },
      name: { type: 'string', nullable: true },
      meterCount: { type: 'integer' },
      statusCounts: { $ref: '#/components/schemas/StatusCounts' },
      children: { type: 'array', items: { $ref: '#/components/schemas/HierarchyNode' } },
    },
  });
  registry.registerComponent('schemas', 'HierarchyTree', {
    type: 'object',
    required: ['data'],
    properties: { data: { type: 'array', items: { $ref: '#/components/schemas/HierarchyNode' } } },
  });

  const routes = [
    {
      method: 'get',
      path: '/api/health',
      tags: ['Meta'],
      summary: 'Service health and catalogue freshness',
      responses: { 200: json(S.Health, 'Service is up. `degraded` means the last catalogue sync failed or the copy is stale.') },
    },
    {
      method: 'get',
      path: '/api/v1/meters',
      tags: ['Meters'],
      summary: 'Search and filter meters',
      description:
        "Served from the local catalogue (synced from the portal's bulk export), so filters can be combined freely — " +
        'something the portal itself cannot do. Add `near` for a distance-sorted geo search.',
      request: { query: S.MeterListQuery },
      responses: { 200: json(S.MeterPage, 'A page of meters.'), 400: problem('Invalid query.') },
    },
    {
      method: 'get',
      path: '/api/v1/meters/{meterId}',
      tags: ['Meters'],
      summary: 'One meter: nameplate, network position and location',
      request: { params: S.MeterIdParams },
      responses: { 200: json(S.Meter, 'The meter.'), 404: problem('Unknown meter ID (IDs are case-sensitive).') },
    },
    {
      method: 'get',
      path: '/api/v1/meters/{meterId}/readings',
      tags: ['Meters'],
      summary: 'Raw register readings for a date window',
      description:
        'Cumulative kWh/kVAh registers and R-phase voltage, as numbers, with IST timestamps. Duplicate/blank portal rows are dropped and listed in `dropped`.',
      request: { params: S.MeterIdParams, query: S.RangeQuery },
      responses: { 200: json(S.ReadingsResponse, 'Readings, oldest first.'), 400: problem('Bad date window.'), 404: problem('Unknown meter.'), ...upstream },
    },
    {
      method: 'get',
      path: '/api/v1/meters/{meterId}/consumption',
      tags: ['Meters'],
      summary: 'Daily consumption derived from the registers',
      description: 'Works the same for half-hourly and daily meters. Includes a summary and data-quality warnings.',
      request: { params: S.MeterIdParams, query: S.RangeQuery },
      responses: { 200: json(S.ConsumptionResponse, 'Per-day consumption.'), 400: problem('Bad date window.'), 404: problem('Unknown meter.'), ...upstream },
    },
    {
      method: 'get',
      path: '/api/v1/transformers',
      tags: ['Network'],
      summary: 'Distribution transformers with meter counts',
      request: { query: S.TransformerListQuery },
      responses: { 200: json(S.TransformerList, 'All transformers.') },
    },
    {
      method: 'get',
      path: '/api/v1/transformers/{code}',
      tags: ['Network'],
      summary: 'One transformer and the meters on it',
      request: { params: S.TransformerParams },
      responses: { 200: json(S.TransformerDetail, 'The transformer.'), 404: problem('Unknown transformer.') },
    },
    {
      method: 'get',
      path: '/api/v1/transformers/{code}/load',
      tags: ['Network'],
      summary: 'Daily load on a transformer vs. its capacity',
      description: "Sums daily consumption across the transformer's meters. Costs one portal call per meter on a cold cache.",
      request: { params: S.TransformerParams, query: S.RangeQuery },
      responses: { 200: json(S.TransformerLoad, 'Daily load.'), 404: problem('Unknown transformer.'), ...upstream },
    },
    {
      method: 'get',
      path: '/api/v1/hierarchy',
      tags: ['Network'],
      summary: 'Zone → circle → division → subdivision → substation → feeder → transformer tree',
      responses: { 200: json({ $ref: '#/components/schemas/HierarchyTree' }, 'The reconstructed network tree with meter counts per node.') },
    },
    {
      method: 'get',
      path: '/api/v1/stats',
      tags: ['Meta'],
      summary: 'Fleet breakdown by status, make, phase, etc.',
      responses: { 200: json(S.Stats, 'Counts.') },
    },
    {
      method: 'get',
      path: '/api/v1/data-issues',
      tags: ['Meta'],
      summary: 'Inconsistencies found in the portal data, and how we handled them',
      request: { query: S.DataIssuesQuery },
      responses: { 200: json(S.DataIssues, 'Issues.') },
    },
  ];
  routes.forEach((r) => registry.registerPath(r));

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Urja Meter API',
      version: '1.0.0',
      description:
        'A clean, read-only API over the Urja Meter Ops portal: meters, their place in the distribution network, ' +
        'and their consumption. Timestamps are IST (+05:30). Errors are RFC 9457 problem+json. See PROTOCOL.md for how the portal works underneath.',
    },
    servers: [{ url: 'http://localhost:4000' }],
  });
}
