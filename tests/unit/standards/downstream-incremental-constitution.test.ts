// tests/unit/standards/downstream-incremental-constitution.test.ts
//
// A downstream project that already has an AGENTS.md and a CLAUDE.md.
//
// THE OWNER'S DECISION (2026-10-24): "下游项目有 AGENTS.md 和 CLAUDE.md 的时候，
// peaks-loop 只做增量" — when the downstream project already has both files,
// peaks-loop only makes the INCREMENT. Never overwrites; appends what is
// missing and nothing else.
//
// THE THREE DEFECTS THIS FILE PINS SHUT:
//   1. `standards update --apply` appended the managed block to CLAUDE.md but
//      NOT the `@AGENTS.md` pointer — so the block's "Constitution: AGENTS.md"
//      claim was false for Claude Code, the one tool that reads CLAUDE.md.
//   2. `standards init --apply` wrote NOTHING to a file that already existed,
//      while `standards update --apply` appended to it: two verbs, two
//      answers for the same project.
//   3. The two policies ("exists ⇒ untouched" and "exists ⇒ append what is
//      missing") had no single source of truth.
//
// The fixture lives under os.tmpdir(), never inside the repository: a
// fixture inside `src/` or `tests/` would move the very census the repo's own
// file-size gates measure.
//
// The four dimensions are all covered: `behavior` (the four states and the
// convergence), `render` (what the files end up containing), `integration`
// (the writes on a real filesystem), `a11y` (what the operator is told).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  executeProjectStandardsInit,
  executeProjectStandardsUpdate,
  type StandardsWriteStatus
} from '~/src/services/standards/project-standards-service';

declareDimensions(
  'tests/unit/standards/downstream-incremental-constitution.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

const MARKER = 'KEEP-ME-7f3a9c2b';
const USER_AGENTS = `# Downstream house rules\n\n${MARKER} AGENTS user content.\n`;
const USER_CLAUDE = `# Downstream house rules\n\n${MARKER} CLAUDE user content.\n`;
const USER_RULES = `# Local law\n\n${MARKER} rules user content.\n`;
const POINTER = '@AGENTS.md';
const MANAGED_BLOCK_START = '<!-- peaks-standards:index:start -->';

let projectRoot: string;

/** Write a downstream fixture — hand-written constitution files and one local law. */
function writeFixtureFiles(root: string, claude: string = USER_CLAUDE): void {
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      { name: 'downstream-fixture', version: '0.0.0', scripts: { test: 'vitest run' } },
      null,
      2
    ),
    'utf8'
  );
  writeFileSync(join(root, 'AGENTS.md'), USER_AGENTS, 'utf8');
  writeFileSync(join(root, 'CLAUDE.md'), claude, 'utf8');
  mkdirSync(join(root, '.peaks', 'standards', 'common'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'standards', 'common', 'coding-style.md'), USER_RULES, 'utf8');
}

function readFile(name: string): string {
  return readFileSync(join(projectRoot, name), 'utf8');
}

/** How many lines of a text are exactly the pointer line. */
function pointerLineCount(text: string): number {
  return text.split('\n').filter((line) => line.trim() === POINTER).length;
}

