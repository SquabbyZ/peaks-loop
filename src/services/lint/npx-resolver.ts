/**
 * Cross-platform `npm` / `npx` resolver.
 *
 * On Windows, `npm` installs `npx` and `npm` as `.cmd` shims; Node's
 * `child_process.spawnSync` refuses to invoke a `.cmd` unless `shell: true`
 * is set, and `shell: true` concatenates (does not escape) the argv — it
 * corrupts quoted `--package` arguments, splits any argument containing a
 * space, and emits DEP0190 on every call. Rather than depend on shell
 * quoting, these helpers resolve the CLI script bundled with the user's
 * `npm` install and invoke it via `node <npm|npx>-cli.js` with the same
 * argv. macOS / Linux continue to use the regular binaries.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export type NpxInvocation = {
  readonly command: string;
  readonly args: readonly string[];
  readonly baseEnv: NodeJS.ProcessEnv;
};

/** Locate `<npm install>/bin/<scriptFile>`, or `null` when not on disk. */
function locateNpmCliScript(scriptFile: 'npm-cli.js' | 'npx-cli.js'): string | null {
  const candidates: ReadonlyArray<string> = process.platform === 'win32'
    ? [
        join(process.execPath, '..', '..', 'node_modules', 'npm', 'bin', scriptFile),
        `C:/nvm4w/nodejs/node_modules/npm/bin/${scriptFile}`,
        `C:/Program Files/nodejs/node_modules/npm/bin/${scriptFile}`
      ]
    : [
        join(process.execPath, '..', '..', 'lib', 'node_modules', 'npm', 'bin', scriptFile)
      ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveNpxInvocation(npxArgs: readonly string[]): NpxInvocation {
  if (process.platform === 'win32') {
    const cliScript = locateNpmCliScript('npx-cli.js');
    if (cliScript !== null) {
      return {
        command: process.execPath,
        args: [cliScript, ...npxArgs],
        baseEnv: process.env
      };
    }
  }
  return {
    command: 'npx',
    args: npxArgs,
    baseEnv: process.env
  };
}

/**
 * `npm` sibling of `resolveNpxInvocation`, same shim bypass: `node
 * <npm-cli.js> <args>`. A caller must NOT reach for bare `npm` + `shell: true`
 * instead — the shim is the defect, not the justification.
 */
export function resolveNpmInvocation(npmArgs: readonly string[]): NpxInvocation {
  if (process.platform === 'win32') {
    const cliScript = locateNpmCliScript('npm-cli.js');
    if (cliScript !== null) {
      return {
        command: process.execPath,
        args: [cliScript, ...npmArgs],
        baseEnv: process.env
      };
    }
  }
  return {
    command: 'npm',
    args: npmArgs,
    baseEnv: process.env
  };
}
