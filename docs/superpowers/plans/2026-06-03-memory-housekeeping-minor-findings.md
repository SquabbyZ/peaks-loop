# Memory Housekeeping: clear 2 minor findings + retire stale review memory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the 2 remaining minor findings (magic numbers, read-side regeneration) from the 2026-06-01 review `review-memories-extract-and-memory-index.md` and retire the now-stale review memory. 1 commit on main, no new CLI, no API surface change.

**Architecture:** Pure refactor + an mtime-based read guard inside `src/services/memory/project-memory-service.ts`. The two private helpers (`summarizeMemoryBody`, `readMemoryIndex`) keep their names and signatures. The regeneration behaviour of `readMemoryIndex` shifts from "always when any memory exists" to "only when index.json is older than the newest memory.md". Behaviour is byte-identical for the user-visible output, and a regression-guard test pins the new contract.

**Tech Stack:** TypeScript (Node ≥20), vitest, `node:fs` (`utimesSync`).

**Spec:** `docs/superpowers/specs/2026-06-03-memory-housekeeping-minor-findings-design.md`

**Type:** `chore` — no peaks-solo / PRD / RD / QA / SC handoff.

---

## File Structure

Files touched in this slice (one commit):

| File | Type | Reason |
|---|---|---|
| `src/services/memory/project-memory-service.ts` | modify | extract constants; add `shouldRegenerateIndex` helper; gate the `readMemoryIndex` rebuild |
| `tests/unit/project-memory-service.test.ts` | modify | add 2 unit cases (boundary truncation; mtime guard) |
| `.peaks/memory/hot/feedback/review-memories-extract-and-memory-index.md` | rewrite | retire as "closed"; cross-reference this slice |
| `.peaks/memory/index.json` | modify | update `description` + `updatedAt` for the retired memory |

No new files. No new CLI. No new artifacts. No new skill content.

---

## Task 1: Named constants in `summarizeMemoryBody` + boundary test

**Files:**
- Modify: `src/services/memory/project-memory-service.ts:367-385`
- Test: `tests/unit/project-memory-service.test.ts`

This is a refactor with a regression-guard test. The behaviour of `summarizeMemoryBody` does not change; we are replacing 3 magic numbers with named constants and pinning the truncation boundary in a test so a future refactor cannot silently drift the rule.

- [ ] **Step 1: Write the boundary test**

Open `tests/unit/project-memory-service.test.ts` and add a new `describe` block at the end of the file (before the closing `describe('ensureMemoryBootstrap (cold-start fix)')` if present, otherwise at the very end):

