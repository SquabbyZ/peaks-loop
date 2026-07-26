/**
 * Check: `.peaks/memory/index.json` is well-formed JSON
 * (`L3:l3-memory-health`).
 *
 * Slice 2026-06-13-repair-pre-existing-test-failures: the
 * production MemoryIndex schema (see
 * `src/services/memory/project-memory-service.ts`) uses
 * `version: 1` as the schema marker, NOT `schema_version`.
 * We accept BOTH names for back-compat with any external index
 * writers (e.g. a future `schema_version: '2.0.0'` form).
 *
 * When no `.peaks/memory/index.json` exists yet, the check passes
 * (fresh project — no memories have been extracted).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

interface MemoryIndexShape {
  schema_version?: string;
  version?: number | string;
  hot?: Record<string, unknown[]>;
  warm?: Record<string, unknown[]>;
}

function run({ resolvedL3Root }: DoctorContext): readonly DoctorCheck[] {
  const memoryIndexPath = join(resolvedL3Root, '.peaks/memory/index.json');
  if (!existsSync(memoryIndexPath)) {
    return [{
      id: 'L3:l3-memory-health',
      ok: true,
      message: 'No .peaks/memory/index.json yet (no memories extracted)'
    }];
  }
  try {
    const raw = readFileSync(memoryIndexPath, 'utf8');
    const parsed = JSON.parse(raw) as MemoryIndexShape;
    const schemaMarker = parsed.schema_version ?? parsed.version;
    if (schemaMarker === undefined) {
      return [{
        id: 'L3:l3-memory-health',
        ok: false,
        message: '.peaks/memory/index.json missing schema_version / version field'
      }];
    }
    const hotCount = Object.values(parsed.hot ?? {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    const warmCount = Object.values(parsed.warm ?? {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    return [{
      id: 'L3:l3-memory-health',
      ok: true,
      message: `.peaks/memory/index.json is well-formed JSON; version=${schemaMarker}; ${hotCount} hot + ${warmCount} warm memory entries`
    }];
  } catch (parseError) {
    return [{
      id: 'L3:l3-memory-health',
      ok: false,
      message: `.peaks/memory/index.json is not valid JSON: ${getErrorMessage(parseError)}`
    }];
  }
}

export const check: DoctorCheckPlugin = {
  name: 'l3-memory-health',
  run
};