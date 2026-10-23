// tests/unit/services/standards/agents-md-constitution.test.ts
//
// T2-Q2 — the cross-tool constitution.
//
// `AGENTS.md` carries the instruction body every coding agent can read;
// `CLAUDE.md` is a pointer that imports it with Claude Code's documented
// `@path` import syntax. These tests pin the contract that makes that
// shape work:
//
//   1. `standards init` produces AGENTS.md, and the commands in it are the
//      project's REAL commands, read from `package.json#scripts`.
//   2. CLAUDE.md is a pointer, not a second copy of the body.
//   3. A hand-written CLAUDE.md is never overwritten.
//   4. The body carries the Peaks rules CLAUDE.md used to carry, with the
//      CORRECTED presence path.
//   5. The body stays inside the size budget and keeps its provenance line.
//
// Run with: pnpm vitest run tests/unit/services/standards/agents-md-constitution.test.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  executeProjectStandardsInit,
  executeProjectStandardsUpdate
} from '~/src/services/standards/project-standards-service';
import { detectProjectScripts } from '~/src/services/standards/project-scripts';
import { resolveStandardsConstitution } from '~/src/services/standards/ide-aware-standards-service';
import { getStandardsProfile } from '~/src/services/ide/resource-profile';

let projectRoot: string;

const FIXTURE_PACKAGE_JSON = {
  name: 'fixture-downstream',
  version: '0.0.0',
  packageManager: 'pnpm@10.11.0',
  scripts: {
    build: 'tsc -p tsconfig.json',
    test: 'vitest run',
    lint: 'eslint .'
  }
};

function writeFixturePackageJson(scripts: Record<string, string>): void {
  writeFileSync(
    join(projectRoot, 'package.json'),
    JSON.stringify({ ...FIXTURE_PACKAGE_JSON, scripts }, null, 2),
    'utf8'
  );
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-md-'));
  writeFixturePackageJson(FIXTURE_PACKAGE_JSON.scripts);
});

describe('Scenario: standards init — the AGENTS.md body', () => {
  it('when invoked, should write AGENTS.md carrying the exact commands from package.json#scripts', () => {
    // given: a project whose package.json declares build / test / lint
    // when:  the standards are initialised with apply
    // then:  AGENTS.md exists and names each command the project really has
    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    expect(result.writtenFiles).toContain('AGENTS.md');
    const body = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(body).toContain('pnpm build');
    expect(body).toContain('pnpm test');
    expect(body).toContain('pnpm lint');
    expect(body).toContain('builds the project');
    expect(body).toContain('runs the test suite');
    expect(body).toContain('runs the linter');
  });

  it('when invoked, should omit a command category the project does not have', () => {
    // given: a project with only a test script
    // when:  the standards are initialised with apply
    // then:  no build or lint command is invented
    writeFixturePackageJson({ test: 'vitest run' });
    executeProjectStandardsInit({ projectRoot, apply: true });
    const body = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(body).toContain('pnpm test');
    expect(body).not.toContain('pnpm build');
    expect(body).not.toContain('pnpm lint');
  });

  it('when invoked, should carry the Peaks rules CLAUDE.md used to carry', () => {
    // given: a project with standards scripts
    // when:  the standards are initialised with apply
    // then:  the standards-reading rules, the workflow automation and the presence contract are present
    executeProjectStandardsInit({ projectRoot, apply: true });
    const body = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(body).toContain('.peaks/standards/common/coding-style.md');
    expect(body).toContain('.peaks/standards/common/code-review.md');
    expect(body).toContain('.peaks/standards/common/security.md');
    expect(body).toContain('peaks-rd checks these standards');
    expect(body).toContain('peaks-qa checks code review and security guidance');
    expect(body).toContain('peaks-code summarizes RD and QA standards preflight');
    expect(body).toContain('peaks skill presence --json');
    expect(body).toContain('Peaks-Loop Skill: <skill>');
  });

  it('when invoked, should name the session-scoped presence lease, not the removed project-level file', () => {
    // given: a project with standards scripts
    // when:  the standards are initialised with apply
    // then:  the body names the canonical lease path and not the removed one
    executeProjectStandardsInit({ projectRoot, apply: true });
    const body = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(body).toContain('.peaks/_runtime/<sessionId>/leases/presence-*.json');
    expect(body).not.toContain('.peaks/_runtime/active-skill.json');
    expect(body).not.toContain('.peaks/.active-skill.json');
  });

  it('when invoked, should keep the AI provenance line, separated from the body', () => {
    // given: a project with standards scripts
    // when:  the standards are initialised with apply
    // then:  the provenance line survives under its own heading and the body is short
    executeProjectStandardsInit({ projectRoot, apply: true });
    const body = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(body).toContain('> 🤖 AI 生成，请审阅');
    expect(body.indexOf('> 🤖 AI 生成，请审阅')).toBeGreaterThan(body.indexOf('## Provenance'));
    expect(body.split('\n').length).toBeLessThanOrEqual(150);
  });
});