```ts
describe('summarizeMemoryBody description truncation', () => {
  // Pin the truncation rule: descriptions are capped at MAX_DESCRIPTION_LENGTH
  // (120) characters. Sentences at or below the cap pass through unchanged;
  // sentences above the cap are truncated to (MAX_DESCRIPTION_LENGTH -
  // ELLIPSIS_RESERVE) chars and suffixed with "...". This locks the
  // 117 magic number down so future refactors cannot silently drift the
  // rule.
  test('passes through sentences at or below the 120-char cap, truncates above with ellipsis', () => {
    const projectRoot = createTempDir('peaks-memory-description-cap');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });

    // 120-char sentence: ends in a period so the sentence splitter keeps it.
    const exactly120 = 'A'.repeat(119) + '.';
    // 121-char sentence: triggers the truncation branch.
    const exactly121 = 'A'.repeat(120) + '.';
    // 200-char sentence: well above the cap.
    const wayAbove = 'A'.repeat(199) + '.';

    writeFileSync(join(memoryDir, 'boundary-120.md'), [
      '---',
      'name: boundary-120',
      'description: Boundary 120',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      exactly120,
      ''
    ].join('\n'), 'utf8');
    writeFileSync(join(memoryDir, 'boundary-121.md'), [
      '---',
      'name: boundary-121',
      'description: Boundary 121',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      exactly121,
      ''
    ].join('\n'), 'utf8');
    writeFileSync(join(memoryDir, 'boundary-200.md'), [
      '---',
      'name: boundary-200',
      'description: Boundary 200',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      wayAbove,
      ''
    ].join('\n'), 'utf8');

    const index = readMemoryIndex(projectRoot);
    expect(index).not.toBeNull();

    const byName = (name: string) => index!.hot.feedback.find((entry) => entry.name === name);
    const desc120 = byName('boundary-120')?.description ?? '';
    const desc121 = byName('boundary-121')?.description ?? '';
    const desc200 = byName('boundary-200')?.description ?? '';

    // 120 chars: passes through unchanged, no ellipsis.
    expect(desc120.length).toBe(120);
    expect(desc120.endsWith('...')).toBe(false);
    // 121 chars: truncated to 117 + "..." = 120 chars total.
    expect(desc121.length).toBe(120);
    expect(desc121.endsWith('...')).toBe(true);
    expect(desc121.slice(0, 117)).toBe('A'.repeat(117));
    // 200 chars: same rule, also lands at 120 chars with ellipsis.
    expect(desc200.length).toBe(120);
    expect(desc200.endsWith('...')).toBe(true);
  });

  test('falls back to body slice when no sentence exceeds MIN_BODY_SENTENCE_LENGTH', () => {
    // Sentences of length <= 20 are filtered out. With no surviving
    // sentence, summarizeMemoryBody falls back to cleaned.slice(0, 120) or
    // 'Project memory' if the cleaned body is empty. This pins the
    // fallback path.
    const projectRoot = createTempDir('peaks-memory-description-fallback');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });

    writeFileSync(join(memoryDir, 'short-sentences.md'), [
      '---',
      'name: short-sentences',
      'description: Short sentences',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'Hi. Ok. Yes. Done. No. Go. Up. Down. Left. Right. Big.',
      ''
    ].join('\n'), 'utf8');

    const index = readMemoryIndex(projectRoot);
    const entry = index!.hot.feedback.find((e) => e.name === 'short-sentences');
    expect(entry).toBeDefined();
    // The fallback slices the cleaned body to MAX_DESCRIPTION_LENGTH (120).
    expect(entry!.description.length).toBeLessThanOrEqual(120);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they pass against the unrefactored code**

Run: `npx vitest run tests/unit/project-memory-service.test.ts -t "summarizeMemoryBody description truncation"`
Expected: PASS. The test is a regression guard; the current code already implements the boundary correctly. The constants are just an extraction.

If a case fails, the current code is wrong. Stop and investigate before refactoring.

- [ ] **Step 3: Extract the named constants in `project-memory-service.ts`**

Open `src/services/memory/project-memory-service.ts`. Add a new constant block immediately above the `// Description summarization` section comment (currently around line 363). Place it next to the other file-level constants like `START_MARKER` / `END_MARKER` (around line 151):

```ts
// Length bounds for index entry descriptions. The numbers were chosen when
// summarizeMemoryBody was first introduced; locking them in as named
// constants is a doc-as-code move so the truncation rule is no longer
// "magic". Bump MAX_DESCRIPTION_LENGTH deliberately if downstream UIs grow.
const MIN_BODY_SENTENCE_LENGTH = 20;   // skip fragments shorter than this when picking a leading sentence
const MAX_DESCRIPTION_LENGTH = 120;    // hard cap on description length in the memory index entry
const ELLIPSIS_RESERVE = 3;             // length of the trailing "..." when truncating with an ellipsis
```

Then replace the body of `summarizeMemoryBody` (lines 367-385) with the constant-driven version:

```ts
function summarizeMemoryBody(body: string): string {
  const cleaned = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();

  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(
    (s) => s.length > MIN_BODY_SENTENCE_LENGTH && !/^\[.+\]$/.test(s)
  );
  if (sentences.length === 0) {
    return cleaned.slice(0, MAX_DESCRIPTION_LENGTH) || 'Project memory';
  }

  const first = sentences[0]!;
  if (first.length <= MAX_DESCRIPTION_LENGTH) {
    return first;
  }
  return first.slice(0, MAX_DESCRIPTION_LENGTH - ELLIPSIS_RESERVE) + '...';
}
```

Notes on the diff:
- `20` (filter) → `MIN_BODY_SENTENCE_LENGTH`
- `120` (slice + length check) → `MAX_DESCRIPTION_LENGTH`
- `117` (slice) → `MAX_DESCRIPTION_LENGTH - ELLIPSIS_RESERVE`; the `117` literal is no longer present in the source.
- The `'Project memory'` fallback string is unchanged.
- No other call site changes; `summarizeMemoryBody` is only called from `generateMemoryIndexFile` (line 470).

