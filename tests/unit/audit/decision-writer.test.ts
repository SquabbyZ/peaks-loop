import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  renderDecisionMarkdown,
  writeAuditDecision
} from '../../../src/services/audit/decision-writer.js';
import { readMemoryIndex } from '../../../src/services/memory/project-memory-service.js';
import type { RedLineAudit, RedLineEntry, EnforcerFinding } from '../../../src/services/audit/types.js';

function createTempProject(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return path;
}

function makeEntry(overrides: Partial<RedLineEntry> = {}): RedLineEntry {
  return {
    id: 'rl-test-001',
    rule: 'Test Red Line',
    source: {
      file: 'skills/foo/SKILL.md',
      line: 10,
      marker: 'MANDATORY',
      context: '±2 lines of raw markdown that should NOT leak into the decision record'
    },
    backing: 'cli-backed',
    enforcerRef: 'src/services/enforcers/foo.ts',
    ...overrides
  };
}

function makeFinding(overrides: Partial<EnforcerFinding> = {}): EnforcerFinding {
  return {
    enforcerId: 'lint-style',
    rule: 'Style gate',
    severity: 'warn',
    file: 'src/services/foo.ts',
    detail: 'lines exceed 50',
    ...overrides
  };
}

function makeAudit(overrides: Partial<RedLineAudit> = {}): RedLineAudit {
  return {
    totalRedLines: 12,
    cliBacked: 8,
    partial: 2,
    proseOnly: 2,
    audit: [
      makeEntry({ id: 'rl-solo-code-ban', rule: 'Solo Code-Change Red Line', backing: 'cli-backed' }),
      makeEntry({ id: 'rl-no-root-pollution', rule: 'No Root Pollution', backing: 'cli-backed' }),
      makeEntry({
        id: 'rl-skill-md-naming',
        rule: 'Skill MD Naming',
        backing: 'partial',
        source: { file: 'skills/x/SKILL.md', line: 5, marker: 'BLOCKING', context: 'partial: best effort clause' }
      }),
      makeEntry({
        id: 'rl-rule-md-rule-name',
        rule: 'Rule MD Rule Name',
        backing: 'prose-only',
        enforcerRef: null
      })
    ],
    enforcerFindings: [
      makeFinding({ enforcerId: 'lint-style', severity: 'warn' }),
      makeFinding({ enforcerId: 'lint-output-style', severity: 'pass' }),
      makeFinding({ enforcerId: 'lint-workflow-shape', severity: 'fail', detail: 'missing AC block' })
    ],
    ...overrides
  };
}

describe('decision-writer.renderDecisionMarkdown', () => {
  it('emits frontmatter with metadata.type: decision and no `context` field', () => {
    const audit = makeAudit();
    const md = renderDecisionMarkdown(audit, { date: '2026-06-19' });

    expect(md).toContain('name: audit-decision-2026-06-19');
    expect(md).toContain('  type: decision');
    expect(md).toContain('  totalRedLines: 12');
    expect(md).toContain('  cliBacked: 8');
    expect(md).toContain('  partial: 2');
    expect(md).toContain('  proseOnly: 2');
    // K1-AC-1: no `context` leaks into the persisted record.
    expect(md).not.toMatch(/\bcontext\s*:/);
    expect(md).not.toContain('±2 lines of raw markdown');
    expect(md).not.toContain('partial: best effort clause');
  });

  it('slug incorporates rid when provided', () => {
    const audit = makeAudit();
    const md = renderDecisionMarkdown(audit, { date: '2026-06-19', rid: '2026-06-19-redline-snapshot' });
    expect(md).toContain('name: audit-decision-2026-06-19-2026-06-19-redline-snapshot');
  });

  it('slug strips unsafe characters from rid', () => {
    const audit = makeAudit();
    const md = renderDecisionMarkdown(audit, { date: '2026-06-19', rid: '../etc/passwd?with spaces' });
    // Only safe chars remain: letters, digits, dash.
    expect(md).toContain('name: audit-decision-2026-06-19-etcpasswdwithspaces');
  });

  it('body has Summary, Per-Rule Decisions, and Enforcer Findings sections', () => {
    const audit = makeAudit();
    const md = renderDecisionMarkdown(audit, { date: '2026-06-19' });

    expect(md).toContain('## Summary');
    expect(md).toContain('## Per-Rule Decisions');
    expect(md).toContain('## Enforcer Findings');
    expect(md).toContain('| Total red lines | 12 |');
    expect(md).toContain('| `rl-solo-code-ban` |');
    expect(md).toContain('| `lint-workflow-shape` |');
  });

  it('renders empty-state placeholders when audit has no entries or findings', () => {
    const audit: RedLineAudit = {
      totalRedLines: 0,
      cliBacked: 0,
      partial: 0,
      proseOnly: 0,
      audit: [],
      enforcerFindings: []
    };
    const md = renderDecisionMarkdown(audit, { date: '2026-06-19' });
    expect(md).toContain('_No red lines discovered._');
    expect(md).toContain('_No enforcer findings._');
    expect(md).toContain('| Total red lines | 0 |');
  });

  // R6 defense-in-depth: bad date input must throw, not silently
  // pollute the filename slug with path separators / shell metachars.
  it('throws when date is not YYYY-MM-DD (R6 defense-in-depth)', () => {
    const audit = makeAudit();
    expect(() => renderDecisionMarkdown(audit, { date: '2026/06/19' })).toThrow(/Invalid date/);
    expect(() => renderDecisionMarkdown(audit, { date: 'today' })).toThrow(/Invalid date/);
    expect(() => renderDecisionMarkdown(audit, { date: '' })).toThrow(/Invalid date/);
    expect(() => renderDecisionMarkdown(audit, { date: '2026-06-19; rm -rf /' })).toThrow(/Invalid date/);
    expect(() => renderDecisionMarkdown(audit, { date: '2026-6-19' })).toThrow(/Invalid date/); // missing zero-pad
  });
});