describe('Scenario: standards init — the CLAUDE.md pointer', () => {
  it('when invoked, should write a CLAUDE.md that imports AGENTS.md and repeats no body', () => {
    // given: a project with standards scripts
    // when:  the standards are initialised with apply
    // then:  CLAUDE.md imports the body once and carries none of the body text
    executeProjectStandardsInit({ projectRoot, apply: true });
    const pointer = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    const body = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(pointer).toContain('@AGENTS.md');
    expect(pointer.match(/@AGENTS\.md/g)).toHaveLength(1);
    expect(pointer).not.toContain('pnpm build');
    expect(pointer).not.toContain('peaks-rd checks these standards');
    expect(body).not.toContain('@AGENTS.md');
  });

  it('when invoked, should not overwrite a hand-written CLAUDE.md', () => {
    // given: a project whose CLAUDE.md was written by a human
    // when:  the standards are initialised with apply
    // then:  the human's file is untouched and the body lands beside it
    const handwritten = '# House rules\n\nAlways ask before touching the database.\n';
    writeFileSync(join(projectRoot, 'CLAUDE.md'), handwritten, 'utf8');
    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe(handwritten);
    expect(result.writtenFiles).toContain('AGENTS.md');
    expect(result.writtenFiles).not.toContain('CLAUDE.md');
  });
});

describe('Scenario: standards update — the managed block', () => {
  it('when invoked, should append the managed block to a hand-written CLAUDE.md without rewriting it', () => {
    // given: a project whose CLAUDE.md was written by a human
    // when:  the standards are updated with apply
    // then:  the body survives and the managed block is appended
    const handwritten = '# House rules\n\nAlways ask before touching the database.\n';
    writeFileSync(join(projectRoot, 'CLAUDE.md'), handwritten, 'utf8');
    const result = executeProjectStandardsUpdate({ projectRoot, apply: true });
    const after = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    expect(after).toContain('Always ask before touching the database.');
    expect(after).toContain('<!-- peaks-standards:index:start -->');
    expect(result.appendedFiles).toContain('CLAUDE.md');
  });
});

describe('Scenario: --ide decides the output shape', () => {
  it('when invoked, should emit the pointer for an IDE whose root file is CLAUDE.md', () => {
    // given: the Claude Code adapter's standards profile
    // when:  the constitution is resolved from that profile
    // then:  both the body and the pointer are emitted
    const profile = getStandardsProfile('claude-code');
    const constitution = resolveStandardsConstitution(profile);
    expect(constitution.bodyFile).toBe('AGENTS.md');
    expect(constitution.pointerFile).toBe('CLAUDE.md');
  });

  it('when invoked, should emit the body alone for an IDE that reads AGENTS.md directly', () => {
    // given: the Codex adapter's standards profile
    // when:  the constitution is resolved from that profile
    // then:  no pointer is emitted, because Codex reads the body itself
    const profile = getStandardsProfile('codex');
    const constitution = resolveStandardsConstitution(profile);
    expect(constitution.bodyFile).toBe('AGENTS.md');
    expect(constitution.pointerFile).toBeNull();
  });

  it('when invoked, should fall back to both files for an IDE with no declared profile', () => {
    // given: no standards profile at all
    // when:  the constitution is resolved from that absence
    // then:  the default shape covers every reader
    const constitution = resolveStandardsConstitution(null);
    expect(constitution.bodyFile).toBe('AGENTS.md');
    expect(constitution.pointerFile).toBe('CLAUDE.md');
  });
});

describe('Scenario: the exact commands', () => {
  it('when invoked, should spell the runner from the packageManager field', () => {
    // given: a project declaring pnpm as its package manager
    // when:  the scripts are detected
    // then:  the command lines are spelled for pnpm
    const scripts = detectProjectScripts(projectRoot);
    expect(scripts.packageManager).toBe('pnpm');
    expect(scripts.commands.map((entry) => entry.command)).toEqual([
      'pnpm build',
      'pnpm test',
      'pnpm lint'
    ]);
  });

  it('when invoked, should fall back to npm run for a project with no lockfile', () => {
    // given: a project with no packageManager field and no lockfile
    // when:  the scripts are detected
    // then:  the command line is the npm spelling
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { test: 'vitest run' } }),
      'utf8'
    );
    const scripts = detectProjectScripts(projectRoot);
    expect(scripts.packageManager).toBe('npm');
    expect(scripts.commands.map((entry) => entry.command)).toEqual(['npm run test']);
  });
});

describe('Scenario: the legacy 1.x layout', () => {
  it('when invoked, should point the body at the .claude/rules tree it actually has', () => {
    // given: a project carrying a thick 1.x .claude/rules tree
    // when:  the standards are initialised with apply
    // then:  the body names the 1.x tree, not the 2.0 canonical one
    mkdirSync(join(projectRoot, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude', 'rules', 'common', 'coding-style.md'),
      '# Old rules\n\nUse tabs.\n',
      'utf8'
    );
    executeProjectStandardsInit({ projectRoot, apply: true });
    const body = readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8');
    expect(body).toContain('.claude/rules/common/coding-style.md');
    expect(body).not.toContain('.peaks/standards/common/coding-style.md');
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
  });
});
