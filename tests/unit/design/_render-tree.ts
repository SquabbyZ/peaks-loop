/**
 * A minimal one-page UI tree with a design contract, for the S8 render tests.
 *
 * The tree is built under the OS temp directory (never inside the repository),
 * so a test can run the real project reader end to end without touching a
 * fixture. `cleanupRenderTrees` removes everything a test file created.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type RenderTreeOptions = {
  /** Token name → `#rrggbb`; the `color` group of `tokens.json`. */
  color: Record<string, string>;
  /** Declared contrast pairs, `[{ fg, bg, large? }]`. */
  pairs?: readonly { fg: string; bg: string; large?: boolean }[];
  /** The contract's own visible ΔE step, when it declares one. */
  visibleDeltaE?: number;
  /** Extra route files (app-relative under `pages/`), e.g. `about.tsx`. */
  extraPages?: readonly string[];
};

const roots: string[] = [];

/** Build one temp tree; the caller removes it with `cleanupRenderTrees`. */
export function makeRenderTree(options: RenderTreeOptions): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-render-tree-'));
  roots.push(root);
  mkdirSync(join(root, 'design'), { recursive: true });
  mkdirSync(join(root, 'pages'), { recursive: true });
  writeFileSync(
    join(root, 'design', 'paved-road.json'),
    JSON.stringify({ schemaVersion: 1, pageRoots: ['pages'], componentEntrypoints: [] }),
    'utf8'
  );
  writeFileSync(
    join(root, 'design', 'tokens.json'),
    JSON.stringify({
      color: Object.fromEntries(
        Object.entries(options.color).map(([name, value]) => [
          name,
          { $value: value, $type: 'color' }
        ])
      ),
      ...(options.pairs === undefined ? {} : { pairs: options.pairs }),
      ...(options.visibleDeltaE === undefined ? {} : { visibleDeltaE: options.visibleDeltaE })
    }),
    'utf8'
  );
  writeFileSync(
    join(root, 'pages', 'index.tsx'),
    'export function Page() { return <h1>Page</h1>; }\n',
    'utf8'
  );
  for (const extra of options.extraPages ?? []) {
    writeFileSync(
      join(root, 'pages', extra),
      'export function Extra() { return <h1>Extra</h1>; }\n',
      'utf8'
    );
  }
  return root;
}

/** Remove every temp tree this file created. */
export function cleanupRenderTrees(): void {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
}
