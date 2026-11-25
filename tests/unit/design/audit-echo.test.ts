import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { auditEcho, sanitizeFinding } from '../../../src/services/design/audit/audit-echo.js';
import type { AuditFinding } from '../../../src/services/design/audit/audit-finding.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import {
  buildAuditReport,
  renderAuditJson,
  renderAuditMarkdown,
  writeAuditReport
} from '../../../src/services/design/audit/audit-report.js';

declareDimensions('tests/unit/design/audit-echo.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const LONG = '1'.repeat(5000);

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    dimension: 'spacing',
    severity: 'unmeasured',
    file: 'pages/leak.css',
    line: 1,
    value: '13px',
    expected: '',
    humanText: '第 1 行的 padding 是 13px。',
    techText: 'pages/leak.css:1 padding:13px unmeasured',
    ...overrides
  };
}

/**
 * A UI tree whose inline style carries every untrusted shape at once: a
 * credentials-bearing URL inside a value (kept intact because it sits in a
 * quoted literal, not a `//` line comment), a C0 control sequence and a NUL, and
 * a 5 KB token.
 */
function makeLeakTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-audit-echo-'));
  roots.push(root);
  mkdirSync(join(root, 'design'), { recursive: true });
  mkdirSync(join(root, 'pages'), { recursive: true });
  writeFileSync(
    join(root, 'design', 'paved-road.json'),
    JSON.stringify({
      schemaVersion: 1,
      pageRoots: ['pages'],
      componentEntrypoints: [],
      tokenScale: {
        space: ['4', '8'],
        font: ['12', '16'],
        radius: ['4', '8'],
        color: ['--color-*']
      }
    }),
    'utf8'
  );
  writeFileSync(join(root, 'design', 'tokens.json'), '{}', 'utf8');
  writeFileSync(
    join(root, 'pages', 'leak.tsx'),
    [
      'export function Leak() {',
      '  return (',
      '    <div',
      "      style={{ padding: 'var(--x) url(https://u:p@h/a)', margin: '",
      `        ${LONG}\u001b[31m\u0000' }}`,
      '    />',
      '  );',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
  return root;
}

/**
 * A UI tree whose inline style carries a PROTOCOL-RELATIVE credential URL next
 * to a plain off-ladder value. The ladder omits 16, so the plain value is
 * echoed by a finding and its survival is observable.
 */
function makeProtocolRelativeTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-audit-protocol-relative-'));
  roots.push(root);
  mkdirSync(join(root, 'design'), { recursive: true });
  mkdirSync(join(root, 'pages'), { recursive: true });
  writeFileSync(
    join(root, 'design', 'paved-road.json'),
    JSON.stringify({
      schemaVersion: 1,
      pageRoots: ['pages'],
      componentEntrypoints: [],
      tokenScale: {
        space: ['4', '8', '12'],
        font: ['12', '16'],
        radius: ['4', '8'],
        color: ['--color-*']
      }
    }),
    'utf8'
  );
  writeFileSync(join(root, 'design', 'tokens.json'), '{}', 'utf8');
  writeFileSync(
    join(root, 'pages', 'url.tsx'),
    [
      'export function Url() {',
      '  return (',
      "    <div style={{ padding: 'url(//u:p@example.com/d)', margin: '16px' }} />",
      '  );',
      '}',
      ''
    ].join('\n'),
    'utf8'
  );
  return root;
}

