#!/usr/bin/env node
// scripts/generate-readonly-whitelist.ts
//
// Regenerates `contracts/readonly-argv-whitelist.json` from the hand-authored
// surface declaration, verifying every entry against the LIVE Commander
// registry on the way. Run it through tsx, because the registry lives in `.ts`:
//
//   node node_modules/tsx/dist/cli.mjs scripts/generate-readonly-whitelist.ts
//
// `npm run build` runs it, and
// `tests/unit/scripts/generate-readonly-whitelist.test.ts`
// runs it again and fails when the committed artifact differs from a fresh
// generation — so a hand-edited artifact cannot survive, and a renamed CLI
// option cannot leave the surface describing an option that is gone.
//
// The output is data: nothing imports it (see `readonly-whitelist.ts` for why).

import { writeFileSync } from 'node:fs';

import { createProgram } from '../src/cli/program.js';
import {
  generateReadOnlyWhitelist,
  loadReadOnlySurface,
  readonlyWhitelistPath,
  serializeReadOnlyWhitelist
} from '../src/services/readonly-surface/whitelist-generator.js';

const surface = loadReadOnlySurface();
const whitelist = generateReadOnlyWhitelist(surface, createProgram());
const target = readonlyWhitelistPath();
writeFileSync(target, serializeReadOnlyWhitelist(whitelist), 'utf8');
process.stdout.write(
  `readonly-whitelist: wrote ${whitelist.entries.length} entries to ${target}\n`
);
