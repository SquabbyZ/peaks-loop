import { resolve } from 'node:path';

/**
 * Absolute path to peaks-loop config service source. Used by integration
 * tests that exercise the slice-topology algorithm against real code.
 *
 * Resolved relative to the integration test directory: tests/integration/
 *   → ../../src/services/config/
 */
export const configServiceDir = resolve(__dirname, '../../src/services/config');
