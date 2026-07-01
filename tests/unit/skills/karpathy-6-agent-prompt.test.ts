/**
 * karpathy-6-agent-prompt test (Slice 6/6 + Slice 7/7 — karpathy-enforcement).
 *
 * Guards the canonical shipped source of the karpathy-reviewer sub-agent
 * prompt + the user handoff doc + the project-internal 2-line pointer:
 *  - AC-1: shipped source at agents/karpathy-reviewer.md exists with name=karpathy-reviewer
 *  - AC-2: shipped source frontmatter has tools + model fields (Claude Code agent loader contract)
 *  - AC-3: shipped source references all 4 violation kinds (kebab-case)
 *  - AC-4: shipped source defines the JSON envelope shape (passed / violations / gateAction)
 *  - AC-5: shipped source file-write contract uses title-case section headers
 *    (matches the existing KARPATHY_REVIEW.mustContain gate)
 *  - AC-6: shipped source hard-prohibitions list includes the peaks-rd red line
 *  - AC-7: handoff doc describes the AUTO-install path (npm i -g peaks-loop@latest →
 *          postinstall copies agents/karpathy-reviewer.md to ~/.claude/agents/
 *          with content-hash drift detection, .peaks-managed marker)
 *  - AC-8: handoff doc references the canonical shipped path + CLI gate
 *  - AC-9: project-internal pointer at skills/peaks-rd/references/karpathy-reviewer-prompt.md
 *          is a 2-line pointer to the canonical shipped source
 *  - AC-10: 9 new + 86 prior = 95 skill vitest cases pass
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '..', '..', '..');

function read(rel: string): string {
  return readFileSync(resolve(REPO, rel), 'utf8');
}

describe('Slice 6/6 + 7/7 — karpathy-reviewer shipped source + handoff + pointer', () => {
  const shipped = read('agents/karpathy-reviewer.md');
  const pointer = read('skills/peaks-rd/references/karpathy-reviewer-prompt.md');
  const handoff = read('rd/karpathy-reviewer-agent-handoff.md');

  it('AC-1 shipped source at agents/karpathy-reviewer.md exists with name=karpathy-reviewer', () => {
    expect(shipped).toMatch(/^---\nname:\s+karpathy-reviewer\b/m);
  });

  it('AC-2 shipped source frontmatter has tools + model fields (Claude Code agent loader contract)', () => {
    expect(shipped).toMatch(/^tools:\s*\[/m);
    expect(shipped).toMatch(/^model:\s+\w+/m);
    // name + description + tools + model = 4 frontmatter keys
    expect(shipped).toMatch(/^description:\s+.+/m);
  });

  it('AC-3 shipped source references all 4 violation kinds (kebab-case)', () => {
    for (const kind of [
      'think-before-coding',
      'simplicity-first',
      'surgical-changes',
      'goal-driven-execution'
    ]) {
      expect(shipped).toContain(kind);
    }
  });

  it('AC-4 shipped source defines the JSON envelope shape', () => {
    for (const key of ['passed', 'violations', 'gateAction']) {
      expect(shipped).toContain(key);
    }
    // violations[].kind + line + snippet + hint = 4 sub-fields
    for (const sub of ['kind', 'line', 'snippet', 'hint']) {
      expect(shipped).toContain(sub);
    }
  });

  it('AC-5 shipped source file-write contract uses title-case section headers (matches KARPATHY_REVIEW gate)', () => {
    // The file-write section must reference the title-case headers that the
    // existing KARPATHY_REVIEW prereq in src/services/artifacts/artifact-prerequisites.ts
    // enforces via mustContain: ['## Karpathy-Gate', 'Think Before Coding',
    // 'Simplicity First', 'Surgical Changes', 'Goal-Driven Execution'].
    // The shipped source indents the literal headers by 4 spaces inside the
    // code-fence example block to keep the sibling-reference heading inventory
    // clean (skill-slim-content-coverage.test.ts forbids duplicate H2/H3 across
    // skills/peaks-rd/references/*.md).
    for (const header of [
      '    ## 1. Think Before Coding',
      '    ## 2. Simplicity First',
      '    ## 3. Surgical Changes',
      '    ## 4. Goal-Driven Execution',
      '    ## Karpathy-Gate'
    ]) {
      expect(shipped).toContain(header);
    }
  });

  it('AC-6 shipped source hard-prohibitions list includes the peaks-rd red line', () => {
    // The global peaks-rd red line: "Do not install hooks, agents, MCP, or settings."
    expect(shipped).toMatch(/MUST NOT install hooks, agents, MCP/);
    // Sub-agent must not write code or modify request artifacts.
    expect(shipped).toMatch(/MUST NOT write code/);
    expect(shipped).toMatch(/MUST NOT call `peaks request transition`/);
  });

  it('AC-7 handoff doc describes the AUTO-install path (npm i -g peaks-loop@latest → postinstall)', () => {
    // Slice 7 changed the install model from "user-cp" to "auto-install on
    // npm i -g peaks-loop@latest". The handoff doc must document this and
    // include the PEAKS_SKIP_AGENT_INSTALL=1 escape hatch.
    expect(handoff).toMatch(/npm i -g peaks-loop@latest/);
    expect(handoff).toContain('postinstall');
    expect(handoff).toMatch(/installBundledAgents|agents\/karpathy-reviewer\.md/);
    // Drift detection: .peaks-managed marker + SHA-256
    expect(handoff).toContain('.peaks-managed');
    expect(handoff).toMatch(/SHA-256|content-hash|content hash/);
    // Env-var escape hatch
    expect(handoff).toContain('PEAKS_SKIP_AGENT_INSTALL');
    // The old user-cp install command should NOT be the primary install method
    expect(handoff).not.toMatch(/^mkdir -p ~\/\.claude\/agents && \\\n  cp /m);
  });

  it('AC-8 handoff doc references the canonical shipped path + CLI gate', () => {
    expect(handoff).toContain('agents/karpathy-reviewer.md');
    expect(handoff).toContain('KARPATHY_REVIEW');
    expect(handoff).toContain('artifact-prerequisites.ts');
  });

  it('AC-9 project-internal pointer at skills/peaks-rd/references/karpathy-reviewer-prompt.md is a 2-line pointer', () => {
    // peaks-loop 2.0 rules convention: a 2-line pointer file that points to
    // the canonical source. The first line is the "# Canonical ... lives at:"
    // header, the second line is the "# This file is a 2-line pointer ..." note.
    const lines = pointer.trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(pointer).toMatch(/^#\s+Canonical .* lives at: agents\/karpathy-reviewer\.md/m);
    expect(pointer).toMatch(/2-line pointer/);
  });
});