- [ ] **Step 4: Re-run the new tests to confirm they still pass after the refactor**

Run: `npx vitest run tests/unit/project-memory-service.test.ts -t "summarizeMemoryBody description truncation"`
Expected: PASS. Behaviour is byte-identical.

- [ ] **Step 5: Run the full service test file to confirm no regressions**

Run: `npx vitest run tests/unit/project-memory-service.test.ts`
Expected: all 36 tests pass (34 prior + 2 new). 0 regressions.

If anything regresses, the most likely culprit is a typo'd constant name. Fix and re-run.

---

## Task 2: Mtime-based regeneration guard in `readMemoryIndex`

**Files:**
- Modify: `src/services/memory/project-memory-service.ts:515-548`
- Test: `tests/unit/project-memory-service.test.ts`

This is a real TDD red → green: the test "no rewrite when index is newer than memory" FAILS against the current code (which always rewrites) and PASSES after the guard lands.

- [ ] **Step 1: Write the failing mtime-guard test**

Append a new `describe` block at the end of `tests/unit/project-memory-service.test.ts`:

```ts
describe('readMemoryIndex mtime-based regeneration guard', () => {
  // readMemoryIndex must not regenerate the index.json file when every
  // memory.md is older than (or equal to) index.json. Prior to this guard
  // the function rewrote index.json on every call when any memory existed,
  // which is a "read has write side effect" smell and inflates the
  // mtime-based cache invalidation cost for downstream readers.
  test('does not rewrite index.json when every memory.md is older than the existing index', () => {
    const projectRoot = createTempDir('peaks-memory-mtime-stable');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });

    // Pre-create a memory file with a backdated mtime so it is "older
    // than" the index that readMemoryIndex will write.
    const memoryPath = join(memoryDir, 'old-memory.md');
    writeFileSync(memoryPath, [
      '---',
      'name: old-memory',
      'description: Old memory',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'Original body that the first read should index.',
      ''
    ].join('\n'), 'utf8');
    const past = new Date(Date.now() - 60_000);
    utimesSync(memoryPath, past, past);

    // First call: index.json is created (or materialised empty + regen
    // via the always-rebuild path). This is the baseline.
    readMemoryIndex(projectRoot);
    const indexPath = join(memoryDir, 'index.json');
    const mtimeAfterFirst = statSync(indexPath).mtimeMs;
    const contentAfterFirst = readFileSync(indexPath, 'utf8');

    // Second call: nothing changed. The mtime must be byte-identical
    // (no rewrite). Wait a few ms so an erroneous rewrite would bump
    // mtimeMs and we can distinguish.
    const before = Date.now();
    while (Date.now() - before < 25) { /* spin briefly */ }
    readMemoryIndex(projectRoot);

    expect(statSync(indexPath).mtimeMs).toBe(mtimeAfterFirst);
    expect(readFileSync(indexPath, 'utf8')).toBe(contentAfterFirst);
  });

  test('rewrites index.json when a memory.md mtime exceeds the index mtime', () => {
    const projectRoot = createTempDir('peaks-memory-mtime-stale');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });

    const memoryPath = join(memoryDir, 'fresh-memory.md');
    writeFileSync(memoryPath, [
      '---',
      'name: fresh-memory',
      'description: Fresh memory',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'First version of the body.',
      ''
    ].join('\n'), 'utf8');
    const past = new Date(Date.now() - 60_000);
    utimesSync(memoryPath, past, past);

    readMemoryIndex(projectRoot);
    const indexPath = join(memoryDir, 'index.json');
    const mtimeAfterFirst = statSync(indexPath).mtimeMs;
    const firstContent = readFileSync(indexPath, 'utf8');
    const firstIndex = JSON.parse(firstContent);
    expect(firstIndex.hot.feedback).toHaveLength(1);
    expect(firstIndex.hot.feedback[0].name).toBe('fresh-memory');

    // Edit the memory body and bump its mtime into the future relative
    // to the existing index.
    writeFileSync(memoryPath, [
      '---',
      'name: fresh-memory',
      'description: Fresh memory',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'Second version of the body, after an edit.',
      ''
    ].join('\n'), 'utf8');
    const future = new Date(Date.now() + 60_000);
    utimesSync(memoryPath, future, future);

    readMemoryIndex(projectRoot);

    const mtimeAfterSecond = statSync(indexPath).mtimeMs;
    expect(mtimeAfterSecond).toBeGreaterThan(mtimeAfterFirst);

    const secondIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
    // The memory was rewritten, so the index must contain the new body.
    expect(secondIndex.hot.feedback[0].name).toBe('fresh-memory');
    // The description is the summarized body, which changed.
    expect(secondIndex.hot.feedback[0].description).not.toBe(firstIndex.hot.feedback[0].description);
  });
});
```

