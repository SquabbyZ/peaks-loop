/**
 * Slice rid-skill-persistence-001 (2026-08-12) — drift guard.
 *
 * Verifies that the four superpowers chain-step Skills added to
 * `SUPERPOWERS_DENIED_SKILLS` are present in the static array AND
 * round-trip through the `withSuperpowersSkillDenylist` /
 * `withoutSuperpowersSkillDenylist` helpers without being lost.
 *
 * Coverage: 4 skills × 3 scenarios (from-any-role /
 * from-superpowers-user-message / from-conversation-history) = 12 cases.
 *
 * The four skills:
 *   - superpowers:systematic-debugging
 *   - superpowers:test-driven-development
 *   - superpowers:verification-before-completion
 *   - superpowers:using-superpowers
 */
import { describe, expect, it } from 'vitest';
import {
  SUPERPOWERS_DENIED_SKILLS,
  listSuperpowersDenyEntries,
  withSuperpowersSkillDenylist,
  withoutSuperpowersSkillDenylist,
} from '../../../src/services/skills/hooks-settings-service.js';

const NEW_DENIED: ReadonlyArray<string> = [
  'superpowers:systematic-debugging',
  'superpowers:test-driven-development',
  'superpowers:verification-before-completion',
  'superpowers:using-superpowers',
];

describe('slice rid-skill-persistence-001: SUPERPOWERS_DENIED_SKILLS widened', () => {
  describe('from-any-role (skill is in the static deny list)', () => {
    for (const skillId of NEW_DENIED) {
      it(`denies ${skillId} (in SUPERPOWERS_DENIED_SKILLS + UseSkill envelope)`, () => {
        expect(SUPERPOWERS_DENIED_SKILLS).toContain(skillId);
        expect(listSuperpowersDenyEntries()).toContain(`UseSkill(${skillId})`);
      });
    }
  });

  describe('from-superpowers-user-message (with/without merge preserves it)', () => {
    for (const skillId of NEW_DENIED) {
      it(`merges + strips ${skillId} round-trip`, () => {
        // from-superpowers-user-message: a prior settings file with
        // unrelated deny entries gets the new skill appended during
        // install. On uninstall the new skill goes away, the rest
        // survives.
        const merged = withSuperpowersSkillDenylist({
          permissions: { deny: ['UseSkill(other-stays)', 'Bash(rm -rf)'] }
        });
        const mergedDeny = (merged.permissions as { deny: ReadonlyArray<string> }).deny;
        expect(mergedDeny).toContain(`UseSkill(${skillId})`);
        expect(mergedDeny).toContain('UseSkill(other-stays)');
        expect(mergedDeny).toContain('Bash(rm -rf)');

        const stripped = withoutSuperpowersSkillDenylist(merged);
        const strippedDeny = (stripped.permissions as { deny: ReadonlyArray<string> }).deny;
        expect(strippedDeny).not.toContain(`UseSkill(${skillId})`);
        expect(strippedDeny).toContain('UseSkill(other-stays)');
        expect(strippedDeny).toContain('Bash(rm -rf)');
      });
    }
  });

  describe('from-conversation-history (idempotent strip even when re-run)', () => {
    for (const skillId of NEW_DENIED) {
      it(`idempotently strips ${skillId} when reinstalling after a prior install`, () => {
        // from-conversation-history: a prior install already wrote the
        // deny entry; a re-run of `withoutSuperpowersSkillDenylist`
        // must not double-touch unrelated entries and must not
        // resurrect our own entry.
        const once = withoutSuperpowersSkillDenylist({
          permissions: { deny: [`UseSkill(${skillId})`, 'UseSkill(other-stays)'] }
        });
        const twice = withoutSuperpowersSkillDenylist(once);
        const deny = (twice.permissions as { deny: ReadonlyArray<string> }).deny;
        expect(deny).not.toContain(`UseSkill(${skillId})`);
        expect(deny).toEqual(['UseSkill(other-stays)']);
      });
    }
  });
});
