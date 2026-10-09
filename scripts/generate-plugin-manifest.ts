#!/usr/bin/env node
// scripts/generate-plugin-manifest.ts
//
// Renders `.claude-plugin/marketplace.json` from its two sources — `package.json`
// and the skills tree — the same way `generate-readonly-whitelist.ts` renders the
// whitelist. `npm run build` runs it, and
// `tests/unit/services/distribution/plugin-manifest.test.ts` runs it again and
// fails when the committed artifact differs from a fresh render.
//
// EDIT THE SOURCE, NOT THE ARTIFACT. A plugin-level field comes from
// `package.json`; a skill entry comes from that skill's own `SKILL.md`. A hand
// edit to the JSON is not overwritten silently — it is red, on purpose (PRD R2).
//
// Run through tsx, because the skill registry is TypeScript:
//
//   node node_modules/tsx/dist/cli.mjs scripts/generate-plugin-manifest.ts

import { writeFileSync } from 'node:fs';

import {
  pluginManifestPath,
  renderPluginManifest
} from '../src/services/distribution/plugin-manifest.js';

const text = await renderPluginManifest();
const target = pluginManifestPath();
writeFileSync(target, text, 'utf8');
process.stdout.write(`plugin-manifest: wrote ${target}\n`);