The new tests use `utimesSync` and `statSync`. Add both to the `node:fs` import at the top of the test file:

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
```

- [ ] **Step 2: Run the new tests to confirm the first one FAILS against the unrefactored code**

Run: `npx vitest run tests/unit/project-memory-service.test.ts -t "readMemoryIndex mtime-based regeneration guard"`
Expected for the first test: FAIL with a message showing that `statSync(indexPath).mtimeMs` differs between the two calls. The second test should pass (because the current code always rewrites).

If both pass, the test is not actually exercising the guard. Stop and re-check the assertions.

- [ ] **Step 3: Add the `shouldRegenerateIndex` helper**

In `src/services/memory/project-memory-service.ts`, add this helper just above the `readMemoryIndex` function (around line 514). Place it next to the other private helpers like `readExistingIndex`:

```ts
// Decide whether readMemoryIndex should rebuild the on-disk index.json.
// The rule is: rebuild iff index.json is missing OR any memory.md has an
// mtime strictly greater than index.json's mtime. Any statSync failure
// falls back to "rebuild" — a safe default that matches the prior
// always-rebuild behaviour and avoids serving a stale index from a
// partially-corrupt dir.
function shouldRegenerateIndex(indexPath: string, memoryFiles: string[]): boolean {
  let indexMtimeMs = 0;
  try {
    indexMtimeMs = statSync(indexPath).mtimeMs;
  } catch {
    return true; // no index → must regenerate
  }
  for (const memoryPath of memoryFiles) {
    try {
      const memoryMtimeMs = statSync(memoryPath).mtimeMs;
      if (memoryMtimeMs > indexMtimeMs) return true;
    } catch {
      return true; // unreadable file → safe default is regenerate
    }
  }
  return false;
}
```

- [ ] **Step 4: Gate the regeneration call in `readMemoryIndex`**

Replace the unconditional regeneration block in `readMemoryIndex` (currently lines 538-545):

```ts
  const files = listMarkdownFiles(memoryDir);
  if (files.length > 0) {
    try {
      generateMemoryIndexFile(normalizedRoot, memoryDir, indexPath);
    } catch {
      // fall through to read existing
    }
  }
```

with the mtime-guarded version:

```ts
  const files = listMarkdownFiles(memoryDir);
  if (files.length > 0 && shouldRegenerateIndex(indexPath, files)) {
    try {
      generateMemoryIndexFile(normalizedRoot, memoryDir, indexPath);
    } catch {
      // fall through to read existing
    }
  }
```

The bootstrap and missing-index branches above (L525-536) stay untouched — they are independent of the regeneration guard and run before any memory file is consulted.

- [ ] **Step 5: Re-run the new tests to confirm both now pass**

Run: `npx vitest run tests/unit/project-memory-service.test.ts -t "readMemoryIndex mtime-based regeneration guard"`
Expected: PASS for both cases.

- [ ] **Step 6: Run the full service test file to confirm no regressions**

Run: `npx vitest run tests/unit/project-memory-service.test.ts`
Expected: all 36 tests pass (34 prior + 2 new mtime cases; the 2 summarization cases from Task 1 also pass). 0 regressions.

If a prior test regresses, the most likely cause is the mtime guard returning true in a case the previous always-rebuild logic was unintentionally relying on. Investigate before continuing.

---

## Task 3: Retire the stale review memory + update `index.json`

**Files:**
- Modify: `.peaks/memory/hot/feedback/review-memories-extract-and-memory-index.md` (full rewrite)
- Modify: `.peaks/memory/index.json`

The hot-tier memory `review-memories-extract-and-memory-index` advertises 3 BLOCKER findings that are no longer real. Rewriting it as a "closed" stub stops the index from misleading future agents. The 2 remaining minor findings (this slice) are referenced from the closed stub.

- [ ] **Step 1: Rewrite the review memory as a closed stub**

Open `.peaks/memory/hot/feedback/review-memories-extract-and-memory-index.md` and replace its entire content with:

```markdown
---
name: review-memories-extract-and-memory-index
description: [CLOSED 2026-06-02 in e611daf] Code review findings on the 2026-06-01 uncommitted changes to project-memory-service.ts — see history for the full blocker / medium / minor list.
metadata:
  type: feedback
  closedAt: 2026-06-02
  closedBy: e611daf
  remainingMinorSlice: 2026-06-03-memory-housekeeping-minor-findings
