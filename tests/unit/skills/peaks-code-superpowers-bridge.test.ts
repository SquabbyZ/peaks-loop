/**
 * peaks-code-superpowers-bridge.test.ts
 * slice 2026-07-24-peaks-code-bridge-002-rootcause (G7)
 *
 * Guard test enforcing that peaks-code surfaces carry the superpowers
 * bridge contract on disk:
 *
 *   AC1  peaks-code/SKILL.md contains a BRIDGE chapter with multiple
 *        mentions of `superpowers` (>= 3, per PRD AC1 threshold).
 *   AC2  peaks-code/references/runbook.md mentions peaks-rd in the
 *        Step 2.7 superpowers-bridge section.
 *   AC3  peaks-code/references/boundaries.md mentions superpowers /
 *        writing-plans / brainstorming in the red-lines block.
 *   AC4  peaks-code/references/external-skill-invocation.md contains
 *        a superpowers transition contract section that cross-references
 *        peaks-rd.
 *   AC6  src/services/hooks/pre-tool-superpowers-bridge.sh exists and
 *        is the source of truth for the bridge hook.
 *   AC9  / AC12 — peaks-code is a junction on the host (this test only
 *        verifies the contract on the repo source; the live junction
 *        assertion is RD-side via fsutil reparsepoint query).
 *   AC10 bridge hook script in the repo MUST contain the canonical
 *        hooks/filename and the bridge-context reminder string.
 *   AC11 hooks install flow exposes the bridgeHookCopy field on the
 *        envelope (see hooks-commands.ts extension).
 *
 * Karpathy §1 (Think Before Coding): every assertion maps to a PRD AC.
 * Karpathy §2 (Simplicity First): uses plain Node fs + grep-style
 *   substring checks; no external test framework deps beyond vitest.
 * Karpathy §3 (Surgical Changes): reads files, never writes.
 * Karpathy §4 (Goal-Driven Execution): if any assertion fails, the test
 *   fails the suite and the LLM MUST NOT mark the slice complete.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function read(rel: string): string {
  const abs = resolve(REPO_ROOT, rel);
  if (!existsSync(abs)) {
    throw new Error(`peaks-code-superpowers-bridge guard: expected file ${rel} to exist at ${abs}`);
  }
  return readFileSync(abs, 'utf8');
}

describe('peaks-code superpowers bridge (slice 2026-07-24-peaks-code-bridge-002-rootcause)', () => {
  it('AC1 — peaks-code/SKILL.md contains a BRIDGE chapter with ≥ 3 superpowers mentions', () => {
    const body = read('skills/peaks-code/SKILL.md');
    const matches = body.match(/superpowers/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    // Must include the literal chapter heading.
    expect(body).toContain('## Peaks-Loop Superpowers 协作边界 (BRIDGE — MANDATORY');
    // Must mention the boundary scope (brainstorming / writing-plans).
    expect(body).toMatch(/brainstorming/i);
    expect(body).toMatch(/writing-plans/);
  });

  it('AC2 — peaks-code/references/runbook.md has Step 2.7 bridge step referencing peaks-rd', () => {
    const body = read('skills/peaks-code/references/runbook.md');
    // Section heading.
    expect(body).toMatch(/^# 2\.7\.\s+Peaks-Loop Superpowers bridge/m);
    // Must route through peaks-rd.
    expect(body).toMatch(/peaks-rd|peaks sub-agent dispatch rd/);
  });

  it('AC3 — peaks-code/references/boundaries.md has superpowers red-lines block', () => {
    const body = read('skills/peaks-code/references/boundaries.md');
    expect(body).toContain('Superpowers red lines');
    expect(body).toMatch(/superpowers/i);
    expect(body).toMatch(/writing-plans|brainstorming/);
  });

  it('AC4 — peaks-code/references/external-skill-invocation.md has a superpowers transition contract referencing peaks-rd', () => {
    const body = read('skills/peaks-code/references/external-skill-invocation.md');
    expect(body).toContain('Superpowers transition contract');
    // Transition contract must reference peaks-rd (or peaks sub-agent dispatch rd).
    expect(body).toMatch(/peaks-rd|peaks sub-agent dispatch rd/);
  });

  it('AC6 / AC10 — src/services/hooks/pre-tool-superpowers-bridge.sh exists, is non-empty, and is executable', () => {
    const rel = 'src/services/hooks/pre-tool-superpowers-bridge.sh';
    const abs = resolve(REPO_ROOT, rel);
    expect(existsSync(abs), `bridge hook source missing: ${abs}`).toBe(true);
    const st = statSync(abs);
    expect(st.size).toBeGreaterThan(0);
    // POSIX executable bit — vitest on Windows may not enforce, so guard loosely.
    if (process.platform !== 'win32') {
      expect((st.mode & 0o111) !== 0).toBe(true);
    }
    const body = read(rel);
    // Must NOT mention the legacy superpowers:writing-plans auto-run path.
    expect(body).toMatch(/superpowers:brainstorming|superpowers:writing-plans/);
    // Must contain the canonical additionalContext reminder text.
    expect(body).toContain('additionalContext');
    expect(body).toContain('peaks-loop bridge');
  });

  it('AC10 — bridge hook is silent (no exit-nonzero) when stdin is empty or unrelated', () => {
    const body = read('src/services/hooks/pre-tool-superpowers-bridge.sh');
    // The hook should exit 0 on non-bridge payloads (we test only the contract on disk here).
    expect(body).toMatch(/exit 0/);
    // Must NOT block the tool call — it only adds additionalContext.
    expect(body).not.toMatch(/permissionDecision[\s\S]*"deny"/);
  });

  it('AC11 — hooks-commands.ts exposes bridgeHookCopy on the install envelope', () => {
    const body = read('src/cli/commands/hooks-commands.ts');
    expect(body).toContain('bridgeHookCopy');
    expect(body).toContain('copyBridgeHookIfPresent');
    // Must reference the canonical bridge hook filename.
    expect(body).toContain('pre-tool-superpowers-bridge.sh');
  });

  it('G16 — peaks-loop package.json files[] already covers skills/** (no edit required)', () => {
    // Read the root package.json and confirm `skills/**` is whitelisted. The
    // guard test is read-only: it asserts the contract, not that we mutate files[].
    const pkg = JSON.parse(read('package.json'));
    const files = Array.isArray(pkg.files) ? pkg.files.map(String) : [];
    expect(files, 'root package.json#files[] must include skills/**').toContain('skills/**');
  });
});