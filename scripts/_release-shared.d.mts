// Type declarations for _release-shared.mjs.
// Manually-maintained companion file; keep in sync with the .mjs.

export function resolvePnpmInvocation(): {
  bin: string;
  args: string[];
  isNpm: boolean;
  env?: NodeJS.ProcessEnv;
};

export interface PnpmRunOpts {
  cwd: string;
  stdio?: 'inherit' | 'pipe' | 'ignore';
  env?: NodeJS.ProcessEnv;
}

export function runPnpm(args: string[], opts: PnpmRunOpts): unknown;
export function npmCmdBin(): string;
export function runNpm(args: string[], opts: PnpmRunOpts): unknown;
export function toPosixPath(p: string): string;
export function inspectTarball(tarball: string): unknown;
export function verifyTarball(
  tarball: string,
  name: string,
  version: string,
  internalPackages: Array<{ name: string; version: string }>
): { ok: boolean; errors: string[]; warnings: string[] };