---

This review memory is **closed**. The 3 BLOCKER + 1 MEDIUM + 1 of 3 minor findings were addressed in commit `e611daf` (2026-06-02 00:04, "feat(memory): hot/warm index + session extract with idempotency and --dry-run/--apply parity"). The remaining 2 minor findings (magic numbers in `summarizeMemoryBody`, read-side regeneration in `readMemoryIndex`) are addressed in slice **2026-06-03-memory-housekeeping-minor-findings**.

For historical context, see the original file body in `git log -p e611daf^ -- .peaks/memory/hot/feedback/review-memories-extract-and-memory-index.md` or any reflog entry before the rewrite on 2026-06-03.

**Why closed:** All BLOCKER findings must be fixed before a memory goes live; the BLOCKERs are gone. Review-of-uncommitted-changes memories should not remain in the hot tier after the change lands.

**How to apply:** Do not re-introduce this memory as a live blocker. If a future change touches `project-memory-service.ts` extract paths, run a fresh review rather than consulting this closed record.
```

- [ ] **Step 2: Update the matching entry in `.peaks/memory/index.json`**

Open `.peaks/memory/index.json`. Find the entry in `hot.feedback` whose `name` is `review-memories-extract-and-memory-index` and replace the two fields:

- `description`: from `"The new \`peaks project memories:extract\` and \`peaks project memory-index\` commands are wired correctly at the schema and CLI surface, but the implementation has three blockers and one MEDIUM finding that should be fixed before this lands."` to `"[CLOSED 2026-06-02 in e611daf] Code review findings on the 2026-06-01 uncommitted changes to project-memory-service.ts."`
- `updatedAt`: from the prior value to `"2026-06-03"`

Do not change the entry's `name`, `kind`, `sourcePath`, or `sourceArtifact`. The index is otherwise untouched.

- [ ] **Step 3: Verify the closed memory still parses**

Run: `node -e "const fs=require('fs'); const i=JSON.parse(fs.readFileSync('.peaks/memory/index.json','utf8')); const e=i.hot.feedback.find(x=>x.name==='review-memories-extract-and-memory-index'); console.log(e ? 'OK: ' + JSON.stringify(e) : 'MISSING')"`
Expected: `OK: {"name":"review-memories-extract-and-memory-index","kind":"feedback","description":"[CLOSED 2026-06-02 in e611daf] Code review findings on the 2026-06-01 uncommitted changes to project-memory-service.ts.","sourcePath":"...","sourceArtifact":null,"updatedAt":"2026-06-03"}`

If the entry is missing or the description is unchanged, the JSON edit was lost or the wrong field was touched. Re-open the file and fix.

- [ ] **Step 4: Confirm the memory file still loads via the public API**

Run: `npx tsx -e "import('./src/services/memory/project-memory-service.js').then(m => { const r = m.readProjectMemories('.'); const e = r.memories.find(x => x.name === 'review-memories-extract-and-memory-index'); console.log(e ? 'OK: ' + JSON.stringify({name: e.name, kind: e.kind, bodyLen: e.body.length}) : 'MISSING'); })"`
Expected: `OK: {"name":"review-memories-extract-and-memory-index","kind":"feedback","bodyLen":<some number>}`

This confirms the rewritten file still has parseable frontmatter and a non-empty body. A blank body or missing name would break downstream readers.

---

## Task 4: Type-check, full test suite, commit

- [ ] **Step 1: Run the TypeScript type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors. The new helper `shouldRegenerateIndex` and the 3 named constants must type-check cleanly; both are local to the file with no exports.

If tsc complains, the most likely cause is a missing import (`utimesSync` / `statSync` are already imported at the top of the test file from Task 2).

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass. The prior baseline is 34 passing in `project-memory-service.test.ts`; this slice adds 4 cases (2 boundary + 2 mtime) for 38 total in that file. Other test files are unaffected.

- [ ] **Step 3: Stage the changes and review the diff**

Run:
```bash
git status --short
git diff --stat
```

Expected:
- `M src/services/memory/project-memory-service.ts` (constants + helper + guard)
- `M tests/unit/project-memory-service.test.ts` (2 new describe blocks)
- `M .peaks/memory/hot/feedback/review-memories-extract-and-memory-index.md` (full rewrite)
- `M .peaks/memory/index.json` (1 entry description + updatedAt)

No new untracked files. No stray edits to `bin/`, `dist/`, `coverage/`, `node_modules/`, `escape_probe/`, `package.json`, or `package-lock.json`.

- [ ] **Step 4: Commit on main**

Run:
```bash
git add src/services/memory/project-memory-service.ts \
        tests/unit/project-memory-service.test.ts \
        .peaks/memory/hot/feedback/review-memories-extract-and-memory-index.md \
        .peaks/memory/index.json
