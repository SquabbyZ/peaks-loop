/**
 * Cross-platform `npx` resolver.
 *
 * On Windows, `npm` installs `npx` as a `.cmd` shim; Node 22's
 * `child_process.spawnSync` refuses to invoke it unless `shell: true`
 * is set, and `shell: true` corrupts quoted `--package` arguments.
 * Rather than depend on shell quoting, this helper resolves the
 * npx script bundled with the user's `npm` install and invokes it
 * via `node <npx-cli.js>` with the same argv. macOS / Linux continue
 * to use the regular `npx` binary.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export type NpxInvocation = {
  readonly command: string;
  readonly args: readonly string[];
  readonly baseEnv: NodeJS.ProcessEnv;
};

function locateNpxCliScript(): string | null {
  const candidates: ReadonlyArray<string> = process.platform === 'win32'
    ? [
        join(process.execPath, '..', '..', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        'C:/nvm4w/nodejs/node_modules/npm/bin/npx-cli.js',
        'C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js'
      ]
    : [
        join(process.execPath, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')
      ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveNpxInvocation(npxArgs: readonly string[]): NpxInvocation {
  if (process.platform === 'win32') {
    const cliScript = locateNpxCliScript();
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