describe('decision-writer.writeAuditDecision', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = createTempProject('peaks-k1-decision-writer');
  });

  afterEach(() => {
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes a markdown file at .peaks/memory/audit-decisions/<slug>.md', () => {
    const audit = makeAudit();
    const record = writeAuditDecision(audit, { projectRoot, date: '2026-06-19' });

    expect(record.name).toBe('audit-decision-2026-06-19');
    expect(record.filePath).toBe(join(projectRoot, '.peaks', 'memory', 'audit-decisions', 'audit-decision-2026-06-19.md'));
    expect(existsSync(record.filePath)).toBe(true);

    const body = readFileSync(record.filePath, 'utf8');
    expect(body).toContain('name: audit-decision-2026-06-19');
    expect(body).toContain('  type: decision');
  });

  it('regenerates the memory index and lands the new decision in hot.decision[]', () => {
    const audit = makeAudit();
    const record = writeAuditDecision(audit, { projectRoot, date: '2026-06-19', rid: 'snapshot-A' });

    expect(record.indexSynced).toBe(true);

    const index = readMemoryIndex(projectRoot);
    expect(index).not.toBeNull();
    const decisionEntries = index!.hot.decision.filter((e) => e.name === 'audit-decision-2026-06-19-snapshot-A');
    expect(decisionEntries).toHaveLength(1);
    expect(decisionEntries[0]?.kind).toBe('decision');
    expect(decisionEntries[0]?.sourcePath).toBe(record.filePath);
  });

  it('is idempotent at the slug level: same (date, rid) overwrites the prior file', () => {
    const audit = makeAudit();
    const first = writeAuditDecision(audit, { projectRoot, date: '2026-06-19' });
    const second = writeAuditDecision(audit, { projectRoot, date: '2026-06-19' });

    expect(first.filePath).toBe(second.filePath);
    // Index should contain exactly one entry with this name, not two.
    const index = readMemoryIndex(projectRoot)!;
    const matches = index.hot.decision.filter((e) => e.name === 'audit-decision-2026-06-19');
    expect(matches).toHaveLength(1);
  });

  it('auto-creates .peaks/memory/audit-decisions/ when it does not exist', () => {
    // Project has no .peaks/ at all initially.
    const audit = makeAudit();
    expect(existsSync(join(projectRoot, '.peaks', 'memory'))).toBe(false);

    const record = writeAuditDecision(audit, { projectRoot, date: '2026-06-19' });

    expect(existsSync(join(projectRoot, '.peaks', 'memory', 'audit-decisions'))).toBe(true);
    expect(existsSync(record.filePath)).toBe(true);
  });

  it('handles existing .peaks/memory/ without subdir (does not collide)', () => {
    // Seed an unrelated memory file at the top level to verify the writer
    // creates a sibling subdir without touching the existing file.
    mkdirSync(join(projectRoot, '.peaks', 'memory'), { recursive: true });
    const unrelatedPath = join(projectRoot, '.peaks', 'memory', 'unrelated.md');
    writeFileSync(unrelatedPath, '---\nname: unrelated\ndescription: x\nmetadata:\n  type: project\n---\nbody\n', 'utf8');

    const audit = makeAudit();
    const record = writeAuditDecision(audit, { projectRoot, date: '2026-06-19' });

    expect(existsSync(record.filePath)).toBe(true);
    // Unrelated file untouched.
    expect(readFileSync(unrelatedPath, 'utf8')).toContain('name: unrelated');
  });
});