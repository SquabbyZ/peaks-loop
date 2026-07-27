/**
 * Check: every emitted check ID matches the `doctor-report.schema.json`
 * check.id pattern (`doctor-self:check-id-pattern`).
 *
 * Self-validation gate that runs after every other check so it can
 * observe the full list of emitted IDs. Fails when:
 *   - The schema file is missing / unreadable.
 *   - The schema does not declare a `checks.items.properties.id.pattern`.
 *   - Any emitted check ID does not match the declared pattern.
 *
 * The accumulator is passed via the `DoctorContext` (see types.ts:
 * `accumulatedChecks`). The plugin dispatcher in `index.ts` builds
 * the accumulator incrementally and updates it before each plugin
 * runs, so by the time this check fires every prior check's IDs are
 * visible.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

interface SchemaShape {
  properties?: {
    checks?: {
      items?: {
        properties?: {
          id?: { pattern?: string };
        };
      };
    };
  };
}

function runSelfCheck(schemaRoot: string, emittedIds: readonly string[]): readonly DoctorCheck[] {
  const schemaPath = join(schemaRoot, 'doctor-report.schema.json');
  if (!existsSync(schemaPath)) {
    return [{
      id: 'doctor-self:check-id-pattern',
      ok: false,
      message: `Failed to load doctor-report.schema.json for self-validation: ${getErrorMessage(new Error(`ENOENT: ${schemaPath}`))}`
    }];
  }
  try {
    const schemaText = readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(schemaText) as SchemaShape;
    const patternSource = schema.properties?.checks?.items?.properties?.id?.pattern;
    if (typeof patternSource !== 'string') {
      return [{
        id: 'doctor-self:check-id-pattern',
        ok: false,
        message: 'doctor-report.schema.json does not declare a check.id pattern'
      }];
    }
    const pattern = new RegExp(patternSource);
    const mismatches = emittedIds.filter((id) => !pattern.test(id));
    return [{
      id: 'doctor-self:check-id-pattern',
      ok: mismatches.length === 0,
      message: mismatches.length === 0
        ? 'All doctor check IDs match the doctor-report schema pattern'
        : `Doctor check IDs missing from schema pattern: ${mismatches.join(', ')}`
    }];
  } catch (error) {
    return [{
      id: 'doctor-self:check-id-pattern',
      ok: false,
      message: `Failed to load doctor-report.schema.json for self-validation: ${getErrorMessage(error)}`
    }];
  }
}

function run({ schemaRoot, accumulatedChecks }: DoctorContext): readonly DoctorCheck[] {
  return runSelfCheck(schemaRoot, accumulatedChecks.map((check) => check.id));
}

export const check: DoctorCheckPlugin = {
  name: 'check-id-schema',
  run
};