import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  DEFAULT_MAX_IMPORTS,
  readImportClosure
} from '../../../src/services/design/audit/import-closure.js';
import { readCssProject } from '../../../src/services/design/audit/audit-css.js';
import { DEFAULT_MAX_PAGES, pagePaths } from '../../../src/services/design/audit/audit-pages.js';
import {
  createSourceCache,
  MAX_SOURCE_BYTES
} from '../../../src/services/design/audit/source-cache.js';
import { sourceView } from '../../../src/services/design/audit/source-view.js';
import { walkFiles } from '../../../src/services/design/audit/audit-walk.js';
import { isWindows } from '../../../src/shared/platform.js';

declareDimensions('tests/unit/design/audit-source-cache.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

const canSymlink = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), 'peaks-symlink-probe-'));
  try {
    writeFileSync(join(probe, 'target.txt'), 'x', 'utf8');
    symlinkSync(join(probe, 'target.txt'), join(probe, 'link.txt'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `peaks-${prefix}-`));
  roots.push(root);
  return root;
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text, 'utf8');
}

/** A tree with one page importing a component the second page also imports. */
function sharedClosureTree(): string {
  const root = makeRoot('closure');
  write(
    root,
    'src/pages/a.tsx',
    "import { Row } from '../components/Row';\nexport const A = () => <Row />;\n"
  );
  write(
    root,
    'src/pages/b.tsx',
    "import { Row } from '../components/Row';\nexport const B = () => <Row />;\n"
  );
  write(root, 'src/components/Row.tsx', 'export const Row = () => <tr />;\n');
  return root;
}

describe('Scenario: render — the per-run cache returns one object per real file', () => {
  it('when a file is read twice, should return the same AuditSource object', () => {
    // given: a tree with one module
    // when: the run cache reads it twice
    // then: the second read is the cached object, not a second copy
    const root = sharedClosureTree();
    const cache = createSourceCache(root);
    const first = cache.read('src/components/Row.tsx');
    const second = cache.read('src/components/Row.tsx');
    expect(first.kind).toBe('read');
    expect(second.kind).toBe('read');
    if (first.kind !== 'read' || second.kind !== 'read') return;
    expect(second.source).toBe(first.source);
    expect(sourceView(first.source)).toBe(sourceView(second.source));
  });

  it('when two pages import the same component, should share its source object', () => {
    // given: two pages whose closure reaches the same Row component
    // when: both closures are read through ONE cache
    // then: the shared component is one object, so its view is stripped once
    const root = sharedClosureTree();
    const cache = createSourceCache(root);
    const read = (file: string): ReturnType<typeof readImportClosure> => {
      const page = cache.read(file);
      if (page.kind !== 'read') throw new Error(`unreadable ${file}`);
      return readImportClosure({ appRoot: root, file, source: page.source.source, cache });
    };
    const a = read('src/pages/a.tsx');
    const b = read('src/pages/b.tsx');
    expect(a.sources).toHaveLength(1);
    expect(b.sources).toHaveLength(1);
    expect(a.sources[0]).toBe(b.sources[0]);
  });
});

