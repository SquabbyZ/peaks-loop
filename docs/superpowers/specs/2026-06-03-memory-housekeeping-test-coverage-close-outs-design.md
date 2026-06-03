# Test Coverage Close-Outs: 2 Important follow-ups from the 2026-06-03 slice final review

> Date: 2026-06-03
> Slice: 2026-06-03-memory-housekeeping-test-coverage-close-outs
> Type: `chore` (test-only, no API surface change, no new CLI, no source change)
> Companion to: slice `2026-06-03-memory-housekeeping-minor-findings` (commit `cc9edc4`)

## 1. Goal

Close the two Important test-coverage gaps flagged by the final code review of slice `2026-06-03-memory-housekeeping-minor-findings`. Both gaps are real but bounded: each pin a branch the existing suite does not cover. The slice is a test-only follow-up; no source code or memory files change.

## 2. Scope (in / out)

**In:**

1. `tests/unit/project-memory-service.test.ts` — extend the existing `describe('summarizeMemoryBody description truncation', ...)` block with one additional case at body length 118 chars (between the current 117-truncate and 120-pass-through). This pins the `<=` comparison at L391 of `summarizeMemoryBody` against future off-by-one refactors.
2. `tests/unit/project-memory-service.test.ts` — extend the existing `describe('readMemoryIndex mtime-based regeneration guard', ...)` block with one additional case for the **equal-mtime** boundary (memory mtime == index mtime). This pins the strict `>` comparison at L541 of `shouldRegenerateIndex` (versus `>=` which would defeat the guard on every read).

**Out (explicit non-goals):**

