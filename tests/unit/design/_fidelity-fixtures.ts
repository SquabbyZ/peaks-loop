/**
 * Shared scaffolding for the fidelity oracle tests: the fixture token contract,
 * synthetic captured geometries that carry `data-peaks-object`, a capture seam
 * that answers by URL, and a throwaway project that copies the contract.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProgramIO } from '../../../src/cli/cli-helpers.js';
import type { FidelityCaptureFn } from '../../../src/services/design/fidelity-oracle.js';
import {
  readSpacingTokens,
  type SpacingToken
} from '../../../src/services/design/layout/layout-tokens.js';
import type {
  LayoutElement,
  LayoutGeometry,
  Viewport
} from '../../../src/services/design/layout/layout-geometry.js';

export const FIXTURE_DESIGN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/design/fidelity/design'
);
export const TOKENS: readonly SpacingToken[] = readSpacingTokens(FIXTURE_DESIGN);
export const IMPLEMENTATION_URL = 'http://127.0.0.1:3000/';
export const PROTOTYPE_URL = 'http://127.0.0.1:4001/';
export const VIEWPORT: Viewport = { width: 390, height: 844 };
export const SESSION = 'sid-1';

const roots: string[] = [];

export function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-fidelity-'));
  roots.push(root);
  mkdirSync(join(root, 'design'), { recursive: true });
  copyFileSync(join(FIXTURE_DESIGN, 'tokens.json'), join(root, 'design', 'tokens.json'));
  return root;
}

export function disposeProjects(): void {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
}

export function captureIo(): { io: ProgramIO; out: () => string } {
  const lines: string[] = [];
  return {
    io: { stdout: (text) => lines.push(text), stderr: (text) => lines.push(text) },
    out: () => lines.join('\n')
  };
}

type ElementInput = {
  parent: number;
  tag: string;
  box: readonly [number, number, number, number];
  text?: string;
  paddingLeft?: number;
  object?: string;
};

export function element(input: ElementInput): LayoutElement {
  const [left, top, right, bottom] = input.box;
  return {
    parent: input.parent,
    tag: input.tag,
    ariaRole: null,
    display: 'block',
    ownText: input.text ?? '',
    text: input.text ?? '',
    box: { left, top, right, bottom },
    padding: { top: 0, right: 0, bottom: 0, left: input.paddingLeft ?? 0 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    ...(input.object === undefined ? {} : { peaks: { object: input.object } }),
    painted: false
  };
}

/** One body, one padded section, and three objects stacked under it. */
export function baseGeometry(viewport: Viewport = VIEWPORT): LayoutGeometry {
  return {
    route: '/',
    viewport,
    captureVersion: '2',
    elements: [
      element({ parent: -1, tag: 'html', box: [0, 0, 390, 300] }),
      element({ parent: 0, tag: 'body', box: [0, 0, 390, 300] }),
      element({ parent: 1, tag: 'section', box: [0, 0, 390, 300], paddingLeft: 16 }),
      element({ parent: 2, tag: 'h2', box: [16, 16, 374, 40], text: 'Reports', object: 'title' }),
      element({ parent: 2, tag: 'p', box: [16, 50, 374, 80], text: 'Body', object: 'body' }),
      element({
        parent: 2,
        tag: 'button',
        box: [16, 100, 120, 140],
        text: 'Load more',
        object: 'action'
      })
    ]
  };
}

/** The same page with the parent padding moved from space.md to space.roomy. */
export function roomierGeometry(): LayoutGeometry {
  const geometry = baseGeometry();
  return {
    ...geometry,
    elements: geometry.elements.map((entry, index) => {
      if (index === 2) return { ...entry, padding: { ...entry.padding, left: 24 } };
      if (index > 2) {
        return {
          ...entry,
          box: { ...entry.box, left: entry.box.left + 8, right: entry.box.right + 8 }
        };
      }
      return entry;
    })
  };
}

export function withoutObject(geometry: LayoutGeometry, objectId: string): LayoutGeometry {
  return {
    ...geometry,
    elements: geometry.elements.map((entry) => {
      if (entry.peaks?.object !== objectId) return entry;
      const copy: LayoutElement = { ...entry };
      delete copy.peaks;
      return copy;
    })
  };
}

/** A seam that answers the implementation URL with one geometry and the rest with another. */
export function captureBoth(
  implementationUrl: string,
  prototype: () => LayoutGeometry,
  implementation: () => LayoutGeometry
): { capture: FidelityCaptureFn; calls: () => number } {
  let calls = 0;
  const capture: FidelityCaptureFn = async (input) => {
    calls += 1;
    const geometry = input.url === implementationUrl ? implementation() : prototype();
    return {
      ok: true,
      page: {
        geometry: { ...geometry, route: input.route, viewport: input.viewport },
        html: ''
      }
    };
  };
  return { capture, calls: () => calls };
}

export function envelopeOf(out: string): Record<string, unknown> {
  return JSON.parse(out) as Record<string, unknown>;
}

export function markdownAt(root: string): string {
  return readFileSync(
    join(root, '.peaks', '_runtime', SESSION, 'design', 'fidelity', 'root.md'),
    'utf8'
  );
}

export function jsonAt(root: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(root, '.peaks', '_runtime', SESSION, 'design', 'fidelity', 'root.json'),
      'utf8'
    )
  ) as Record<string, unknown>;
}

export type ViewportReport = {
  viewport: string;
  verdict: string;
  score: number;
  anchorScore: number;
  tokenScore: number;
  paired: number;
  missing: number;
  extra: number;
};

export type FidelityData = {
  verdict: string;
  reason: string | null;
  viewports: ViewportReport[];
  failures: Array<Record<string, string>>;
  prototype: { served: { url: string; loopback: boolean } | null; sha256: string } | null;
};

/** Write one prototype file into a project that a capture test can serve. */
export function writePrototype(root: string, html: string): string {
  const path = join(root, 'prototype.html');
  writeFileSync(path, html, 'utf8');
  return path;
}
