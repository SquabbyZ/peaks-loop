/**
 * 5-state OCR 1.8.x detect. Mirrors the ECC detect shape.
 */
import { spawnSync } from 'node:child_process';
import { resolveNpxInvocation } from './npx-resolver.js';
import { OCR_18_PACKAGE } from './ocr-multilang-adapter.js';

export type Ocr18DetectState =
  | 'ready'
  | 'ocr18-missing'
  | 'binary-missing'
  | 'llm-config-missing'
  | 'detection-failed';

export type Ocr18DetectResult = {
  readonly state: Ocr18DetectState;
  readonly npxAvailable: boolean;
  readonly package: typeof OCR_18_PACKAGE;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
};

/** Named code for "npx itself could not be launched" — distinct from "npx is absent". */
export const NPX_PROBE_UNRESOLVED_CODE = 'NPX_PROBE_UNRESOLVED';

type NpxProbe =
  | { readonly available: true }
  | {
      readonly available: false;
      /** `not-on-path` = npx is absent; `not-launchable` = it is there but we could not run it. */
      readonly reason: 'not-on-path' | 'not-launchable' | 'probe-failed';
      readonly detail: string;
    };

// 2026-09-10: `npx` on Windows is an `npx.cmd` shim, which Node refuses to spawn
// without `shell: true` — a bare `spawnSync('npx', …)` failed with ENOENT and was
// then reported as "npx is not on PATH" on machines where `npx --version` exits 0.
// The shim is bypassed through `resolveNpxInvocation` (same helper as
// `detect-eslint.ts`), and a launch failure is reported as its OWN reason rather
// than being collapsed into "absent".
function probeNpx(): NpxProbe {
  const { command, args, baseEnv } = resolveNpxInvocation(['--version']);
  const probe = spawnSync(command, args, { encoding: 'utf8', env: baseEnv });
  if (probe.status === 0) return { available: true };
  const error = probe.error;
  if (error !== undefined && error !== null) {
    // `command !== 'npx'` ⇒ the resolver located a real npx CLI entry and it STILL
    // could not be launched — a different failure from "npx is not on PATH".
    return command !== 'npx'
      ? { available: false, reason: 'not-launchable', detail: error.message }
      : { available: false, reason: 'not-on-path', detail: error.message };
  }
  return { available: false, reason: 'probe-failed', detail: `npx --version exited ${probe.status ?? 'null'}` };
}

function probeOcr18(): boolean {
  const { command, args, baseEnv } = resolveNpxInvocation(['--package', OCR_18_PACKAGE, '--', 'ocr', 'version']);
  const result = spawnSync(command, args, { encoding: 'utf8', env: baseEnv });
  return result.status === 0;
}

export function detectOcr18(): Ocr18DetectResult {
  const probe = probeNpx();
  if (!probe.available) {
    if (probe.reason === 'not-launchable') {
      return {
        state: 'detection-failed',
        npxAvailable: false,
        package: OCR_18_PACKAGE,
        warnings: [`${NPX_PROBE_UNRESOLVED_CODE}: could not launch npx to probe (${probe.detail}).`],
        nextActions: ['Ensure Node.js >= 20 with its bundled npm is installed; `npx --version` must succeed.']
      };
    }
    return {
      state: 'ocr18-missing',
      npxAvailable: false,
      package: OCR_18_PACKAGE,
      warnings: [probe.reason === 'not-on-path' ? 'npx is not on PATH' : probe.detail],
      nextActions: ['Install Node.js ≥ 20 with npm to enable `npx --package`.']
    };
  }
  if (!probeOcr18()) {
    return {
      state: 'ocr18-missing',
      npxAvailable: true,
      package: OCR_18_PACKAGE,
      warnings: [`could not resolve ${OCR_18_PACKAGE}`],
      nextActions: ['Run `npm i @alibaba-group/open-code-review@1.8.9` to install the reviewer.']
    };
  }
  return {
    state: 'ready',
    npxAvailable: true,
    package: OCR_18_PACKAGE,
    warnings: [],
    nextActions: []
  };
}
