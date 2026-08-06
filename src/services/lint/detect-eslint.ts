/**
 * 5-state ESLint detect — soft-fail when the toolchain is missing.
 * Mirrors the ECC bridge detect shape so peaks-rd can compose a
 * unified Gate B5 verdict.
 */
import { spawnSync } from 'node:child_process';
import { ESLINT_PACKAGE_PINS } from './eslint-runner.js';

export type EslintDetectState =
  | 'ready'
  | 'eslint-missing'
  | 'config-error'
  | 'npx-failed'
  | 'detection-failed';

export type EslintDetectResult = {
  readonly state: EslintDetectState;
  readonly npxAvailable: boolean;
  readonly pinnedVersions: typeof ESLINT_PACKAGE_PINS;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
};

const PACKAGES_TO_PROBE: ReadonlyArray<keyof typeof ESLINT_PACKAGE_PINS> = [
  'eslint',
  'typescriptEslintParser',
  'typescriptEslintPlugin',
  'importPlugin'
];

function packageNameFor(key: keyof typeof ESLINT_PACKAGE_PINS): string {
  switch (key) {
    case 'eslint': return 'eslint';
    case 'typescriptEslintParser': return '@typescript-eslint/parser';
    case 'typescriptEslintPlugin': return '@typescript-eslint/eslint-plugin';
    case 'importPlugin': return 'eslint-plugin-import';
  }
}

function probeNpx(): boolean {
  const probe = spawnSync('npx', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function probePackage(key: keyof typeof ESLINT_PACKAGE_PINS): boolean {
  const pkg = packageNameFor(key);
  const pin = ESLINT_PACKAGE_PINS[key];
  const result = spawnSync('npm', ['view', `${pkg}@${pin}`, 'version'], { encoding: 'utf8' });
  return result.status === 0;
}

export function detectEslint(): EslintDetectResult {
  const nextActions: string[] = [];
  const warnings: string[] = [];
  if (!probeNpx()) {
    return {
      state: 'npx-failed',
      npxAvailable: false,
      pinnedVersions: ESLINT_PACKAGE_PINS,
      warnings: ['npx is not on PATH'],
      nextActions: ['Install Node.js ≥ 20 with npm to enable `npx --package`.', 'Or run `peaks code lint --no-npx` (future slice).']
    };
  }
  for (const key of PACKAGES_TO_PROBE) {
    if (!probePackage(key)) {
      warnings.push(`npm registry cannot resolve ${packageNameFor(key)}@${ESLINT_PACKAGE_PINS[key]}`);
    }
  }
  if (warnings.length > 0) {
    nextActions.push('Re-run `peaks code lint --json` after npm connectivity is restored.');
  }
  return {
    state: 'ready',
    npxAvailable: true,
    pinnedVersions: ESLINT_PACKAGE_PINS,
    warnings,
    nextActions
  };
}
