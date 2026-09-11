/**
 * 5-state OCR 1.8.x detect. Mirrors the ECC detect shape.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveNpxInvocation } from './npx-resolver.js';
import { OCR_18_PACKAGE } from './ocr-multilang-adapter.js';
import { npmExecCacheRoots } from '../../shared/npm-cache.js';

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
  // `windowsHide` on every spawn (repo convention): without it this probe pops
  // a console window on the user's desktop.
  const probe = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, env: baseEnv });
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

/** The scoped directory and exact version a `name@version` spec names. */
function splitSpec(spec: string): { readonly dir: string; readonly version: string } {
  const at = spec.lastIndexOf('@');
  return { dir: spec.slice(0, at), version: spec.slice(at + 1) };
}

/** The version the `package.json` at `modulesRoot/<dir>` declares, or `null`. */
function installedVersion(modulesRoot: string, dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(modulesRoot, dir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    // Nothing installed under this root is the normal case for most of them.
    return null;
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // No exec cache at this location is the normal case on a fresh machine.
    return [];
  }
}

/**
 * Every `node_modules` tree npm consults BEFORE it installs `--package <spec>`.
 *
 * 2026-09-11: this probe used to run `npx --package <pkg> -- ocr version`, which
 * INSTALLED the package when it was not already resolvable — a network fetch, a
 * write into the npm cache, and a console window titled `npm i …` on the user's
 * desktop for seconds. A probe may look; it may not fetch. Presence is decided
 * the way npm decides it (`libnpmexec/lib/index.js`, npm 11.9.0, read on this
 * machine): the LOCAL tree first, matched by `node.pkgid === spec.raw` (name AND
 * exact version), then the `_npx` cache entry; only a double miss installs.
 */
function resolvableModuleRoots(cwd: string): string[] {
  const roots: string[] = [];
  // The local tree: npm anchors on the project root above the cwd and Node
  // resolves modules by walking up, so an ancestor's `node_modules` counts too.
  let dir = resolve(cwd);
  for (;;) {
    roots.push(join(dir, 'node_modules'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const cacheRoot of npmExecCacheRoots()) {
    for (const entry of safeReaddir(cacheRoot)) {
      roots.push(join(cacheRoot, entry, 'node_modules'));
    }
  }
  return roots;
}

/**
 * Whether the pinned package is already resolvable. LOOKS, never fetches: it
 * spawns nothing at all, so there is no install and no window to hide. The
 * version must match the pin exactly — any other version is one npm exec would
 * install over, which is the write this probe exists to avoid.
 */
function probeOcr18(cwd: string): boolean {
  const { dir, version } = splitSpec(OCR_18_PACKAGE);
  return resolvableModuleRoots(cwd).some((modulesRoot) => installedVersion(modulesRoot, dir) === version);
}

/**
 * `cwd` is where the local npm tree is looked for (defaults to the process
 * cwd, like `runOcr18`'s own `cwd`); the npx cache roots are the machine's.
 */
export function detectOcr18(options: { readonly cwd?: string } = {}): Ocr18DetectResult {
  const cwd = options.cwd ?? process.cwd();
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
  if (!probeOcr18(cwd)) {
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