describe('Scenario: render — one sanitiser masks, strips and bounds every echo', () => {
  it('when a value carries credentials, should keep the URL and drop the userinfo', () => {
    // given: a CSS value with a credentials-bearing URL inside it
    // when: the value passes the echo sanitiser
    // then: the host survives, no user or password character does
    const echoed = auditEcho('var(--x) url(https://u:p@h/a)');
    expect(echoed).toContain('https://h/a');
    expect(echoed).not.toContain('u:p@');
    expect(echoed).not.toContain('***@');
  });

  it('when a value is not a URL, should leave it unchanged', () => {
    // given: ordinary declaration values the audit echoes every day
    // when: each passes the sanitiser
    // then: none is rewritten
    expect(auditEcho('13px')).toBe('13px');
    expect(auditEcho('#ff00aa')).toBe('#ff00aa');
    expect(auditEcho('p-[13px]')).toBe('p-[13px]');
    expect(auditEcho('var(--spacing)')).toBe('var(--spacing)');
  });

  it('when a value carries control bytes and 5 KB, should strip and cap it', () => {
    // given: an ESC CSI sequence, a NUL and a 5 KB token in one value
    // when: the value passes the sanitiser
    // then: the sequence is gone, no control byte remains and the echo is bounded
    const echoed = auditEcho(`\u001b[31m${LONG}\u0000red`);
    expect(echoed).not.toContain('\u001b');
    expect(echoed).not.toContain('[31m');
    expect(echoed).not.toContain('\u0000');
    expect(echoed.length).toBeLessThanOrEqual(300);
  });

  it('when a value carries a protocol-relative credential URL, should mask it too', () => {
    // given: `url(//u:p@example.com/d)` — a URL whose scheme is resolved later
    // when: the value passes the echo sanitiser
    // then: the authority is masked and the host survives, with 16px untouched
    const echoed = auditEcho('url(//u:p@example.com/d)');
    expect(echoed).toContain('//***@example.com/d');
    expect(echoed).not.toContain('u:');
    expect(echoed).not.toContain('p@');
    expect(auditEcho('16px')).toBe('16px');
  });

  it('when a finding is sanitised, should carry the masked value and bounded text', () => {
    // given: a finding whose four echoed fields are all untrusted
    // when: the sanitiser runs
    // then: value, expected, humanText and techText are all bounded and masked
    const sanitized = sanitizeFinding(
      finding({
        value: 'url(https://u:p@h/a)',
        expected: `\u001b[31m${LONG}`,
        humanText: `第 1 行 ${LONG}`,
        techText: 'pages/leak.css:1 https://u:p@h/a'
      })
    );
    expect(JSON.stringify(sanitized)).not.toContain('u:p@');
    expect(sanitized.value.length).toBeLessThanOrEqual(300);
    expect(sanitized.expected.length).toBeLessThanOrEqual(300);
    expect(sanitized.humanText.length).toBeLessThanOrEqual(300);
    expect(sanitized.techText.length).toBeLessThanOrEqual(300);
  });
});

describe('Scenario: integration — the persisted pair and the envelope carry no secret', () => {
  it('when a stylesheet echoes a credential, should mask it in markdown, JSON and stdout', async () => {
    // given: a tree whose CSS carries a credential URL, control bytes and 5 KB
    // when: the audit writes its pair and renders its envelope data
    // then: no sink carries the userinfo, a control byte or the full 5 KB
    const root = makeLeakTree();
    const result = runAuditProject({ appRoot: root });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const report = buildAuditReport(result);
    const written = await writeAuditReport({ appRoot: root, report, rid: 'r7' });
    const markdown = readFileSync(written.markdownPath, 'utf8');
    const json = readFileSync(written.jsonPath, 'utf8');
    const stdout = JSON.stringify(report.data);
    for (const sink of [markdown, json, stdout]) {
      expect(sink).not.toContain('u:p@');
      expect(sink).not.toContain('\u001b');
      expect(sink).not.toContain('\u0000');
      expect(sink).not.toContain(LONG);
    }
    expect(markdown).toContain('https://h/a');
  });

  it('when an inline value carries a protocol-relative credential, should mask it end-to-end', async () => {
    // given: an inline padding of url(//u:p@example.com/d) beside a plain 16px margin
    // when: the audit writes its markdown and JSON pair
    // then: neither sink carries the userinfo, and the plain value survives as written
    const root = makeProtocolRelativeTree();
    const result = runAuditProject({ appRoot: root });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const report = buildAuditReport(result);
    const written = await writeAuditReport({ appRoot: root, report, rid: 'r7' });
    const text = `${readFileSync(written.markdownPath, 'utf8')}\n${readFileSync(written.jsonPath, 'utf8')}`;
    expect(text).toContain('//***@example.com/d');
    expect(text).not.toContain('u:');
    expect(text).not.toContain('p@');
    expect(text).toContain('margin 间距是 16px');
  });

  it('when the pair is rendered, should keep each echoed line one bounded line', async () => {
    // given: the leak tree's report
    // when: the markdown and the JSON document are rendered
    // then: no rendered line is unbounded by the 5 KB value
    const root = makeLeakTree();
    const result = runAuditProject({ appRoot: root });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const report = buildAuditReport(result);
    const markdown = renderAuditMarkdown(report, {
      appRoot: 'leak-tree',
      rid: 'r7',
      generatedAt: '2026-11-25T00:00:00.000Z'
    });
    for (const line of markdown.split('\n')) expect(line.length).toBeLessThan(500);
    const document = renderAuditJson(report, {
      appRoot: 'leak-tree',
      generatedAt: '2026-11-25T00:00:00.000Z'
    });
    for (const page of document.pages) {
      for (const entry of page.findings) {
        expect(entry.value.length).toBeLessThanOrEqual(300);
        expect(entry.humanText.length).toBeLessThanOrEqual(300);
      }
    }
  });
});

