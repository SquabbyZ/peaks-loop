/**
 * Check: foundation schemas are valid JSON (`schema:<file>`).
 *
 * Emits one `DoctorCheck` per `requiredSchemaFiles` entry. Passes
 * when the file parses as JSON; fails with the parse error message
 * (so the operator sees e.g. "Unexpected token } in JSON at position
 * 42" rather than a generic "invalid").
 */

import { join } from 'node:path';

import { readText } from 'peaks-loop-shared/fs';
import { requiredSchemaFiles } from 'peaks-loop-shared/paths';
import { getErrorMessage } from 'peaks-loop-shared/result';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

async function run({ schemaRoot }: DoctorContext): Promise<readonly DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  for (const schemaFile of requiredSchemaFiles) {
    try {
      JSON.parse(await readText(join(schemaRoot, schemaFile)));
      checks.push({ id: `schema:${schemaFile}`, ok: true, message: `Schema ${schemaFile} is valid JSON` });
    } catch (error) {
      checks.push({
        id: `schema:${schemaFile}`,
        ok: false,
        message: `Schema ${schemaFile} is missing or invalid: ${getErrorMessage(error)}`
      });
    }
  }
  return checks;
}

export const check: DoctorCheckPlugin = {
  name: 'schema-validity',
  run
};