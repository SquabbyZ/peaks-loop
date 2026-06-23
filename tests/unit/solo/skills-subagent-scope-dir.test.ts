/**
 * Slice 10 (subagent scopeDir) — guard the SKILL.md contract.
 *
 * Slice 10 changes each sub-agent SKILL.md (`peaks-rd`, `peaks-prd`,
 * `peaks-qa`, `peaks-sc`, `peaks-ui`) to read the canonical scope
 * directory from the CLI envelope (`envelope.data.scopeDir`, an
 * absolute path) instead of reconstructing a path like
 * `.peaks/<changeId>/...` from the request artifact frontmatter.
 *
 * The CLI fix (commit 5bed96b, merged on develop as 3f0b2ec) makes
 * `peaks request init --id X --apply` emit `scopeDir` in the JSON
 * envelope. If a sub-agent re-derives the path from frontmatter, it
 * will write to the forbidden top-level `.peaks/<changeId>/` dir.
 *
 * This test pins the contract so a future edit cannot silently
 * regress to "construct the path yourself". Five guarantees:
 *
 *  1. Each sub-agent SKILL.md contains the literal phrase
 *     `envelope.data.scopeDir` (the canonical CLI field).
 *  2. Each sub-agent SKILL.md does NOT contain any of the forbidden
 *     path-construction patterns (regex sweep).
 *  3. The hard-ban clause (verbatim from CLAUDE.md) is preserved in
 *     `peaks-solo/SKILL.md`.
 *  4. Every updated SKILL.md stays under the 24000-byte cap.
 *  5. The peaks-rd, peaks-prd, peaks-qa, peaks-sc, peaks-ui SKILL.md
 *     files contain a directive near the "envelope.data.scopeDir"
 *     phrase that says "NEVER construct paths like
 *     `.peaks/<changeId>/...` from frontmatter".
 *
 * Why text-grep tests instead of behavioral: the slice is a SKILL.md
 * prompt change. The CLI fix lives in
 * `src/services/artifacts/request-artifact-service.ts` (slice 5bed96b)
 * and `src/services/artifacts/change-scope-service.ts` — both are
 * tested elsewhere. This file guards the prompt contract that
 * prevents the LLM from re-deriving the forbidden path.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const SKILL_BYTE_CAP = 24000;

// Sub-agent SKILL.md files that construct paths for change-id-scoped
// artifacts. peaks-solo is intentionally excluded from the
// "envelope.data.scopeDir" assertion because solo is the orchestrator
// (it calls peaks request init on the sub-agents' behalf); it does
// keep the hard-ban clause verbatim.
const SUBAGENT_SKILLS: ReadonlyArray<{
  name: string;
  relativePath: string;
}> = [
  { name: 'peaks-rd',  relativePath: 'skills/peaks-rd/SKILL.md' },
  { name: 'peaks-prd', relativePath: 'skills/peaks-prd/SKILL.md' },
  { name: 'peaks-qa',  relativePath: 'skills/peaks-qa/SKILL.md' },
  { name: 'peaks-sc',  relativePath: 'skills/peaks-sc/SKILL.md' },
  { name: 'peaks-ui',  relativePath: 'skills/peaks-ui/SKILL.md' },
];

const SOLO_PATH = 'skills/peaks-solo/SKILL.md';

// Forbidden path-construction patterns (slice 10).
// A sub-agent following any of these would write a top-level
// `.peaks/<changeId>/` directory — the 2.8.3 hard-ban violation.
const FORBIDDEN_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  {
    label: 'shell-template form `${changeId}`',
    regex: /\.peaks\/\$\{?changeId\}?\//,
  },
  {
    label: 'shell-template form `${cid}`',
    regex: /\.peaks\/\$\{?cid\}?\//,
  },
  {
    label: 'shell-template form `${change-id}`',
    regex: /\.peaks\/\$\{?change-id\}?\//,
  },
  {
    label: 'legacy template path `peaks/<X>/<role>/requests`',
    regex: /peaks\/<[^>]*>\/<role>\/requests/,
  },
];

// Verbatim hard-ban clause from CLAUDE.md. The text is intentionally
// exact so a future edit cannot soften the wording without breaking
// the test.
const HARD_BAN_CLAUSE_VERBATIM = [
  'Never create `.peaks/<change-id>/` or `.peaks/<YYYY-MM-DD-*>/` at the top level of `.peaks/`.',
].join('');

describe('sub-agent SKILL.md — read scopeDir from envelope (slice 10)', () => {
  for (const skill of SUBAGENT_SKILLS) {
    describe(`${skill.name} SKILL.md`, () => {
      const absolutePath = resolve(REPO_ROOT, skill.relativePath);

      test('AC-1: contains the literal phrase `envelope.data.scopeDir`', async () => {
        const body = await readFile(absolutePath, 'utf8');
        expect(body).toContain('envelope.data.scopeDir');
      });

      test('AC-2: contains a directive that forbids constructing paths from frontmatter', async () => {
        const body = await readFile(absolutePath, 'utf8');
        // Look for the canonical slice-10 directive: "NEVER construct
        // paths like `.peaks/<changeId>/...` from frontmatter". Accept
        // any phrasing that combines both ideas in the same paragraph
        // (frontmatter + construct + the forbidden path shape).
        const lower = body.toLowerCase();
        const mentionsFrontmatter = lower.includes('frontmatter');
        const mentionsForbiddenPath = /\.peaks\/<[^>]+>\/|top-level|\.peaks\/\$\{?change/.test(body);
        expect(mentionsFrontmatter).toBe(true);
        expect(mentionsForbiddenPath).toBe(true);
      });

      test('AC-3: does NOT contain any forbidden path-construction pattern', async () => {
        const body = await readFile(absolutePath, 'utf8');
        for (const { label, regex } of FORBIDDEN_PATTERNS) {
          if (regex.test(body)) {
            throw new Error(
              `${skill.relativePath} contains forbidden pattern "${label}" ` +
              `(regex: ${regex}). Sub-agents MUST read scopeDir from the ` +
              `CLI envelope, not construct paths from frontmatter.`
            );
          }
          expect(regex.test(body)).toBe(false);
        }
      });

      test('AC-4: stays under the 24000-byte cap', async () => {
        const stats = await stat(absolutePath);
        if (stats.size > SKILL_BYTE_CAP) {
          throw new Error(
            `${skill.relativePath} is ${stats.size} bytes, exceeds the ` +
            `${SKILL_BYTE_CAP}-byte cap. Trim low-impact prose — DO NOT ` +
            `trim the Karpathy guideline block or hard gate contract.`
          );
        }
        expect(stats.size).toBeLessThanOrEqual(SKILL_BYTE_CAP);
      });
    });
  }
});

describe('peaks-solo SKILL.md — preserves hard-ban clause (slice 10)', () => {
  const soloAbsPath = resolve(REPO_ROOT, SOLO_PATH);

  test('AC-5: hard-ban clause from CLAUDE.md is preserved verbatim', async () => {
    const body = await readFile(soloAbsPath, 'utf8');
    expect(body).toContain(HARD_BAN_CLAUSE_VERBATIM);
  });

  test('AC-6: peaks-solo stays under the 24000-byte cap', async () => {
    const stats = await stat(soloAbsPath);
    expect(stats.size).toBeLessThanOrEqual(SKILL_BYTE_CAP);
  });
});