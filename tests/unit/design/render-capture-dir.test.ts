import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { runDesignAudit } from '../../../src/cli/commands/design-audit-command.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import {
  buildAuditReport,
  renderAuditMarkdown
} from '../../../src/services/design/audit/audit-report.js';
import {
  captureMatchesRoute,
  readRenderDir
} from '../../../src/services/design/audit/render/render-captures.js';
import { fiveFamilyPng, RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';
import { cleanupRenderTrees, makeRenderTree } from './_render-tree.js';

declareDimensions('tests/unit/design/render-capture-dir.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

const roots: string[] = [];

afterEach(() => {
  cleanupRenderTrees();
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/** One probe-layout capture directory under `root`. */
function captureDir(root: string, slug: string): string {
  const dir = join(root, slug, 'screenshots');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'full-page.png'), fiveFamilyPng());
  return dir;
}

/** Whether this host can create a file symlink at all (skipIf gate). */
function canCreateFileLink(): boolean {
  const dir = tempDir('peaks-render-link-probe-');
  try {
    writeFileSync(join(dir, 'target'), 'x');
    symlinkSync(join(dir, 'target'), join(dir, 'link'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FILE_LINKS = canCreateFileLink();

describe('Scenario: render — the capture directory is bounded and contained', () => {
  it('when a probe directory is read, should map its slug and relative capture path', () => {
    // given: <root>/127-0-0-1-7421-about/screenshots/full-page.png
    // when: the directory is read
    // then: one capture with its probe slug and a render-relative path
    const root = tempDir('peaks-render-dir-');
    captureDir(root, '127-0-0-1-7421-about');
    const read = readRenderDir({ dir: root, appRoot: root });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.captures).toHaveLength(1);
    expect(read.captures[0]?.slug).toBe('127-0-0-1-7421-about');
    expect(read.captures[0]?.capture).toBe('127-0-0-1-7421-about/screenshots/full-page.png');
    expect(read.found).toBe(1);
    expect(read.truncated).toBe(false);
  });

  it('when more captures exist than the frame bound, should truncate and report it', () => {
    // given: two capture directories and a bound of one
    // when: the directory is read
    // then: one capture is returned, the rest are counted
    const root = tempDir('peaks-render-bound-');
    captureDir(root, '127-0-0-1-7421-about');
    captureDir(root, '127-0-0-1-7421-channels');
    const read = readRenderDir({ dir: root, appRoot: root, maxFrames: 1 });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.captures).toHaveLength(1);
    expect(read.found).toBe(2);
    expect(read.truncated).toBe(true);
  });

  it('when a relative directory resolves outside the app root, should refuse by name', () => {
    // given: a sibling directory reachable only through `..`
    // when: it is passed as a relative --render
    // then: the read refuses with the escape code, never reads it
    const parent = tempDir('peaks-render-escape-');
    const appRoot = join(parent, 'app');
    const outside = join(parent, 'outside');
    mkdirSync(appRoot, { recursive: true });
    captureDir(outside, '127-0-0-1-7421-about');
    const read = readRenderDir({ dir: join('..', 'outside'), appRoot });
    expect(read).toMatchObject({ ok: false, code: 'DESIGN_AUDIT_RENDER_ESCAPE' });
  });

  it.skipIf(!FILE_LINKS)(
    'when a capture file is a symlink outside the directory, should refuse by name',
    () => {
      // given: <root>/<slug>/screenshots/full-page.png is a link to an outside file
      // when: the directory is read
      // then: the resolved file escapes the render root and is refused, never read
      const root = tempDir('peaks-render-filelink-');
      const outside = tempDir('peaks-render-outside-');
      const target = join(outside, 'full-page.png');
      writeFileSync(target, fiveFamilyPng());
      const dir = join(root, '127-0-0-1-7421-about', 'screenshots');
      mkdirSync(dir, { recursive: true });
      symlinkSync(target, join(dir, 'full-page.png'), 'file');
      const read = readRenderDir({ dir: root, appRoot: root });
      expect(read).toMatchObject({ ok: false, code: 'DESIGN_AUDIT_RENDER_ESCAPE' });
      unlinkSync(join(dir, 'full-page.png'));
    }
  );

  it('when the directory holds no capture, should refuse as empty', () => {
    // given: an existing but empty directory
    // when: it is read
    // then: the named empty refusal is returned
    const root = tempDir('peaks-render-empty-');
    expect(readRenderDir({ dir: root, appRoot: root })).toMatchObject({
      ok: false,
      code: 'DESIGN_AUDIT_RENDER_EMPTY'
    });
  });
});

describe('Scenario: behavior — a slug binds to the route it names', () => {
  it('when the page route is slugged, should match the host-prefixed directory', () => {
    // given: the pilot's directory names and derived routes
    // when: each slug is matched
    // then: the route tail matches and a host-only slug is the root page
    expect(captureMatchesRoute('127-0-0-1-7421-about', '/about')).toBe(true);
    expect(
      captureMatchesRoute(
        '127-0-0-1-7421-channels-components-channel-type-badge',
        '/channels/components/channel-type-badge'
      )
    ).toBe(true);
    expect(captureMatchesRoute('localhost-7421', '/')).toBe(true);
    expect(captureMatchesRoute('127-0-0-1-7421-about', '/channels')).toBe(false);
  });

  it('when a capture matches no page, should record the read gap', () => {
    // given: a one-page tree and a capture for a different route
    // when: the project is audited
    // then: the capture is named in a read gap, not silently dropped
    const root = makeRenderTree({ color: { ink: '#111111' } });
    const result = runAuditProject({
      appRoot: root,
      render: [
        { png: fiveFamilyPng(), capture: 'x/full-page.png', slug: '127-0-0-1-7421-elsewhere' }
      ]
    });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    expect(result.state.readGaps).toContain('1 capture(s) matched no page: x/full-page.png');
    expect(result.render.captures[0]).toMatchObject({ boundTo: null, decoded: true });
  });
});

describe('Scenario: integration — --render is the CLI path to the render dimensions', () => {
  it('when --render is supplied, should audit the bound page and report the capture', async () => {
    // given: a one-page tree and a capture directory named for the root route
    // when: the audit runs through the CLI with --render
    // then: the capture binds to pages/index.tsx and the render row is judged
    const root = makeRenderTree({ color: { red: '#e11d48', blue: '#2563eb' } });
    const captures = join(root, 'captures');
    captureDir(captures, '127-0-0-1-7421');
    const { io, captured } = makeCapturedIo();
    await runDesignAudit({ project: root, render: captures, json: true }, io);
    const parsed = JSON.parse(captured.text()) as {
      ok: boolean;
      data: {
        render: { captures: Array<{ capture: string; boundTo: string | null; maskShare: number }> };
        dimensions: Array<{ dimension: string; judged: boolean }>;
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.render.captures).toHaveLength(1);
    expect(parsed.data.render.captures[0]).toMatchObject({
      capture: '127-0-0-1-7421/screenshots/full-page.png',
      boundTo: 'pages/index.tsx'
    });
    expect(parsed.data.render.captures[0]?.maskShare).toBeGreaterThan(0);
    expect(parsed.data.dimensions.find((row) => row.dimension === 'palette')?.judged).toBe(true);
  });

  it('when --render points at an empty directory, should refuse before any audit', async () => {
    // given: an existing but empty capture directory
    // when: the audit runs with --render
    // then: it exits 2 with the named empty reason
    const root = makeRenderTree({ color: { red: '#e11d48' } });
    mkdirSync(join(root, 'captures'), { recursive: true });
    const saved = process.exitCode;
    const { io, captured } = makeCapturedIo();
    try {
      await runDesignAudit({ project: root, render: join(root, 'captures'), json: true }, io);
      const parsed = JSON.parse(captured.text()) as { ok: boolean; code?: string };
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe('DESIGN_AUDIT_RENDER_EMPTY');
      expect(process.exitCode).toBe(2);
    } finally {
      process.exitCode = saved;
    }
  });

  it('when the report is written, should name each capture and the uncaptured pages', () => {
    // given: a one-page tree with one bound capture
    // when: the markdown report is rendered
    // then: the render section names the file, its mask and the page coverage
    const root = makeRenderTree({
      color: { red: '#e11d48', blue: '#2563eb' },
      extraPages: ['about.tsx']
    });
    const result = runAuditProject({
      appRoot: root,
      render: [{ png: fiveFamilyPng(), capture: 'a/full-page.png', slug: '127-0-0-1-7421' }]
    });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const markdown = renderAuditMarkdown(buildAuditReport(result), {
      appRoot: root,
      generatedAt: '2026-11-26T00:00:00.000Z'
    });
    expect(markdown).toContain('## Render evidence');
    expect(markdown).toContain('a/full-page.png — non-app mask');
    expect(markdown).toContain('bound to pages/index.tsx');
    expect(markdown).toContain('page units without a capture: 1 of 2');
  });
});
