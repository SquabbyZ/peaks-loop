/**
 * Check: codegraph capability (`capability:codegraph`).
 *
 * Verifies that `@colbymchenry/codegraph` resolves at the pinned
 * version AND that the binary exists at the expected on-disk path.
 * Fails when the version drifts, when the binary is missing, or
 * when the package is not resolvable at all.
 *
 * The probe is injected so tests do not depend on the real
 * `node_modules` resolution; the default probe uses
 * `createRequire(import.meta.url)` to find the package.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { createRequire } from 'node:module';

import { getErrorMessage } from 'peaks-loop-shared/result';

import type { CodegraphCapabilityProbe, DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

const CODEGRAPH_EXPECTED_VERSION = '0.7.10';

function defaultCodegraphProbe(): CodegraphCapabilityProbe {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('@colbymchenry/codegraph/package.json');
  const pkg = require(packagePath) as { version?: string };
  const binaryPath = resolvePath(dirname(packagePath), 'dist', 'bin', 'codegraph.js');
  return {
    packagePath,
    version: pkg.version ?? 'unknown',
    binaryPath,
    binaryExists: existsSync(binaryPath)
  };
}

function runCheck(probe: () => CodegraphCapabilityProbe): readonly DoctorCheck[] {
  try {
    const result = probe();
    const versionOk = result.version === CODEGRAPH_EXPECTED_VERSION;
    if (!versionOk) {
      return [{
        id: 'capability:codegraph',
        ok: false,
        message: `@colbymchenry/codegraph version mismatch: expected ${CODEGRAPH_EXPECTED_VERSION}, resolved ${result.version} at ${result.packagePath}`
      }];
    }
    if (!result.binaryExists) {
      return [{
        id: 'capability:codegraph',
        ok: false,
        message: `@colbymchenry/codegraph@${result.version} resolved at ${result.packagePath} but binary is missing at ${result.binaryPath}`
      }];
    }
    return [{
      id: 'capability:codegraph',
      ok: true,
      message: `@colbymchenry/codegraph@${result.version} resolves with binary at ${result.binaryPath}`
    }];
  } catch (error) {
    return [{
      id: 'capability:codegraph',
      ok: false,
      message: `@colbymchenry/codegraph not resolvable: ${getErrorMessage(error)}`
    }];
  }
}

function run({ options }: DoctorContext): readonly DoctorCheck[] {
  const probe = options.codegraphProbe ?? defaultCodegraphProbe;
  return runCheck(probe);
}

export const check: DoctorCheckPlugin = {
  name: 'codegraph-capability',
  run
};