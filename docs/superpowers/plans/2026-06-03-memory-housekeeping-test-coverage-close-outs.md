# Test Coverage Close-Outs: 2 Important follow-ups from the memory slice final review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 2 test cases that pin the boundary cases flagged by the final code review of slice `2026-06-03-memory-housekeeping-minor-findings` (commit `cc9edc4`). No source change.

**Architecture:** Extend the 2 existing describe blocks in `tests/unit/project-memory-service.test.ts` (one in `summarizeMemoryBody description truncation`, one in `readMemoryIndex mtime-based regeneration guard`) with one new test each. The new cases cover the 118-char pass-through midpoint and the equal-mtime strict-`>` boundary respectively. Both follow the existing `createTempDir` + `utimesSync` + `readMemoryIndex` pattern.

**Tech Stack:** TypeScript (Node ≥20), vitest, `node:fs` (`statSync` / `utimesSync` already imported).

**Spec:** `docs/superpowers/specs/2026-06-03-memory-housekeeping-test-coverage-close-outs-design.md`

**Type:** `chore` — no peaks-solo / PRD / RD / QA / SC handoff.

---

## File Structure

| File | Type | Reason |
|---|---|---|
| `tests/unit/project-memory-service.test.ts` | modify | add 2 test cases (118-char + equal-mtime) |
| `docs/superpowers/specs/2026-06-03-memory-housekeeping-test-coverage-close-outs-design.md` | already exists | already committed as `f756c4c` |
| `docs/superpowers/plans/2026-06-03-memory-housekeeping-test-coverage-close-outs.md` | this file | companion to the spec |

No new files. No source code changes. No CLI changes. No memory file changes.

---

## Task 1: Add 2 close-out test cases + commit

**Files:**
- Modify: `tests/unit/project-memory-service.test.ts` (2 new test blocks; no other changes)

Both new cases follow the exact patterns already in the file. No new imports needed (`statSync` / `utimesSync` are already imported from `node:fs` from the Task 2 mtime work).

- [ ] **Step 1: Add the 118-char case to the existing boundary test**

Open `tests/unit/project-memory-service.test.ts`. Find the existing test `'passes through sentences at or below the 120-char cap, truncates above with ellipsis'` inside the `describe('summarizeMemoryBody description truncation', ...)` block.

The test currently declares 3 sentences (`exactly120`, `exactly121`, `wayAbove`), writes 3 memory files (`boundary-120.md`, `boundary-121.md`, `boundary-200.md`), and asserts `desc120` / `desc121` / `desc200`.

Add a 4th `exactlyN` sentence and a 4th memory file `boundary-118.md`, plus assertions for the 4th case. The diff inside the test is:

1. After the line `const wayAbove = 'A'.repeat(199) + '.';`, add:
   ```ts
   // 118-char sentence: between 117 (start of truncate range) and 120
   // (pass-through cap). Pins the < 120 vs <= 120 comparison at L391 of
   // summarizeMemoryBody against future off-by-one refactors.
   const exactly118 = 'A'.repeat(117) + '.';
   ```

2. After the `writeFileSync(join(memoryDir, 'boundary-200.md'), ...)` call, add a parallel `writeFileSync` for `boundary-118.md`:
   ```ts
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
   ```

3. After the line `const desc200 = byName('boundary-200')?.description ?? '';`, add:
   ```ts
   const desc118 = byName('boundary-118')?.description ?? '';
   ```

4. After the line `expect(desc200.endsWith('...')).toBe(true);`, add:
   ```ts
   // 118 chars: pass-through branch (<= 120). No ellipsis.
   expect(desc118.length).toBe(118);
   expect(desc118.endsWith('...')).toBe(false);
   ```

The boundary test now exercises 4 sentence lengths: 118 / 120 / 121 / 200.

- [ ] **Step 2: Add the equal-mtime test as a new test in the existing mtime describe block**

In the same file, find the `describe('readMemoryIndex mtime-based regeneration guard', ...)` block. It currently has 2 tests (`does not rewrite...` and `rewrites index.json...`).

Append a 3rd test inside this describe block (before the closing `});` of the describe):

```ts
  test('does not rewrite index.json when memory mtime equals index mtime', () => {
    // shouldRegenerateIndex uses strict `>` (not `>=`) at the mtime
    // comparison (project-memory-service.ts L541). A `>=` would force a
    // regen on every read when the memory mtime equals the index
    // mtime, defeating the guard. This test pins the strict-`>` choice
    // so a future refactor that "tidies" the comparison triggers a
    // failure here.
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

    // Set the memory mtime EQUAL to the index mtime.
    utimesSync(memoryPath, indexMtime, indexMtime);

    // Wait long enough to be in a different filesystem-resolution bucket
    // (Windows NTFS is 1ms; 25ms is the same margin the existing tests use).
    const before = Date.now();
    while (Date.now() - before < 25) { /* spin briefly */ }
    readMemoryIndex(projectRoot);

    expect(statSync(indexPath).mtimeMs).toBe(mtimeAfterFirst);
  });
```