git commit -m "chore(memory): clear 2 minor findings + retire stale review memory

The 2026-06-01 review-memories-extract-and-memory-index flagged 3 BLOCKER +
1 MEDIUM + 3 minor. e611daf (2026-06-02) closed the 3 BLOCKER + MEDIUM +
1 minor. This slice closes the remaining 2:

- summarizeMemoryBody: extract MIN_BODY_SENTENCE_LENGTH=20 /
  MAX_DESCRIPTION_LENGTH=120 / ELLIPSIS_RESERVE=3 constants; 117 is now
  computed as MAX_DESCRIPTION_LENGTH - ELLIPSIS_RESERVE (no more magic
  numbers).
- readMemoryIndex: add shouldRegenerateIndex mtime guard. No rewrite when
  index.json mtime >= every memory.md mtime; regen on mismatch. Preserves
  the \"index is always fresh\" property without paying the full rebuild
  cost on every read.

Plus retire the stale review memory (rewrite as closed; cross-reference
this slice). 4 new test cases (2 boundary truncation + 2 mtime guard).
Type: chore, single commit on main per main-branch-iteration.
"
```

Expected: one commit lands on `main`. `git log -1` shows the message verbatim and 4 files changed.

- [ ] **Step 5: Verify the working tree is clean**

Run: `git status --short`
Expected: empty output.

---

## Self-Review

- **Spec coverage:**
  - §3 summarizeMemoryBody constants → Task 1 (constants + 2 tests).
  - §4 readMemoryIndex mtime guard → Task 2 (helper + 2 tests).
  - §5 test plan (2 unit cases per fix) → Tasks 1 and 2 each add 2 cases. Spec asked for 2 total; this plan adds 4 (1 boundary + 1 fallback in Task 1, 1 stable + 1 stale in Task 2) because the fallback path was not covered by existing tests. Net: matches the spec's spirit and adds a fallback regression guard.
  - §6 memory housekeeping (closed stub + index.json description update) → Task 3.
  - §7 type=chore, 1 commit on main → Task 4 step 4 enforces it.
  - §8 risk: rollback is one `git revert` of the single commit. Verified by the diff being 4 files only.
  - §9 open questions: deferred. None blocking.
- **Placeholder scan:** no TBD/TODO; the rewrite of the review memory is provided verbatim in Task 3 step 1; the helper body is provided verbatim in Task 2 step 3; the constants are provided verbatim in Task 1 step 3.
- **Type consistency:** `shouldRegenerateIndex` is defined in Task 2 step 3 and called in Task 2 step 4 — names match. The 3 named constants are defined in Task 1 step 3 and used in the same step — names match. The test file imports `utimesSync` and `statSync` in Task 2 step 1 and uses them in the same step — names match. The public function `readMemoryIndex` is not renamed; its signature is unchanged.
- **DRY/YAGNI:** no new abstractions beyond what the spec calls for. The `shouldRegenerateIndex` helper is the smallest possible shape that lets `readMemoryIndex` keep its single-line regeneration call.
