#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = packageJson.version;

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json version must be a non-empty string');
}

// Slice 3a — version.ts lives in the peaks-loop-shared workspace package.
// The shared package is `private: true` and is consumed via workspace:*,
// so its own package.json `version` field is irrelevant for downstream
// consumers; we always emit the main peaks-loop version.
writeFileSync(
  resolve('packages/peaks-loop-shared/src/version.ts'),
  `export const CLI_VERSION = ${JSON.stringify(version)};\n`,
);