describe('Scenario: render — the read-gap flood is one line in markdown, detail in JSON', () => {
  it('when a page imports many packages, should summarise the gaps on one line', async () => {
    // given: a page importing 60 third-party packages and the two contract files
    // when: the markdown and JSON are rendered
    // then: markdown carries one short counted line; the JSON keeps every entry
    const root = mkdtempSync(join(tmpdir(), 'peaks-audit-gaps-'));
    roots.push(root);
    mkdirSync(join(root, 'design'), { recursive: true });
    mkdirSync(join(root, 'pages'), { recursive: true });
    writeFileSync(
      join(root, 'design', 'paved-road.json'),
      JSON.stringify({ schemaVersion: 1, pageRoots: ['pages'], componentEntrypoints: [] }),
      'utf8'
    );
    writeFileSync(join(root, 'design', 'tokens.json'), '{}', 'utf8');
    const imports = Array.from(
      { length: 60 },
      (_, index) => `import value${index} from 'pkg-${index}/entry';`
    );
    writeFileSync(
      join(root, 'pages', 'many.tsx'),
      `${imports.join('\n')}\nexport function Many() { return <h1>Many</h1>; }\n`,
      'utf8'
    );
    const result = runAuditProject({ appRoot: root });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    expect(result.state.readGaps).toHaveLength(60);
    const report = buildAuditReport(result);
    const markdown = renderAuditMarkdown(report, {
      appRoot: 'gaps-tree',
      generatedAt: '2026-11-25T00:00:00.000Z'
    });
    const stateLine = markdown
      .split('\n')
      .find((line) => line.startsWith('- runtime state scored:'));
    expect(stateLine).toContain('60 package imports (');
    expect((stateLine ?? '').length).toBeLessThan(300);
    const document = renderAuditJson(report, {
      appRoot: 'gaps-tree',
      generatedAt: '2026-11-25T00:00:00.000Z'
    });
    expect(document.state.readGaps).toHaveLength(60);
  });
});

describe('Scenario: a11y — the masked value is still usable evidence', () => {
  it('when the credential is masked, should keep the finding readable', () => {
    // given: the leak tree's report
    // when: the spacing finding's bilingual pair is read
    // then: the sentence still names the value and the technical line is greppable
    const result = runAuditProject({ appRoot: makeLeakTree() });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const report = buildAuditReport(result);
    const text = JSON.stringify(report.data.unmeasured) + JSON.stringify(report.data.topFixes);
    expect(text).toContain('padding');
    expect(text).toContain('https://h/a');
  });
});