- No source code changes (constants, helper, guard, bootstrap removal all already shipped in `cc9edc4`).
- No new CLI command.
- No memory file or `index.json` edits.
- No codification of `closedAt` / `closedBy` / `remainingMinorSlice` frontmatter as a shared schema (deferred).
- No fix for the 7 pre-existing Windows test failures in `config-safety-canonical-root.test.ts` (5) and `statusline-settings-service.test.ts` (2) — these are environmental and unrelated to the slice; the Task 4 implementer stash-verified they predate the slice.
- No fix for the spec/plan stale-path reference (`.peaks/memory/hot/feedback/...` doesn't exist) — the live code is correct; the spec/plan are now git history and the bug is documented in the review and the slice doc.
- No coverage work for the 5 Minor items the final reviewer raised (wording, ergonomics of the recovery hint, magic string `'Project memory'`, etc.).

## 3. Design: 118-char boundary case

**Where:** append a 4th `descN` variable + assertion block to the existing `describe('summarizeMemoryBody description truncation', ...)` block at the bottom of the file.

**Why 118:** the existing boundary test covers 120 (pass-through) and 121 (truncate). 118 is the midpoint of the `<= 120` pass-through range — between 117 (which is `MAX_DESCRIPTION_LENGTH - ELLIPSIS_RESERVE` and the start of the truncate range) and 120. If a future refactor drifts the comparison to `< 120` (off-by-one), the 118 case would catch it; the existing 120 case would not (120 is no longer covered by the pass-through branch under the drifted comparison).

**Test shape** (added to the existing boundary test, alongside `desc120` / `desc121` / `desc200`):

```ts
// 118-char sentence: between 117 (start of truncate range) and 120
// (pass-through cap). Pins the < 120 vs <= 120 comparison at L391 of
// summarizeMemoryBody.
const exactly118 = 'A'.repeat(117) + '.';
writeFileSync(join(memoryDir, 'boundary-118.md'), [
  '---',
  'name: boundary-118',
  'description: Boundary 118',
  'metadata:',
  '  type: feedback',
  '  sourceArtifact: rd/artifact.md',
  '---',
  '',
  exactly118,
  ''
].join('\n'), 'utf8');

const desc118 = byName('boundary-118')?.description ?? '';

// 118 chars: pass-through branch (<= 120). No ellipsis.
expect(desc118.length).toBe(118);
expect(desc118.endsWith('...')).toBe(false);
```

The test still uses the public `readMemoryIndex` API (not the private `summarizeMemoryBody`), consistent with the existing boundary test.

## 4. Design: equal-mtime case

**Where:** append a 3rd test to the existing `describe('readMemoryIndex mtime-based regeneration guard', ...)` block.

**Why equal-mtime matters:** the helper at L541 uses strict `>`:
```ts
if (memoryMtimeMs > indexMtimeMs) return true;
```
A `>=` here would force a regenerate on every read when the memory mtime equals the index mtime — defeating the entire guard. Pinning the equal-mtime case nails down the choice of `>` (versus `>=`) so a future refactor that "tidies" the comparison to `>=` triggers a test failure.

**Test shape** (a new test, after the existing stable + stale tests):

```ts
test('does not rewrite index.json when memory mtime equals index mtime', () => {
  const projectRoot = createTempDir('peaks-memory-mtime-equal');
  const memoryDir = join(projectRoot, '.peaks', 'memory');
  mkdirSync(memoryDir, { recursive: true });

  const memoryPath = join(memoryDir, 'equal-memory.md');
  writeFileSync(memoryPath, [
    '---',
    'name: equal-memory',
    'description: Equal mtime memory',
    'metadata:',
    '  type: feedback',
    '  sourceArtifact: rd/artifact.md',
    '---',
    '',
    'Body content for equal-mtime test.',
    ''
  ].join('\n'), 'utf8');
  const past = new Date(Date.now() - 60_000);
  utimesSync(memoryPath, past, past);

  // First read populates the index.
  readMemoryIndex(projectRoot);
  const indexPath = join(memoryDir, 'index.json');
  const indexMtime = new Date(statSync(indexPath).mtimeMs);
  const mtimeAfterFirst = indexMtime.getTime();

  // Set the memory mtime EQUAL to the index mtime. The helper uses
  // strict `>` so this must NOT trigger a regen.
  utimesSync(memoryPath, indexMtime, indexMtime);

  // Wait long enough to be in a different filesystem-resolution bucket
  // (Windows NTFS is 1ms; 25ms is the same margin the existing tests use).
  const before = Date.now();
  while (Date.now() - before < 25) { /* spin briefly */ }
  readMemoryIndex(projectRoot);

  expect(statSync(indexPath).mtimeMs).toBe(mtimeAfterFirst);
});
```

The test reuses the existing `utimesSync` + 25ms spin-wait pattern from the other mtime tests. The 25ms spin is necessary so that an erroneous rewrite would land in a different filesystem-resolution bucket and be observable; without the spin, on Windows NTFS the 1ms-resolution can mask a rewrite that the mtime guard accidentally triggers.

## 5. Test plan

Two additions to one file (`tests/unit/project-memory-service.test.ts`); no new test files, no new imports. After this slice:
- `project-memory-service.test.ts`: 38 → 40 tests passing (the 4 pre-existing platform-conditional Windows symlink skips remain skipped on Windows).

The slice adds tests for **two real branches** the existing 38-case suite does not cover:
1. The 118-char case inside the `<= 120` pass-through range.
2. The equal-mtime case at the strict `>` boundary.

No new integration test, no new mock, no new fixture. Both cases follow the existing `createTempDir` pattern.

## 6. Type classification & workflow

**Type:** `chore` (per the type taxonomy in `skills/peaks-solo/SKILL.md`):

- Pure test additions; no source code change.
- No API surface change.
- No new CLI, no new artifact path, no new skill content.
- Existing 38 tests in the file must still pass; 2 new tests added (real-branch coverage per the project's `coverage-red-line` memory).

**Workflow** (per `main-branch-iteration`, no worktree):

- Skip the full peaks-solo / PRD / RD / QA / SC handoff.
- One commit on main.
- Commit message format: `chore(memory): close 2 test-coverage gaps from slice final review`

## 7. Risk and rollback

**Risk:** low. Both changes are:

- 118-char case: a new memory markdown file + a few new `expect` assertions inside the existing boundary test. No new code path exercised beyond the existing `<= 120` branch.
- Equal-mtime case: a new test using the same `utimesSync` + 25ms spin pattern already in the file. No source change.

**Rollback:** one `git revert` of the single commit removes the two new test cases. The source code (helper, constants, guard) is unaffected — it's already in `cc9edc4`.

**Testability of the rollback:** if a future reader wants to verify the slice is reversible, `git revert` produces a clean diff that removes only the 2 added tests; the 38 existing tests still pass.

## 8. Open questions (none blocking)

- Should the 2 new tests be added to the existing test blocks (proposed) or split into a new top-level `describe` block per case? **Propose adding to existing blocks; this keeps the related assertions co-located and avoids artificial separation.**
- Should the equal-mtime test be moved into the boundary test instead of staying in the mtime block? **No — it's an mtime-guard concern, not a truncation concern. It belongs in the mtime describe block.**