/** The status the plan gave one constitution file. */
function statusOf(
  writes: { relativePath: string; status: StandardsWriteStatus }[],
  relativePath: string
): StandardsWriteStatus | undefined {
  return writes.find((write) => write.relativePath === relativePath)?.status;
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-downstream-'));
  writeFixtureFiles(projectRoot);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('Scenario: behavior — update makes the increment', () => {
  it('when update runs against a downstream project, should append the block and the pointer', () => {
    // given: a project whose AGENTS.md and CLAUDE.md were written by a human
    // when: the standards are updated with apply
    // then: both constitution files are reported as appended, not skipped
    const result = executeProjectStandardsUpdate({ projectRoot, apply: true });
    expect(statusOf(result.plannedWrites, 'AGENTS.md')).toBe('appended');
    expect(statusOf(result.plannedWrites, 'CLAUDE.md')).toBe('appended');
    expect(result.appendedFiles).toContain('CLAUDE.md');
  });

  it('when init runs against a downstream project, should do the same work as update', () => {
    // given: a project whose AGENTS.md and CLAUDE.md were written by a human
    // when: the standards are initialised with apply
    // then: the same four-state decision as update — the two verbs agree
    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    expect(statusOf(result.plannedWrites, 'AGENTS.md')).toBe('appended');
    expect(statusOf(result.plannedWrites, 'CLAUDE.md')).toBe('appended');
    expect(result.reviewSuggestions).toEqual([]);
  });

  it('when the same project is initialised and updated, should end up with the same bytes', () => {
    // given: two identical downstream projects
    // when: one project is initialised and the other updated
    // then: the two constitution files are byte-identical
    const second = mkdtempSync(join(tmpdir(), 'peaks-downstream-'));
    try {
      writeFixtureFiles(second);
      executeProjectStandardsInit({ projectRoot, apply: true });
      executeProjectStandardsUpdate({ projectRoot: second, apply: true });
      expect(readFile('AGENTS.md')).toBe(readFileSync(join(second, 'AGENTS.md'), 'utf8'));
      expect(readFile('CLAUDE.md')).toBe(readFileSync(join(second, 'CLAUDE.md'), 'utf8'));
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('when the same command runs twice, should write nothing the second time', () => {
    // given: a project that has already been updated once
    // when: the same command runs again
    // then: both files are reported as existing, and their bytes did not move
    executeProjectStandardsUpdate({ projectRoot, apply: true });
    const agents = readFile('AGENTS.md');
    const claude = readFile('CLAUDE.md');
    const second = executeProjectStandardsUpdate({ projectRoot, apply: true });
    expect(statusOf(second.plannedWrites, 'AGENTS.md')).toBe('existing');
    expect(statusOf(second.plannedWrites, 'CLAUDE.md')).toBe('existing');
    expect(second.appendedFiles).toEqual([]);
    expect(readFile('AGENTS.md')).toBe(agents);
    expect(readFile('CLAUDE.md')).toBe(claude);
  });

  it('when the managed block differs from the one the writer would write, should leave the file alone', () => {
    // given: a CLAUDE.md whose managed block says something else
    // when: the standards are updated with apply
    // then: the file is reported for review and is not rewritten
    const differing = `${USER_CLAUDE}\n${MANAGED_BLOCK_START}\nSOMETHING ELSE\n<!-- peaks-standards:index:end -->\n`;
    writeFileSync(join(projectRoot, 'CLAUDE.md'), differing, 'utf8');
    const result = executeProjectStandardsUpdate({ projectRoot, apply: true });
    expect(statusOf(result.plannedWrites, 'CLAUDE.md')).toBe('review');
    expect(readFile('CLAUDE.md')).toBe(differing);
  });
});

describe('Scenario: render — what the files end up containing', () => {
  it('when update runs, should leave the pointer on a line of its own, exactly once', () => {
    // given: a downstream project with a hand-written CLAUDE.md
    // when: the standards are updated with apply
    // then: the pointer stands alone, exactly once, and the block is there
    executeProjectStandardsUpdate({ projectRoot, apply: true });
    const claude = readFile('CLAUDE.md');
    expect(pointerLineCount(claude)).toBe(1);
    expect(claude).toContain(MANAGED_BLOCK_START);
  });

  it('when update runs, should keep the user content byte-for-byte and put it first', () => {
    // given: a downstream project with a hand-written CLAUDE.md
    // when: the standards are updated with apply
    // then: the user's text is untouched, and it comes before the pointer
    executeProjectStandardsUpdate({ projectRoot, apply: true });
    const claude = readFile('CLAUDE.md');
    expect(claude.startsWith(USER_CLAUDE)).toBe(true);
    expect(claude).toContain(MARKER);
    expect(claude.indexOf(MARKER)).toBeLessThan(claude.indexOf(POINTER));
  });

  it('when the file already carries the pointer, should not add a second one', () => {
    // given: a CLAUDE.md that already carries the pointer
    // when: the standards are updated with apply
    // then: there is still exactly one pointer line
    writeFileSync(join(projectRoot, 'CLAUDE.md'), `${USER_CLAUDE}\n${POINTER}\n`, 'utf8');
    executeProjectStandardsUpdate({ projectRoot, apply: true });
    expect(pointerLineCount(readFile('CLAUDE.md'))).toBe(1);
  });

  it('when prose merely mentions the pointer, should still add the real one', () => {
    // given: a CLAUDE.md whose prose names the pointer without importing it
    // when: the standards are updated with apply
    // then: a standalone pointer line was added — the prose did not count
    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      `${USER_CLAUDE}\nThe rules live in \`@AGENTS.md\` for reference.\n`,
      'utf8'
    );
    executeProjectStandardsUpdate({ projectRoot, apply: true });
    expect(pointerLineCount(readFile('CLAUDE.md'))).toBe(1);
  });
});

describe('Scenario: integration — the rules files are not the constitution', () => {
  it('when init runs, should leave an existing rules file exactly as it was', () => {
    // given: a project with its own local law under .peaks/standards
    // when: the standards are initialised with apply
    // then: the local law is untouched
    executeProjectStandardsInit({ projectRoot, apply: true });
    expect(readFile('.peaks/standards/common/coding-style.md')).toBe(USER_RULES);
  });

  it('when init runs, should write the constitution files into the project root', () => {
    // given: a project with hand-written constitution files
    // when: the standards are initialised with apply
    // then: the two files are there, and they grew rather than being replaced
    executeProjectStandardsInit({ projectRoot, apply: true });
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
    expect(readFile('AGENTS.md').startsWith(USER_AGENTS)).toBe(true);
  });
});

describe('Scenario: a11y — what the operator is told', () => {
  it('when a file is left for review, should say the pointer line is missing', () => {
    // given: a CLAUDE.md whose managed block differs from the one we write
    // when: the standards are updated with apply
    // then: the review says, in words, that the pointer line is missing
    const differing = `${USER_CLAUDE}\n${MANAGED_BLOCK_START}\nSOMETHING ELSE\n<!-- peaks-standards:index:end -->\n`;
    writeFileSync(join(projectRoot, 'CLAUDE.md'), differing, 'utf8');
    const result = executeProjectStandardsUpdate({ projectRoot, apply: true });
    const suggestions = result.reviewSuggestions.join('\n');
    expect(suggestions).toContain('CLAUDE.md');
    expect(suggestions).toContain(POINTER);
    expect(suggestions).toContain('Claude Code');
  });
});
