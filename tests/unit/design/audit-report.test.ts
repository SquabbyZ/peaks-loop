import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import {
  buildAuditReport,
  DesignAuditPathError,
  renderAuditJson,
  renderAuditMarkdown,
  writeAuditReport
} from '../../../src/services/design/audit/audit-report.js';

declareDimensions('tests/unit/design/audit-report.test.ts', [
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

function reportOf(appRoot: string) {
  const result = runAuditProject({ appRoot });
  if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
  return buildAuditReport(result);
}

describe('Scenario: render — the three-page report is a stable snapshot', () => {
  it('when the three-page fixture is rendered, should match the recorded markdown', () => {
    // given: the clean / spacing / hard-colour tree and a fixed clock
    // when: the markdown report is rendered
    // then: the scope, ratio columns, top-3 fixes and unmeasured list match the snapshot
    const report = reportOf(TREE);
    expect(renderAuditMarkdown(report, META)).toMatchInlineSnapshot(`
      "schemaVersion: 7
      rid: r7
      generatedAt: 2026-11-25T00:00:00.000Z
      audit-verdict: findings

      ## Design audit

      - app root: three-page-tree
      - overall score: 0 (the worst page, never an average)
      - scope: scored 3 page units under pageRoots pages; no UI source outside them was read; route entries only (a pages/routes/app path segment, or a root-level index module); value dimensions (spacing, type, colour, surface) read each page plus its import closure (3 distinct files; a shared component counts once per page that imports it)
      - runtime state scored: default; skipped: none | read gaps: none | truncated: no

      ## Dimensions

      - ratio dimensions score the on-contract share of the values they judged; a null score means every value was unmeasured.
      - a ratio marked "low sample" judged fewer than 5 values: its ratio is reported, but only a hard finding in it can set a page or the overall score.
      - a cost dimension the audit had nothing to judge renders "not judged", never 100.
      - finding rows count page views: a shared component's defect appears once per page that imports it; "distinct" (and a fix's "sites") counts the distinct file:line defects.
      - cost dimensions lose their documented cost per hard/soft finding.

      | dimension | score | measured | on-contract | distinct | hard | soft | unmeasured |
      | --- | --- | --- | --- | --- | --- | --- | --- |
      | spacing | 67 | 9 | 6 | 2 | 0 | 3 | 1 |
      | type | 100 | 15 | 15 | 0 | 0 | 0 | 0 |
      | color | 0 (low sample) | 1 | 0 | 1 | 1 | 0 | 0 |
      | contrast | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
      | surface | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
      | hierarchy | 95 | 0 | 0 | 2 | 0 | 2 | 0 |
      | a11y | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
      | states | not judged | 0 | 0 | 0 | 0 | 0 | 0 |
      | palette | not judged | 0 | 0 | 0 | 0 | 0 | 0 |
      | overflow | not judged | 0 | 0 | 0 | 0 | 0 | 1 |

      ## Render evidence

      - no capture was supplied: every render dimension is absent, not 0.

      ## Pages

      ### pages/clean.tsx — 95

      - (soft) 本页没有 h1 标题，第一眼看不出页面的重点。
        \`pages/clean.tsx:1 heading:h1 missing\`

      ### pages/spacing.tsx — 95

      - (soft) 第 3 行的 gap 间距是 gap-[9px]，不在设计刻度上，最近的刻度是 8px。
        \`pages/spacing.tsx:3 gap:gap-[9px] not in tokenScale.space\`
      - (soft) 第 3 行的 padding 间距是 p-[13px]，不在设计刻度上，最近的刻度是 12px。
        \`pages/spacing.tsx:3 padding:p-[13px] not in tokenScale.space\`
      - (soft) 第 4 行的 padding 间距是 p-[15px]，不在设计刻度上，最近的刻度是 16px。
        \`pages/spacing.tsx:4 padding:p-[15px] not in tokenScale.space\`
      - (soft) 本页没有 h1 标题，第一眼看不出页面的重点。
        \`pages/spacing.tsx:1 heading:h1 missing\`

      ### pages/theme.css — 0

      - (hard) 第 3 行的 color 用了原始色值 #ff00aa，契约里没有对应的颜色 token，应该改用 token。
        \`pages/theme.css:3 color:#ff00aa raw colour not a declared token\`

      ## Top 3 fixes

      1. hard × 1 view — color (1 site)
         第 3 行的 color 用了原始色值 #ff00aa，契约里没有对应的颜色 token，应该改用 token。
         \`pages/theme.css:3 color:#ff00aa raw colour not a declared token\`
      2. soft × 2 views — hierarchy (2 sites)
         本页没有 h1 标题，第一眼看不出页面的重点。
         \`pages/clean.tsx:1 heading:h1 missing\`
      3. soft × 1 view — spacing (1 site)
         第 3 行的 gap 间距是 gap-[9px]，不在设计刻度上，最近的刻度是 8px。
         \`pages/spacing.tsx:3 gap:gap-[9px] not in tokenScale.space\`

      ## Unmeasured

      - responsive overflow — needs the rendered page (S8) (known gap: the capture carries no scroll/client/overflow geometry: designlang extract exposes only 2–5 top-level regions[].bounds, --width 390 still reports w=1280, and --responsive-shots is a dead flag in 13.4.1; a real two-viewport capture is a new capture mode measured at ~7 s/page)
      - an over-cap tsconfig declares no alias table, so aliased imports are not followed (the unread config is named in the runtime state) (known gap: path aliases are an optional hint, not the design contract, so the audit still runs)
      - overflow design/probe:1 — 页面在手机宽度下是否溢出无法判定：截图里没有 scroll/client/overflow 几何信息（extract 只有 2–5 个顶层 regions[].bounds，--width 390 仍报告 w=1280，--responsive-shots 在 designlang 13.4.1 是空操作），双视口截图是每页约 7 秒的新采集模式，本切片没有实现。
        \`design/probe:1 overflow:responsive-overflow unmeasured (the capture carries no scroll/client/overflow geometry: designlang extract exposes only 2–5 top-level regions[].bounds, --width 390 still reports w=1280, and --responsive-shots is a dead flag in 13.4.1; a real two-viewport capture is a new cap…\`
      - spacing pages/spacing.tsx:5 — 第 5 行的 padding 是 calc(4px * 2)，它用了 calc()，源码里无法判断是否在刻度上。
        \`pages/spacing.tsx:5 padding:calc(4px * 2) unmeasured (calc())\`
      "
    `);
  });
});

describe('Scenario: render — contract text cannot paint the persisted report', () => {
  it('when a read gap carries an ESC sequence, should strip it from the state line', () => {
    // given: a report whose read-gap package name carries ESC[31m and a 5 KB name
    // when: the markdown is rendered
    // then: neither the sequence nor its printable tail reaches the state line
    const report = reportOf(TREE);
    const gaps = [`pages/x.tsx -> ${'x'.repeat(5000)}\u001b[31m (not followed)`];
    const poisoned = {
      ...report,
      data: { ...report.data, state: { ...report.data.state, readGaps: gaps } }
    };
    const markdown = renderAuditMarkdown(poisoned, META);
    const stateLine =
      markdown.split('\n').find((line) => line.startsWith('- runtime state scored:')) ?? '';
    expect(stateLine).not.toContain('\u001b');
    expect(stateLine).not.toContain('[31m');
    expect(stateLine).not.toContain('x'.repeat(400));
    expect(stateLine.length).toBeLessThanOrEqual(400);
  });

  it('when the scope note carries an ESC sequence, should strip it from the scope line', () => {
    // given: a scope whose note embeds a control sequence the contract supplied
    // when: the markdown is rendered
    // then: the durable line carries no raw ESC and no printable sequence tail
    const report = reportOf(TREE);
    const note = `${report.data.scope.note} evil\u001b[2Jroot`;
    const poisoned = { ...report, data: { ...report.data, scope: { ...report.data.scope, note } } };
    const markdown = renderAuditMarkdown(poisoned, META);
    const scopeLine = markdown.split('\n').find((line) => line.startsWith('- scope:')) ?? '';
    expect(scopeLine).not.toContain('\u001b');
    expect(scopeLine).not.toContain('[2J');
    expect(scopeLine).toContain('evilroot');
  });
});

describe('Scenario: behavior — the numbers are the worst page, never an average', () => {
  it('when the report is built, should expose the worst overall and the dimension table', () => {
    // given: the fixture tree and its scored report
    // when: the envelope data and dimension rows are read
    // then: the overall is the worst page and each row carries measured counts
    const report = reportOf(TREE);
    expect(report.overall).toBe(0);
    expect(report.data.verdict).toBe('findings');
    expect(report.data.pages.map((page) => [page.path, page.score])).toEqual([
      ['pages/clean.tsx', 95],
      ['pages/spacing.tsx', 95],
      ['pages/theme.css', 0]
    ]);
    expect(report.dimensions).toMatchObject([
      {
        dimension: 'spacing',
        score: 67,
        hard: 0,
        soft: 3,
        unmeasured: 1,
        measured: 9,
        onContract: 6
      },
      {
        dimension: 'type',
        score: 100,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 15,
        onContract: 15
      },
      {
        dimension: 'color',
        score: 0,
        hard: 1,
        soft: 0,
        unmeasured: 0,
        measured: 1,
        onContract: 0,
        lowSample: true
      },
      {
        dimension: 'contrast',
        score: 100,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'surface',
        score: 100,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'hierarchy',
        score: 95,
        hard: 0,
        soft: 2,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'a11y',
        score: 100,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'states',
        score: null,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'palette',
        score: null,
        hard: 0,
        soft: 0,
        unmeasured: 0,
        measured: 0,
        onContract: 0
      },
      {
        dimension: 'overflow',
        score: null,
        hard: 0,
        soft: 0,
        unmeasured: 1,
        measured: 0,
        onContract: 0
      }
    ]);
    // Review M1: the hard colour finding sets the page even though its ratio is
    // low-sample; the flag is still reported.
    const colorRow = report.dimensions.find((row) => row.dimension === 'color');
    expect(colorRow).toMatchObject({ score: 0, lowSample: true, judged: true, distinctSites: 1 });
    // Review K1: states had nothing data-bearing to judge — a label, never 100.
    const statesRow = report.dimensions.find((row) => row.dimension === 'states');
    expect(statesRow).toMatchObject({ judged: false, score: null });
  });

  it('when the report is built, should carry the page scope as data', () => {
    // given: a tree whose contract declares its page root
    // when: the envelope data is read
    // then: the scope says what was scored and how much was context only
    const report = reportOf(TREE);
    expect(report.data.scope).toMatchObject({
      pageRoots: ['pages'],
      pageRootsDeclared: true,
      scored: 3,
      context: 0
    });
    expect(report.data.scope.note).toContain('under pageRoots pages');
  });

  it('when fixes are ranked, should lead with the hard colour and keep three entries', () => {
    // given: the three-page fixture's findings
    // when: the top fixes are read
    // then: the hard colour is first and every entry carries the bilingual pair
    const report = reportOf(TREE);
    expect(report.data.topFixes).toHaveLength(3);
    expect(report.data.topFixes[0]).toMatchObject({ dimension: 'color', severity: 'hard' });
    for (const fix of report.data.topFixes) {
      expect(fix.humanText).toMatch(/[，。]/);
      expect(fix.techText).toMatch(/\.(?:tsx|css):\d+/);
    }
  });

  it('when the unmeasured gap is read, should name the reason and the file:line', () => {
    // given: the `calc()` spacing value the audit cannot judge
    // when: the unmeasured list is read
    // then: it is visible with its reason, not dropped and not a violation
    const report = reportOf(TREE);
    expect(report.data.unmeasured).toHaveLength(2);
    const spacing = report.data.unmeasured.find((item) => item.dimension === 'spacing');
    expect(spacing).toMatchObject({
      dimension: 'spacing',
      file: 'pages/spacing.tsx',
      line: 5
    });
    expect(spacing?.techText).toContain('calc()');
    // S8 Task 4: the fixed overflow row is exactly one gap, never a heuristic.
    const overflow = report.data.unmeasured.filter((item) => item.dimension === 'overflow');
    expect(overflow).toHaveLength(1);
    expect(overflow[0]?.techText).toContain('--responsive-shots is a dead flag in 13.4.1');
  });

  it('when the JSON document is rendered, should carry schemaVersion and per-page findings', () => {
    // given: the fixture report
    // when: the JSON sibling is rendered
    // then: the document carries the table, the findings, the scope and the version
    const document = renderAuditJson(reportOf(TREE), META);
    expect(document.schemaVersion).toBe(7);
    expect(document.render).toMatchObject({ captures: [], pageUnits: 3, pagesWithoutCapture: 3 });
    expect(document.rid).toBe('r7');
    expect(document.overall).toBe(0);
    expect(document.knownGaps.map((gap) => gap.id)).toContain('responsive-overflow');
    expect(document.scope).toMatchObject({ scored: 3, pageRootsDeclared: true });
    expect(document.dimensions).toHaveLength(10);
    expect(document.pages).toHaveLength(3);
    expect(document.pages[2]?.findings[0]?.severity).toBe('hard');
  });
});

describe('Scenario: integration — not-a-UI and missing-contract verdicts', () => {
  it('when the tree has no UI source, should produce no score at all', () => {
    // given: a `.ts`-only tree with no contract
    // when: the project is read and the report is built
    // then: the verdict is not-a-UI, scores are null and the verdict is not a pass
    const result = runAuditProject({ appRoot: join(FIXTURES, 'non-ui-tree') });
    expect(result.kind).toBe('not-a-ui-project');
    const report = buildAuditReport(result);
    expect(report.data.verdict).toBe('not-a-ui-project');
    expect(report.overall).toBeNull();
    expect(report.data.pages).toEqual([]);
    expect(report.dimensions).toEqual([]);
    expect(report.data.scope.note).toContain('not a UI project');
    expect(report.data.verdict).not.toBe('clean');
    const markdown = renderAuditMarkdown(report, {
      ...META_WITHOUT_RID,
      appRoot: 'non-ui-tree'
    });
    expect(markdown).toContain('not a UI project');
    expect(markdown).toContain('neither 0 nor a pass');
    expect(markdown).not.toContain('| dimension | score |');
    // Review K5: AC7 travels with EVERY report, including this one.
    expect(report.data.knownGaps.map((gap) => gap.id)).toEqual([
      'responsive-overflow',
      'alias-config-oversize'
    ]);
    expect(markdown).toContain('responsive overflow — needs the rendered page (S8)');
  });

  it('when a UI tree has no contract, should refuse with the missing files named', () => {
    // given: a `.tsx` tree with no `design/` directory
    // when: the project is read
    // then: it refuses and names both contract files
    const result = runAuditProject({ appRoot: join(FIXTURES, 'no-contract-tree') });
    expect(result).toMatchObject({
      kind: 'contract-missing',
      missing: ['tokens.json', 'paved-road.json']
    });
  });

  it('when a page reports a value gap, should carry the unmeasured list as data', () => {
    // given: the fixture's `calc()` spacing gap
    // when: the unmeasured list is read
    // then: the fixed AC7 known gap and the measured gap are separate entries
    const report = reportOf(TREE);
    expect(report.data.knownGaps).toEqual([
      {
        id: 'responsive-overflow',
        text: 'responsive overflow — needs the rendered page (S8)',
        reason:
          'the capture carries no scroll/client/overflow geometry: designlang extract exposes only 2–5 top-level regions[].bounds, --width 390 still reports w=1280, and --responsive-shots is a dead flag in 13.4.1; a real two-viewport capture is a new capture mode measured at ~7 s/page'
      },
      {
        id: 'alias-config-oversize',
        text: 'an over-cap tsconfig declares no alias table, so aliased imports are not followed (the unread config is named in the runtime state)',
        reason:
          'path aliases are an optional hint, not the design contract, so the audit still runs'
      }
    ]);
    expect(report.data.unmeasured.some((item) => item.dimension === 'spacing')).toBe(true);
  });

  it('when a page closure is truncated, should say so on the page heading', () => {
    // given: a report whose page hit its import-closure bound
    // when: the markdown is rendered
    // then: the page heading carries the truncation instead of hiding it
    const report = reportOf(TREE);
    const truncated = {
      ...report,
      pages: report.pages.map((page, index) => (index === 1 ? { ...page, truncated: true } : page))
    };
    const markdown = renderAuditMarkdown(truncated, META);
    expect(markdown).toContain('### pages/spacing.tsx — 95 (import closure truncated)');
  });

  it('when the pair is written, should create audit-<rid>.md and .json under design/', async () => {
    // given: a temporary app root and the fixture report
    // when: the report is written with a rid
    // then: both files exist and the markdown names the rid
    const root = mkdtempSync(join(tmpdir(), 'peaks-audit-report-'));
    roots.push(root);
    const written = await writeAuditReport({
      appRoot: root,
      report: reportOf(TREE),
      rid: 'r7',
      now: () => new Date('2026-11-25T00:00:00.000Z')
    });
    expect(written.markdownPath).toBe(join(root, 'design', 'audit-r7.md'));
    expect(written.jsonPath).toBe(join(root, 'design', 'audit-r7.json'));
    const markdown = readFileSync(written.markdownPath, 'utf8');
    expect(markdown).toContain('rid: r7');
    expect(markdown).toContain('audit-verdict: findings');
  });

  it('when the rid escapes the design directory, should refuse before writing', async () => {
    // given: a temporary app root and a traversal rid
    // when: the pair is written
    // then: it throws the named path error and creates nothing
    const root = mkdtempSync(join(tmpdir(), 'peaks-audit-path-'));
    roots.push(root);
    await expect(
      writeAuditReport({ appRoot: root, report: reportOf(TREE), rid: '../escape' })
    ).rejects.toBeInstanceOf(DesignAuditPathError);
  });
});

describe('Scenario: a11y — the report speaks to a person and to an agent', () => {
  it('when a hard finding is rendered, should show the plain sentence and the technical line', () => {
    // given: the fixture report with its hard colour finding
    // when: the markdown is rendered
    // then: the same finding appears in both voices
    const markdown = renderAuditMarkdown(reportOf(TREE), META);
    expect(markdown).toContain('用了原始色值 #ff00aa');
    expect(markdown).toContain('`pages/theme.css:3 color:#ff00aa raw colour not a declared token`');
  });

  it('when the state line renders, should name the state scored and the states skipped', () => {
    // given: a tree whose `--spacing` is defined per density state
    // when: the markdown is rendered
    // then: the state line names the skipped state instead of averaging it
    const result = runAuditProject({ appRoot: join(FIXTURES, 'state-tree') });
    if (result.kind !== 'audited') throw new Error('state-tree must be a UI project');
    expect(result.state.scored).toEqual([]);
    expect(result.state.skipped).toEqual(["[data-density='compact']"]);
    const markdown = renderAuditMarkdown(buildAuditReport(result), {
      ...META_WITHOUT_RID,
      appRoot: 'state-tree'
    });
    expect(markdown).toContain('runtime state scored: default; skipped: [data-density=');
  });
});
