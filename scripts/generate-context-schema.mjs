/**
 * One-off generator: writes schemas/context.schema.json from the
 * ContextJsonSchema Zod object. Run via `pnpm tsx scripts/generate-context-schema.mjs`.
 *
 * Uses tsx (not plain node) so it can resolve the .ts source file.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ContextJsonSchema } from '../src/services/context/context-schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'schemas', 'context.schema.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(zodToJsonSchema(ContextJsonSchema), null, 2));
console.log(`Wrote ${outPath}`);
