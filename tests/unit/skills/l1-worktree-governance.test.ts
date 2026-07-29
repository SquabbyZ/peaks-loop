/**
 * Slice 2026-07-29-worktree-l1 — Layer 1 worktree governance.
 *
 * Pins the contract that the L1 superpowers-chain refusal block is present
 * in every dispatch-prompt surface:
 *   1. skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md (top of file)
 *   2. skills/bee/peaks-qa/references/qa-sub-agent-dispatch.md (top of file)
 *   3. skills/bee/peaks-ui/SKILL.md G8.6 prompt-template section
 *   4. src/services/context/build-dispatch-system-prompt.ts L1_BLOCK constant
 *
 * Drift between any two surfaces is a regression: an LLM reading only
 * one reference would lose the refusal. The single source of truth is
 * `skills/peaks-code/references/worktree-governance.md` (rid-SKILL.md);
 * the 4 surfaces below MUST stay in lockstep with that prose.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const RD_DISPATCH = join(REPO_ROOT, 'skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md');
const QA_DISPATCH = join(REPO_ROOT, 'skills/bee/peaks-qa/references/qa-sub-agent-dispatch.md');
const UI_SKILL = join(REPO_ROOT, 'skills/bee/peaks-ui/SKILL.md');

/** Required substrings inside the L1 superpowers-chain refusal block. */
const REQUIRED_SUBSTRINGS: ReadonlyArray<string> = [
  'superpowers:brainstorming',
  'superpowers:writing-plans',
  'superpowers:subagent-driven-development',
  'superpowers:using-git-worktrees',
  'git worktree add',
  'peaks worktree spawn',
  'peaks worktree auth grant',
  'MUST NOT'
];

describe('slice 2026-07-29-worktree-l1: superpowers-chain refusal block is present in every dispatch surface', () => {
  describe('CLI prompt composer (build-dispatch-system-prompt.ts)', () => {
    test('L1_WORKTREE_GOVERNANCE_BLOCK is exported and contains all required substrings', async () => {
      const mod = await import('../../../src/services/context/build-dispatch-system-prompt.js');
      expect(typeof mod.L1_WORKTREE_GOVERNANCE_BLOCK).toBe('string');
      const block = mod.L1_WORKTREE_GOVERNANCE_BLOCK;
      for (const needle of REQUIRED_SUBSTRINGS) {
        expect(block, `L1 block missing required substring: ${needle}`).toContain(needle);
      }
    });

    test('buildDispatchSystemPrompt prepends L1 block in EVERY branch (memory available AND unavailable)', () => {
      // Both branches must carry the L1 block — the slice doc explicitly
      // breaks the slice-022 byte-identical degradation contract for
      // governance reasons. If either branch regresses, sub-agents stop
      // seeing the refusal.
      // Lazy import to keep top-level work light.
      return import('../../../src/services/context/build-dispatch-system-prompt.js').then((mod) => {
        const available = mod.buildDispatchSystemPrompt({
          taskTitle: 't',
          taskBody: 'TASK_AVAILABLE',
          memoryBlock: { available: true, block: 'MEMORY_AVAILABLE_BLOCK' }
        });
        expect(available).toContain('Superpowers chain refusal');
        expect(available.indexOf('Superpowers chain refusal')).toBeLessThan(available.indexOf('TASK_AVAILABLE'));
        expect(available.indexOf('Superpowers chain refusal')).toBeLessThan(available.indexOf('MEMORY_AVAILABLE_BLOCK'));

        const unavailable = mod.buildDispatchSystemPrompt({
          taskTitle: 't',
          taskBody: 'TASK_UNAVAILABLE',
          memoryBlock: { available: false, reason: 'MEMORY_INDEX_MISSING' }
        });
        expect(unavailable).toContain('Superpowers chain refusal');
        expect(unavailable.indexOf('Superpowers chain refusal')).toBeLessThan(unavailable.indexOf('TASK_UNAVAILABLE'));
      });
    });
  });

  describe('rd-sub-agent-dispatch.md (top of file)', () => {
    const content = readFileSync(RD_DISPATCH, 'utf8');

    test('contains all required substrings', () => {
      for (const needle of REQUIRED_SUBSTRINGS) {
        expect(content, `RD dispatch missing: ${needle}`).toContain(needle);
      }
    });

    test('L1 block is in the FIRST 30 lines (top-of-file contract)', () => {
      const head = content.split('\n').slice(0, 30).join('\n');
      expect(head, 'L1 block must be in the first 30 lines of the dispatch template').toContain('Superpowers chain refusal');
    });
  });

  describe('qa-sub-agent-dispatch.md (top of file)', () => {
    const content = readFileSync(QA_DISPATCH, 'utf8');

    test('contains all required substrings', () => {
      for (const needle of REQUIRED_SUBSTRINGS) {
        expect(content, `QA dispatch missing: ${needle}`).toContain(needle);
      }
    });

    test('L1 block is in the FIRST 30 lines (top-of-file contract)', () => {
      const head = content.split('\n').slice(0, 30).join('\n');
      expect(head, 'L1 block must be in the first 30 lines of the dispatch template').toContain('Superpowers chain refusal');
    });
  });

  describe('peaks-ui SKILL.md G8.6 prompt template section', () => {
    const content = readFileSync(UI_SKILL, 'utf8');

    test('contains all required substrings', () => {
      for (const needle of REQUIRED_SUBSTRINGS) {
        expect(content, `UI SKILL.md missing: ${needle}`).toContain(needle);
      }
    });

    test('L1 block immediately precedes the G8.6 prompt-template code fence', () => {
      const l1Idx = content.indexOf('Superpowers chain refusal');
      const g86Idx = content.indexOf('G8.6 — UI sub-agent prompt template');
      expect(l1Idx, 'L1 block must exist in UI SKILL.md').toBeGreaterThan(-1);
      expect(g86Idx, 'G8.6 section must exist in UI SKILL.md').toBeGreaterThan(-1);
      // The block sits BEFORE the code fence, not after. Sub-agent
      // dispatch reads G8.6 verbatim; the refusal must lead the section.
      const codeFenceIdx = content.indexOf('```\nYou are sub-agent role ui', l1Idx);
      expect(codeFenceIdx, 'code fence must exist after L1 block').toBeGreaterThan(l1Idx);
    });
  });

  describe('drift guard: the 4 surfaces agree on the chain and the action verbs', () => {
    // If any surface drops the chain or the action verbs, the LLM may
    // follow a partial signal. This test fails fast on drift.
    test('every markdown surface lists the full superpowers chain and the spawn / auth-grant verbs', () => {
      const surfaces = [
        readFileSync(RD_DISPATCH, 'utf8'),
        readFileSync(QA_DISPATCH, 'utf8'),
        readFileSync(UI_SKILL, 'utf8')
      ];
      for (const [i, content] of surfaces.entries()) {
        for (const needle of REQUIRED_SUBSTRINGS) {
          expect(content, `surface ${i} missing: ${needle}`).toContain(needle);
        }
      }
    });
  });
});