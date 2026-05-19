import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { platform, type Platform } from './platform.js';

export const SEP = sep;

const localPathConverters: Record<Platform, (p: string) => string> = {
  win32: (p) => p.replace(/\//g, '\\'),
  darwin: (p) => p,
  linux: (p) => p
};

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function localPath(p: string, targetPlatform: Platform = platform): string {
  return localPathConverters[targetPlatform](p);
}

export function getTempDir(options?: { env?: NodeJS.ProcessEnv }): string {
  const env = options?.env ?? process.env;
  if (env.TEMP) return env.TEMP;
  if (env.TMP) return env.TMP;
  return tmpdir();
}

export function isInsidePath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

export function resolveInputPath(path: string): string {
  return isWindowsAbsolutePath(path) ? normalizePath(path) : resolve(path);
}

export function stableRealPath(path: string): string {
  return realpathSync(resolveInputPath(path));
}

export function stablePath(path: string): string {
  const resolvedPath = resolveInputPath(path);
  if (existsSync(resolvedPath)) {
    return stableRealPath(resolvedPath);
  }

  const parsedPath = parse(resolvedPath);
  const missingSegments: string[] = [];
  let currentPath = resolvedPath;

  while (!existsSync(currentPath) && currentPath !== parsedPath.root) {
    const parsedCurrent = parse(currentPath);
    missingSegments.unshift(parsedCurrent.base);
    currentPath = parsedCurrent.dir;
  }

  const realExistingPath = existsSync(currentPath) ? stableRealPath(currentPath) : parsedPath.root;
  return resolve(realExistingPath, ...missingSegments);
}