// tests/unit/services/audit/rd-handoff-artifact.test.ts
//
// A10 of the 2026-09-15 diagnosis: `lintRdHandoffContract` matched the
// peaks-rd SKILL.md sentence "do not hand off to QA without [the artifact]"
// and never opened a file under `.peaks/_runtime/`. The injection below is
// the point of the fix: delete the artifact, and the gate must notice.

import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { lintRdHandoffContract } from '../../../../src/services/audit/enforcers/lint-rd-handoff-coverage.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

const SESSION = '2099-01-01-session-abc123';
const tmpRoots: string[] = [];

function skillNamed(name: string): SkillFile {
  return { name, path: `skills/bee/${name}/SKILL.md`, body: '', lines: [] };
}

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-rd-handoff-'));
  tmpRoots.push(root);
  for (const [relativePath, body] of Object.entries(files)) {
    const abs = join(root, ...relativePath.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

/** A project whose session binding names SESSION, plus the given artifacts. */
function boundProject(artifacts: Record<string, string>): string {
  return makeProject({
    '.peaks/_runtime/session.json': JSON.stringify({ sessionId: SESSION }),
    ...artifacts
  });
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('lintRdHandoffContract', () => {
  it('when the bound session has no rd/requests artifact, should report the handoff as unbacked', () => {
    // given: a session binding with no rd/requests directory at all
    const root = boundProject({});

    // when: the handoff enforcer reads the artifact
    const hits = lintRdHandoffContract(skillNamed('peaks-rd'), root);

    // then: the missing artifact is the finding
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-rd-handoff-contract-001');
    // the reported path is native-separated; assert on its two segments
    expect(hits[0]?.file).toContain(SESSION);
    expect(hits[0]?.file).toContain(join('rd', 'requests'));
  });

  it('when the artifact was deleted after the SKILL.md sentence stayed put, should report the handoff as unbacked', () => {
    // given: a project that HAS the artifact
    const root = boundProject({
      [`.peaks/_runtime/${SESSION}/rd/requests/001-x.md`]: '# RD Request\n\nreal content\n'
    });
    expect(lintRdHandoffContract(skillNamed('peaks-rd'), root)).toHaveLength(0);

    // when: the artifact is removed — the sentence in SKILL.md is unchanged
    rmSync(join(root, '.peaks', '_runtime', SESSION, 'rd', 'requests', '001-x.md'));
    const hits = lintRdHandoffContract(skillNamed('peaks-rd'), root);

    // then: the gate follows the artifact, not the sentence
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-rd-handoff-contract-001');
  });

  it('when a non-empty artifact exists, should report nothing', () => {
    // given: one populated artifact under the bound session
    const root = boundProject({
      [`.peaks/_runtime/${SESSION}/rd/requests/001-x.md`]: '# RD Request\n\nreal content\n'
    });

    // when: the handoff enforcer reads the artifact
    const hits = lintRdHandoffContract(skillNamed('peaks-rd'), root);

    // then: the handoff is backed
    expect(hits).toHaveLength(0);
  });

  it('when the artifact exists but is empty, should report the handoff as unbacked', () => {
    // given: a zero-byte placeholder where the artifact should be
    const root = boundProject({ [`.peaks/_runtime/${SESSION}/rd/requests/001-x.md`]: '' });

    // when: the handoff enforcer reads the artifact
    const hits = lintRdHandoffContract(skillNamed('peaks-rd'), root);

    // then: an empty file is not an artifact
    expect(hits).toHaveLength(1);
  });

  it('when the session binding carries the legacy peakSessionId key, should still find the artifact', () => {
    // given: a binding written with the older key spelling
    const root = makeProject({
      '.peaks/_runtime/session.json': JSON.stringify({ peakSessionId: SESSION }),
      [`.peaks/_runtime/${SESSION}/rd/requests/001-x.md`]: '# RD Request\n'
    });

    // when: the handoff enforcer reads the artifact
    const hits = lintRdHandoffContract(skillNamed('peaks-rd'), root);

    // then: both key spellings resolve the same session
    expect(hits).toHaveLength(0);
  });

  it('when no session binding exists, should report nothing', () => {
    // given: a project with no .peaks/_runtime/session.json
    const root = makeProject({ 'README.md': '# nothing\n' });

    // when: the handoff enforcer runs
    const hits = lintRdHandoffContract(skillNamed('peaks-rd'), root);

    // then: soft pass, matching the sibling enforcers
    expect(hits).toHaveLength(0);
  });

  it('when the skill is not peaks-rd, should report nothing', () => {
    // given: a session with no artifact, but a different skill under audit
    const root = boundProject({});

    // when: the handoff enforcer runs for peaks-qa
    const hits = lintRdHandoffContract(skillNamed('peaks-qa'), root);

    // then: the rule is scoped to peaks-rd
    expect(hits).toHaveLength(0);
  });
});
