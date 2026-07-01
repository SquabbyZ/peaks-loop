/**
 * no-root-pollution enforcer — PreToolUse Write/Edit guard.
 *
 * Per L2 redesign §5.4. Deny writes to <project>/root for files NOT in
 * the documented allowlist. The allowlist is hand-maintained for v1; a
 * follow-up slice can expose it via `peaks standards`.
 *
 * Trust red line: this hook MUST fail-open on registry / FS errors. The
 * LLM is never bricked by a peaks bug.
 */

import { resolve } from 'node:path';

const ROOT_FILE_ALLOWLIST: ReadonlySet<string> = new Set([
  // Top-level docs
  'README.md', 'README-en.md', 'LICENSE', 'LICENSE.md', 'NOTICE', 'CONTRIBUTING.md',
  'CHANGELOG.md', 'AUTHORS', 'CONTRIBUTORS',
  // Build / package manifests
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
  'tsconfig.*.json', 'vitest.config.ts', 'vite.config.ts', '.npmrc', '.nvmrc',
  // VCS / editor
  '.gitignore', '.gitattributes', '.editorconfig', '.gitkeep',
  // Project-local config dirs (peaks-loop convention)
  'openspec', '.peaks', '.claude', '.peaksrc',
  // Source dirs (writes into them are normal)
  'src', 'tests', 'bin', 'scripts', 'schemas', 'output-styles', 'docs',
  // Skills are allowed at root
  'skills',
  // Generated / ignored
  'dist', 'node_modules', 'coverage', '.nyc_output',
]);

export interface RootWriteCheckInput {
  readonly projectRoot: string;
  readonly filePath: string;
}

export interface RootWriteCheckResult {
  readonly isRoot: boolean;
  readonly allowed: boolean;
  readonly topSegment: string;
  readonly denyReason: string;
}

export function isRootWrite(input: RootWriteCheckInput): RootWriteCheckResult {
  const projectRoot = resolve(input.projectRoot);
  const filePath = resolve(input.filePath);
  const rel = filePath.startsWith(projectRoot)
    ? filePath.slice(projectRoot.length).replace(/^[\\/]+/, '')
    : filePath;
  const topSegment = rel.split(/[\\/]/)[0] ?? '';

  // If file is NOT at root (e.g. src/foo/bar.ts), the top segment is "src"
  // which is in the allowlist. This handler only flags FILES AT THE ROOT
  // (top-level), so check whether the file is exactly at root depth.
  const segments = rel.split(/[\\/]/).filter(Boolean);
  const isAtRoot = segments.length === 1;

  if (!isAtRoot) {
    return { isRoot: false, allowed: true, topSegment, denyReason: '' };
  }

  if (ROOT_FILE_ALLOWLIST.has(topSegment)) {
    return { isRoot: true, allowed: true, topSegment, denyReason: '' };
  }

  return {
    isRoot: true,
    allowed: false,
    topSegment,
    denyReason: `no-root-pollution: file "${rel}" is not in the root allowlist. ` +
      `Move it under docs/, tests/, skills/, or another documented directory, ` +
      `or add it to ROOT_FILE_ALLOWLIST in src/services/audit/enforcers/no-root-pollution.ts.`,
  };
}
