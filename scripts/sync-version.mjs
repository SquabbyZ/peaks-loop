#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = packageJson.version;

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json version must be a non-empty string');
}

writeFileSync(resolve('src/shared/version.ts'), `export const CLI_VERSION = ${JSON.stringify(version)};\n`);
