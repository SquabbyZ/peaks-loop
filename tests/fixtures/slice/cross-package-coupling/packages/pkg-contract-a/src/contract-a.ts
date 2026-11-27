import { readFileSync } from 'node:fs';

// Runtime contract: reads the shared schema at runtime; no import of pkg-contract-b.
const schemaUrl = new URL('../../../contracts/payload.schema.json', import.meta.url);

export function readContractA(): unknown {
  return JSON.parse(readFileSync(schemaUrl, 'utf8'));
}
