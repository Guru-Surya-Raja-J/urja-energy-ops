// Writes the API's OpenAPI document to /openapi.json at the repo root.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildOpenApiDocument } from '../src/api/openapi.js';

const out = path.resolve(import.meta.dirname, '../../openapi.json');
writeFileSync(out, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`wrote ${out}`);