describe('Scenario: behavior — the bounds keep a hostile tree finite', () => {
  it('when the closure bound is read, should default to 400 modules', () => {
    // given: the bound a page closure starts from
    // when: it is read
    // then: it covers a real component graph instead of hiding half of it
    expect(DEFAULT_MAX_IMPORTS).toBe(400);
    expect(DEFAULT_MAX_PAGES).toBe(2000);
  });

  it('when a source exceeds the byte cap, should skip it and name the gap', () => {
    // given: one file one byte over the cap
    // when: the cache reads it
    // then: it is not loaded and the caller gets an oversize result
    const root = makeRoot('oversize');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'huge.ts'), Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x61));
    const read = createSourceCache(root).read('src/huge.ts');
    expect(read.kind).toBe('oversize');
    if (read.kind !== 'oversize') return;
    expect(read.bytes).toBeGreaterThan(MAX_SOURCE_BYTES);
  });

  it('when the page bound is hit, should keep a prefix and report the truncation', () => {
    // given: a tree with two markup pages and a one-page budget
    // when: the page list is built
    // then: one page survives and the gap names the bound and the total
    const root = sharedClosureTree();
    write(root, 'src/pages/c.tsx', 'export const C = () => <p>C</p>;\n');
    const gaps: string[] = [];
    const paths = pagePaths(
      { appRoot: root, roots: ['.'], declaredRoots: false, exclude: [], cssFiles: new Map() },
      { gaps, maxPages: 1 }
    );
    expect(paths).toHaveLength(1);
    expect(gaps).toEqual(['page units stopped at the 1-page bound (4 found)']);
  });
});

describe('Scenario: integration — a symlink out of the app root is skipped and named', () => {
  it.skipIf(!canSymlink)(
    'when an import resolves through an escaping symlink, should not read it',
    () => {
      // given: `outside.tsx` is a symlink to a file outside the app root
      // when: the closure resolves `./outside`
      // then: the target is not read and the escape is reported
      const root = makeRoot('symlink-import');
      write(root, 'secret.ts', 'export const leaked = "SECRET";\n');
      write(root, 'app/src/pages/list.tsx', "import { leaked } from './outside';\n");
      mkdirSync(join(root, 'app', 'src', 'pages'), { recursive: true });
      symlinkSync(
        join(root, 'secret.ts'),
        join(root, 'app', 'src', 'pages', 'outside.tsx'),
        'file'
      );
      const page = "import { leaked } from './outside';\n";
      const closure = readImportClosure({
        appRoot: join(root, 'app'),
        file: 'src/pages/list.tsx',
        source: page
      });
      expect(closure.sources).toEqual([]);
      expect(closure.escapes.join('\n')).toContain('symlink escapes app root');
      expect(closure.sources.map((entry) => entry.source).join('')).not.toContain('SECRET');
    }
  );

  it.skipIf(!canSymlink)(
    'when a stylesheet import escapes, should report it in the CSS gaps',
    () => {
      // given: a stylesheet importing `./secret`, a symlink outside the app root
      // when: the project's stylesheets are read
      // then: it is not read and the skipped list names the escape
      const root = makeRoot('symlink-css');
      write(root, 'secret.scss', '.secret { color: red; }\n');
      write(root, 'app/styles/main.scss', "@use './secret';\n.main { color: blue; }\n");
      symlinkSync(join(root, 'secret.scss'), join(root, 'app', 'styles', 'secret.scss'), 'file');
      const project = readCssProject({ appRoot: join(root, 'app'), pageRoots: ['styles'] });
      expect(project.sources.map((source) => source.source).join('')).not.toContain('.secret');
      expect(project.skipped.join('\n')).toContain('symlink escapes app root');
    }
  );
});

describe('Scenario: a11y — an unreadable directory is a gap, never a clean read', () => {
  it.skipIf(isWindows)('when a directory cannot be read, should report it in the gaps', () => {
    // given: a locked subdirectory under the walked root
    // when: the walk runs
    // then: the path is a gap so a partial read cannot be reported clean
    const root = makeRoot('unreadable');
    write(root, 'src/ok.tsx', 'export const Ok = () => <p>ok</p>;\n');
    mkdirSync(join(root, 'src', 'locked'), { recursive: true });
    chmodSync(join(root, 'src', 'locked'), 0o000);
    try {
      const gaps: string[] = [];
      walkFiles(root, '.', new Set(['.tsx']), { gaps });
      expect(gaps.join('\n')).toContain('unreadable directory');
      expect(gaps.join('\n')).toContain('src/locked');
    } finally {
      chmodSync(join(root, 'src', 'locked'), 0o755);
    }
  });
});
