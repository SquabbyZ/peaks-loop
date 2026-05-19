#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(join(packageRoot, 'dist'), { recursive: true, force: true });