Note: the test asserts the mtime is byte-identical (no rewrite). The 25ms spin ensures an erroneous rewrite would land in a different filesystem-resolution bucket and be observable. The `utimesSync(memoryPath, indexMtime, indexMtime)` call sets atime and mtime to the same `Date` value as the index.

- [ ] **Step 3: Run the new tests to confirm both pass**

Run: `cd c:/Users/smallMark/Desktop/peaks-cli && npx vitest run tests/unit/project-memory-service.test.ts -t "summarizeMemoryBody description truncation"`
Expected: 2 passed (the existing boundary + fallback tests still pass; the new 118-char case is now part of the boundary test, so the count is unchanged but the assertions are stronger).

Run: `cd c:/Users/smallMark/Desktop/peaks-cli && npx vitest run tests/unit/project-memory-service.test.ts -t "readMemoryIndex mtime-based regeneration guard"`
Expected: 3 passed (the 2 existing mtime tests + the new equal-mtime test).

If either fails, the most likely causes are: (a) the 118-char memory file is being parsed as 2 sentences (the period in `'A'.repeat(117) + '.'` should keep it as one sentence; if it doesn't, the file should be inspected), or (b) the equal-mtime test hits Windows NTFS 1ms resolution and the spin-wait isn't enough (the same 25ms margin that works for tests 1 and 2 should also work here).

- [ ] **Step 4: Run the full service test file to confirm no regressions**

Run: `cd c:/Users/smallMark/Desktop/peaks-cli && npx vitest run tests/unit/project-memory-service.test.ts`
Expected: 40 passed (38 prior + 2 from the 2 new test cases / 1 new assertion in the existing boundary test), 4 skipped (pre-existing platform-conditional Windows symlink tests).

- [ ] **Step 5: Run the TypeScript type-check**

Run: `cd c:/Users/smallMark/Desktop/peaks-cli && npx tsc -p tsconfig.json --noEmit`
Expected: no errors from the slice. (3 pre-existing unrelated `chalk`/`ora` errors in `progress-commands.ts` / `progress-watch-render.ts` are unrelated and predate the slice; do not fix them.)

- [ ] **Step 6: Stage the changes and review the diff**

Run:
```bash
cd c:/Users/smallMark/Desktop/peaks-cli
git status --short
git diff --stat
```

Expected: only `tests/unit/project-memory-service.test.ts` modified. No other files.

- [ ] **Step 7: Commit on main**

Run:
```bash
cd c:/Users/smallMark/Desktop/peaks-cli
git add tests/unit/project-memory-service.test.ts
git commit -m "chore(memory): close 2 test-coverage gaps from slice final review

The 2026-06-03-memory-housekeeping-minor-findings slice's final code
review flagged 2 Important coverage gaps that were 'not blocking, but
follow-up'. This slice closes them:

1. summarizeMemoryBody boundary test: add 118-char case. The existing
   test pins 120/121/200; the 118-char case inside the <= 120
   pass-through range is now pinned too, gating against off-by-one
   refactors of the < 120 vs <= 120 comparison at L391.
2. shouldRegenerateIndex equal-mtime case: new test pins the strict >
   choice (vs >=) at L541. A >= would force regen on every read when
   memory mtime == index mtime, defeating the entire guard.

No source change. 38 -> 40 tests in the file. 1 commit on main per
main-branch-iteration.
"
```

Expected: one commit lands on `main`. `git log -1` shows the message verbatim and 1 file changed.

- [ ] **Step 8: Verify the working tree is clean**

Run: `cd c:/Users/smallMark/Desktop/peaks-cli && git status --short`
Expected: empty output.

---

## Self-Review

- **Spec coverage:**
  - §3 (118-char) → Task 1 step 1 (adds the 4th case to the existing boundary test).
  - §4 (equal-mtime) → Task 1 step 2 (adds the 3rd test to the existing mtime describe block).
  - §5 (test plan) → Task 1 steps 3-4 (run + assert counts match).
  - §6 (chore, 1 commit on main) → Task 1 step 7.
  - §7 (risk: rollback) → verified by `git revert` of the single commit.
  - §8 (open questions) → both answered in the spec.
- **Placeholder scan:** no TBD/TODO. The 118-char code block and the equal-mtime test body are provided verbatim in steps 1 and 2.
- **Type consistency:** `utimesSync` and `statSync` are already imported in the test file (from the Task 2 mtime work) — no new imports needed. The 4th memory file `boundary-118.md` and the 3rd test name `'does not rewrite index.json when memory mtime equals index mtime'` follow the existing naming conventions.
- **DRY/YAGNI:** no new abstractions. The 4th memory file is a near-clone of the existing 3, which is the established pattern in the file.
