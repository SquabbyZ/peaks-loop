import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import {
  buildAuditReport,
  DesignAuditWriteEscapeError,
  renderAuditJson,
  renderAuditMarkdown,
  writeAuditReport
} from '../../../src/services/design/audit/audit-report.js';

declareDimensions('tests/unit/design/audit-report-guards.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const TREE = join(FIXTURES, 'three-page-tree');
const META = {
  appRoot: 'three-page-tree',
  rid: 'r7',
  generatedAt: '2026-11-25T00:00:00.000Z'
};
const META_WITHOUT_RID = { appRoot: 'no-rid', generatedAt: META.generatedAt };

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** A directory link is a junction on Windows and a symlink elsewhere. */
const DIR_LINK_TYPE: 'junction' | 'dir' = process.platform === 'win32' ? 'junction' : 'dir';

/** Whether this host can create a directory link at all (skipIf gate). */
function canCreateDirLink(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-audit-link-probe-'));
  try {
    mkdirSync(join(dir, 'target'));
    symlinkSync(join(dir, 'target'), join(dir, 'link'), DIR_LINK_TYPE);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DIR_LINKS = canCreateDirLink();

/** Remove a junction/symlink itself, never the directory it points at. */
function removeDirLink(link: string): void {
  try {
    if (process.platform === 'win32') rmdirSync(link);
    else unlinkSync(link);
  } catch {
    // Nothing left to remove; the root cleanup handles an ordinary directory.
  }
}

function reportOf(appRoot: string) {
  const result = runAuditProject({ appRoot });
  if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
  return buildAuditReport(result);
}

describe('Scenario: render — an untrusted page path cannot paint the report', () => {
  it('when a page path carries ESC[2J and a newline, should strip it from the heading', () => {
    // given: a POSIX page name carrying an erase sequence and a forged heading
    // when: the markdown report is rendered
    // then: no raw ESC survives and no line starts with the forged heading
    const hostile = 'pages/esc\u001b[2J\n## Forged section.tsx';
    const report = reportOf(TREE);
    const poisoned = {
      ...report,
      pages: report.pages.map((page, index) => (index === 0 ? { ...page, path: hostile } : page))
    };
    const markdown = renderAuditMarkdown(poisoned, META);
    expect(markdown).not.toContain('\u001b');
    expect(markdown).not.toContain('[2J');
    expect(markdown).not.toMatch(/^## Forged section/m);
    expect(markdown).toContain('### pages/esc ## Forged section.tsx — 95');
  });

  it('when an unmeasured file carries ESC[2J and a long name, should strip and cap it', () => {
    // given: an unmeasured item whose file is 400 bytes plus a forged heading
    // when: the markdown report is rendered
    // then: the line is one safe line and the file is bounded to the detail cap
    const hostile = `pages/${'z'.repeat(400)}\u001b[2J\n## Forged section.tsx`;
    const report = reportOf(TREE);
    const poisoned = {
      ...report,
      data: {
        ...report.data,
        unmeasured: report.data.unmeasured.map((item) => ({ ...item, file: hostile }))
      }
    };
    const markdown = renderAuditMarkdown(poisoned, META);
    expect(markdown).not.toContain('\u001b');
    expect(markdown).not.toContain('[2J');
    expect(markdown).not.toMatch(/^## Forged section/m);
    const line = markdown.split('\n').find((entry) => entry.startsWith('- spacing pages/')) ?? '';
    expect(line).not.toContain('z'.repeat(350));
    expect(line).toContain(':5 —');
  });
});

describe('Scenario: behavior — contrast is judged only by declared pairs', () => {
  it('when the contract declares no pairs, should render contrast as not judged', () => {
    // given: the state-tree contract whose pairs list is empty
    // when: the report is built and both renderers run
    // then: contrast is "not judged" (never a silent 100) in markdown and JSON
    const report = reportOf(join(FIXTURES, 'state-tree'));
    expect(report.dimensions.find((row) => row.dimension === 'contrast')).toMatchObject({
      judged: false,
      score: null,
      unmeasured: 1
    });
    const meta = { ...META_WITHOUT_RID, appRoot: 'state-tree' };
    expect(renderAuditMarkdown(report, meta)).toMatch(/^\| contrast \| not judged \|/m);
    const document = renderAuditJson(report, meta);
    expect(document.dimensions.find((row) => row.dimension === 'contrast')).toMatchObject({
      judged: false,
      score: null
    });
  });

  it('when the contract declares one passing pair, should render contrast as a judged 100', () => {
    // given: the three-page contract's ink-on-paper pair
    // when: the report is built
    // then: contrast is judged and scores 100
    const report = reportOf(TREE);
    expect(report.dimensions.find((row) => row.dimension === 'contrast')).toMatchObject({
      judged: true,
      score: 100,
      hard: 0,
      unmeasured: 0
    });
    expect(renderAuditMarkdown(report, META)).toMatch(/^\| contrast \| 100 \|/m);
  });
});

describe('Scenario: integration — the write path refuses an escape', () => {
  it.skipIf(!DIR_LINKS)(
    'when design/ is a junction outside the app root, should refuse the escape by name',
    async () => {
      // given: an app root whose design/ is a directory link to a sibling outside it
      // when: the pair is written
      // then: the named escape error is thrown and nothing lands outside the root
      const root = mkdtempSync(join(tmpdir(), 'peaks-audit-junction-'));
      const outside = mkdtempSync(join(tmpdir(), 'peaks-audit-outside-'));
      roots.push(root, outside);
      const link = join(root, 'design');
      symlinkSync(outside, link, DIR_LINK_TYPE);
      try {
        await expect(
          writeAuditReport({ appRoot: root, report: reportOf(TREE), rid: 'r7' })
        ).rejects.toBeInstanceOf(DesignAuditWriteEscapeError);
        expect(readdirSync(outside)).toEqual([]);
      } finally {
        removeDirLink(link);
      }
    }
  );
});

describe('Scenario: a11y — the named refusal is readable', () => {
  it('when the write escape is thrown, should name the target and the app root', () => {
    // given: a target that resolved outside an app root
    // when: the named error is built
    // then: its message names both paths so a person can act on it
    const error = new DesignAuditWriteEscapeError('/tmp/outside/audit.md', '/tmp/app');
    expect(error.code).toBe('DESIGN_AUDIT_WRITE_ESCAPE');
    expect(error.message).toContain('/tmp/outside/audit.md');
    expect(error.message).toContain('/tmp/app');
  });
});
