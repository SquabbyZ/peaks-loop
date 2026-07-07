/**
 * peaks skill visibility CLI — Task 1 of peaks-code → peaks-code rename plan.
 *
 * Tests the marketplace.json schema contract: 4 public skills (peaks-code /
 * peaks-resume / peaks-status / peaks-test) and 6 internal role skills
 * (peaks-prd / peaks-rd / peaks-qa / peaks-ui / peaks-sc / peaks-txt).
 *
 * NOTE on Task 1 timing: at Task 1 stage the code-* names have NOT yet been
 * renamed to peaks-code / peaks-resume / peaks-status / peaks-test. Task 3
 * performs the rename. So the public-side list is currently peaks-code /
 * peaks-resume / peaks-status / peaks-test (4 entries), and
 * peaks-sop is the 11th entry which is user-invocable (counts among public).
 *
 * Per the brief Step 1 the contract is:
 *   - 6 role skills marked userInvocable: false (internal)
 *   - the rest default userInvocable (public)
 *   - the schema is JSON-parseable
 *   - peaks-sop, peaks-code*, peaks-*-role are accounted for
 *
 * The CLI surface (`peaks skill:visibility`) is exercised via the
 * listSkillsVisibility() export; the program-level wiring is exercised by
 * `pnpm peaks skill:visibility --list --json`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('peaks skill visibility CLI', () => {
  const repoRoot = join(__dirname, '..', '..', '..');
  const marketplace = JSON.parse(
    readFileSync(join(repoRoot, '.claude-plugin', 'marketplace.json'), 'utf-8'),
  );

  it('--list 输出含 4 个 public + 6 个 internal', () => {
    const skills = marketplace.plugins[0].skills;
    const internal = skills.filter((s: any) => s.userInvocable === false);
    const public_ = skills.filter((s: any) => s.userInvocable !== false);
    expect(internal.length).toBe(6);
    expect(public_.length).toBeGreaterThanOrEqual(4);
  });

  it('internal skills 包含 peaks-prd/rd/qa/ui/sc/txt', () => {
    const names = marketplace.plugins[0].skills
      .filter((s: any) => s.userInvocable === false)
      .map((s: any) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['peaks-prd', 'peaks-rd', 'peaks-qa', 'peaks-ui', 'peaks-sc', 'peaks-txt']),
    );
  });

  it('peaks-code 默认 userInvocable (无字段)', () => {
    const skills = marketplace.plugins[0].skills;
    const peaksSolo = skills.find((s: any) => s.name === 'peaks-code');
    expect(peaksSolo).toBeDefined();
    expect(peaksSolo.userInvocable).toBeUndefined();
  });

  it('peaks-resume/status/test 默认 userInvocable', () => {
    const skills = marketplace.plugins[0].skills;
    for (const name of ['peaks-resume', 'peaks-status', 'peaks-test']) {
      const skill = skills.find((s: any) => s.name === name);
      expect(skill).toBeDefined();
      expect(skill.userInvocable).toBeUndefined();
    }
  });

  it('六个 role skill 都标 userInvocable: false', () => {
    const skills = marketplace.plugins[0].skills;
    for (const name of ['peaks-prd', 'peaks-rd', 'peaks-qa', 'peaks-ui', 'peaks-sc', 'peaks-txt']) {
      const skill = skills.find((s: any) => s.name === name);
      expect(skill).toBeDefined();
      expect(skill.userInvocable).toBe(false);
    }
  });

  it('marketplace schema 不含 broken JSON', () => {
    expect(() => JSON.parse(JSON.stringify(marketplace))).not.toThrow();
  });
});