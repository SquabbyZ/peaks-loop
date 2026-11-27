/**
 * Shared readers for the layout graph tests: the measured fixture documents,
 * the token contract beside them, and the entry built from one of them.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProgramIO } from '../../../src/cli/cli-helpers.js';
import { buildLayoutIndex } from '../../../src/services/design/layout/layout-align.js';
import {
  buildLayoutEntry,
  type LayoutEntry
} from '../../../src/services/design/layout/layout-graph.js';
import { serializeEntry } from '../../../src/services/design/layout/layout-graph-ascii.js';
import type { LayoutGeometry } from '../../../src/services/design/layout/layout-geometry.js';
import { readSpacingTokens } from '../../../src/services/design/layout/layout-tokens.js';

export const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/design/layout'
);
export const TOKENS = readSpacingTokens(FIXTURES);

const projects: string[] = [];

export function geometryOf(name: string): LayoutGeometry {
  return JSON.parse(
    readFileSync(join(FIXTURES, `geometry-${name}.json`), 'utf8')
  ) as LayoutGeometry;
}

export function entryOf(name: string, state = 'default'): LayoutEntry {
  const geometry = geometryOf(name);
  return buildLayoutEntry({
    index: buildLayoutIndex({ geometry, spacingTokens: TOKENS }),
    geometry,
    state,
    tokens: TOKENS
  });
}

export function textOf(entry: LayoutEntry): string {
  const written = serializeEntry(entry);
  if (!written.ok) throw new Error(written.reason);
  return written.text;
}

/** A throwaway project with the fixture token contract under `design/`. */
export function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-layout-graph-'));
  projects.push(root);
  mkdirSync(join(root, 'design'), { recursive: true });
  copyFileSync(join(FIXTURES, 'tokens.json'), join(root, 'design', 'tokens.json'));
  return root;
}

export function disposeProjects(): void {
  while (projects.length > 0) rmSync(projects.pop() as string, { recursive: true, force: true });
}

/** A printer pair a CLI runner can be exercised with. */
export function captureIo(): { io: ProgramIO; out: () => string; err: () => string } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    io: { stdout: (text) => lines.push(text), stderr: (text) => errors.push(text) },
    out: () => lines.join('\n'),
    err: () => errors.join('\n')
  };
}
