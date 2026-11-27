import { readFileSync } from 'node:fs';

// Runtime contract: reads the same shared schema at runtime; no import of pkg-contract-a.
const schemaUrl = new URL('../../../contracts/payload.schema.json', import.meta.url);

export function readContractB(): unknown {
  return JSON.parse(readFileSync(schemaUrl, 'utf8'));
}
