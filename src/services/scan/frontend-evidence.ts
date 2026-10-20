// Positive frontend evidence for `scanArchetype`.
//
// "No backend" is not evidence of a frontend: a TypeScript CLI has neither and
// was reported `frontendOnly: true`. This module answers the opposite question —
// does the repository declare a frontend framework, a CSS-adjacent dependency,
// or carry a css/html-family asset under an application root? A `null` answer is
// the absence of an observation, and the caller reports it as
// `no-frontend-evidence`.
//
// The walk is scoped to application roots on purpose: an unscoped tree walk
// finds `examples/video-demo/src/styles.css` and the HTML under `skills/`, and
// calls a CLI a frontend.

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { isDirectory, pathExists, readText } from 'peaks-loop-shared/fs';

import type { ArchetypeSignal } from './scan-types.js';

/** Each list entry is the evidence CLASS returned to the caller, so the report
 *  can say what it saw instead of only the verdict. */
export const FRONTEND_FRAMEWORK_DEPS = [
  'react',
  'react-dom',
  'vue',
  'svelte',
  'next',
  'nuxt',
  '@angular/core',
  'solid-js',
  'preact',
  'astro',
  'gatsby',
  'remix'
];

export const FRONTEND_STYLE_DEPS = [
  'tailwindcss',
  'sass',
  'less',
  'postcss',
  'styled-components',
  '@emotion/react',
  'bootstrap'
];

export const FRONTEND_APPLICATION_ROOTS = ['src', 'app', 'pages', 'components', 'public'];

/** Upper bound on directory entries inspected per scan. An absent signal is the
 *  common case (every CLI and library), so the walk must stop even in a huge
 *  tree; a miss costs one skipped UI flow, a false positive costs a wrong
 *  project classification. */
export const FRONTEND_EVIDENCE_MAX_ENTRIES = 2000;

const ASSET_EXTENSIONS = /\.(css|scss|sass|less|styl|html|htm|vue|svelte)$/;

/** Generated / installed trees never hold the project's own styles. */
const WALK_SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

function firstDeclared(deps: Record<string, string>, names: readonly string[]): string | null {
  return names.find((name) => Object.prototype.hasOwnProperty.call(deps, name)) ?? null;
}

/** `bin` counts only when it points somewhere: a string or an object of strings. */
function hasNonEmptyBin(bin: unknown): boolean {
  if (typeof bin === 'string') return bin.trim().length > 0;
  if (bin === null || typeof bin !== 'object') return false;
  return Object.values(bin as Record<string, unknown>).some(
    (value) => typeof value === 'string' && value.trim().length > 0
  );
}

export async function readRootBin(projectRoot: string): Promise<boolean> {
  const pkgPath = join(projectRoot, 'package.json');
  if (!(await pathExists(pkgPath))) return false;
  try {
    const parsed = JSON.parse(await readText(pkgPath)) as { bin?: unknown };
    return hasNonEmptyBin(parsed.bin);
  } catch {
    // An unreadable manifest is not a CLI claim, and not an absence of one
    // either; `false` says only "no bin evidence was observed".
    return false;
  }
}

function isAssetFile(entry: Dirent): boolean {
  return !entry.isDirectory() && ASSET_EXTENSIONS.test(entry.name);
}

function isSkippedDir(name: string): boolean {
  return name.startsWith('.') || WALK_SKIP_DIRS.has(name);
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  return readdir(dir, { withFileTypes: true }).catch((): Dirent[] => []);
}

async function assetUnderRoot(rootDir: string): Promise<boolean> {
  const queue: string[] = [rootDir];
  let inspected = 0;
  while (queue.length > 0 && inspected < FRONTEND_EVIDENCE_MAX_ENTRIES) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries = await readDirSafe(current);
    inspected += entries.length;
    if (entries.some(isAssetFile)) return true;
    for (const entry of entries) {
      if (entry.isDirectory() && !isSkippedDir(entry.name)) {
        queue.push(join(current, entry.name));
      }
    }
  }
  return false;
}

async function assetUnderApplicationRoots(projectRoot: string): Promise<string | null> {
  for (const root of FRONTEND_APPLICATION_ROOTS) {
    const rootDir = join(projectRoot, root);
    if (!(await isDirectory(rootDir))) continue;
    if (await assetUnderRoot(rootDir)) return `css-under-${root}`;
  }
  return null;
}

/** `null` when the repository has no positive frontend signal. Order is
 *  deliberate: a framework dep is stronger than a style dep, which is stronger
 *  than a file that could be a one-off. */
export async function detectFrontendEvidence(
  projectRoot: string,
  deps: Record<string, string>
): Promise<string | null> {
  const framework = firstDeclared(deps, FRONTEND_FRAMEWORK_DEPS);
  if (framework !== null) return framework;
  const style = firstDeclared(deps, FRONTEND_STYLE_DEPS);
  if (style !== null) return style;
  return assetUnderApplicationRoots(projectRoot);
}

/** The two report signals this probe contributes, so the archetype service does
 *  not spend its line budget rebuilding them. */
export function frontendSignals(hasBin: boolean, evidence: string | null): ArchetypeSignal[] {
  return [
    {
      name: 'bin',
      matched: hasBin,
      detail: hasBin ? 'package.json declares bin' : 'no bin in package.json'
    },
    {
      name: 'frontend-evidence',
      matched: evidence !== null,
      detail:
        evidence ?? 'no frontend framework, style dependency, or css/html under an application root'
    }
  ];
}
