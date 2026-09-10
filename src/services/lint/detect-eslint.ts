/**
 * 5-state ESLint detect — soft-fail when the toolchain is missing.
 * Mirrors the ECC bridge detect shape so peaks-rd can compose a
 * unified Gate B5 verdict.
 */
import { spawnSync } from 'node:child_process';
import { resolveNpmInvocation, resolveNpxInvocation } from './npx-resolver.js';
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
  'typescriptEslintPlugin'
];

function packageNameFor(key: keyof typeof ESLINT_PACKAGE_PINS): string {
  switch (key) {
    case 'eslint': return 'eslint';
    case 'typescriptEslintParser': return '@typescript-eslint/parser';
    case 'typescriptEslintPlugin': return '@typescript-eslint/eslint-plugin';
  }
}

function probeNpx(): boolean {
  const { command, args, baseEnv } = resolveNpxInvocation(['--version']);
  const probe = spawnSync(command, args, { encoding: 'utf8', env: baseEnv });
  return probe.status === 0;
}

/** Named code for "npm itself could not be launched" — distinct from a registry miss. */
export const NPM_PROBE_UNRESOLVED_CODE = 'NPM_PROBE_UNRESOLVED';

type PackageProbe = {
  readonly ok: boolean;
  /** Set only when the probe could not be LAUNCHED (npm unresolvable), not on a non-zero exit. */
  readonly error: string | null;
};

function probePackage(key: keyof typeof ESLINT_PACKAGE_PINS): PackageProbe {
  const pkg = packageNameFor(key);
  const pin = ESLINT_PACKAGE_PINS[key];
  // 2026-09-10: `npm` on Windows is an `npm.cmd` shim, which Node >= 20 refuses
  // to spawn at all without `shell: true` — and `shell: true` concatenates the
  // argv unescaped (DEP0190 on every call, and any argument containing a space
  // is split). So the shim is bypassed: `resolveNpmInvocation` resolves npm's
  // own JS entry and this runs it through `process.execPath`. Same shape as the
  // npx probe above and as `eslint-runner.ts`.
  const { command, args, baseEnv } = resolveNpmInvocation(['view', `${pkg}@${pin}`, 'version']);
  const result = spawnSync(command, args, { encoding: 'utf8', env: baseEnv });
  return {
    ok: result.status === 0,
    error: result.error === undefined || result.error === null ? null : result.error.message
  };
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
    const probe = probePackage(key);
    if (probe.ok) continue;
    const target = `${packageNameFor(key)}@${ESLINT_PACKAGE_PINS[key]}`;
    warnings.push(
      probe.error === null
        ? `npm registry cannot resolve ${target}`
        : `${NPM_PROBE_UNRESOLVED_CODE}: could not launch npm to probe ${target} (${probe.error}). ` +
          'Ensure Node.js >= 20 with its bundled npm is installed.'
    );
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
