# Memory Housekeeping: clear 2 minor findings + retire stale review memory

> Date: 2026-06-03
> Slice: 2026-06-03-memory-housekeeping-minor-findings
> Type: `chore` (no API surface change, no new CLI, no new artifact path)
> Author: brainstorming with user
> Follows: [dev-preference](../.claude/rules/common/dev-preference.md) (skill-first, default-no on new CLI), [main-branch-iteration](../../.peaks/memory/main-branch-iteration.md), [coverage-red-line](../../.peaks/memory/coverage-red-line.md)

## 1. Goal

Clear the **two remaining minor findings** from the 2026-06-01 review `review-memories-extract-and-memory-index.md` and retire the now-stale review memory so the hot/warm index no longer advertises blockers that are already fixed.

The 3 BLOCKER + 1 MEDIUM + 1 of 3 minor items were already addressed in `e611daf` (2026-06-02 00:04, "feat(memory): hot/warm index + session extract with idempotency and --dry-run/--apply parity"). Verification:

- 3 BLOCKERS (idempotency / containment / dry-run-apply parity): confirmed fixed in code, all 34 existing tests pass.
- MEDIUM (`sourceArtifact` propagation + mtime-based `updatedAt`): confirmed fixed at `MemoryIndexEntry` (L103) and `generateMemoryIndexFile` (L473).
- 1 of 3 minors (`listFilesRecursive` / `listMarkdownFiles` dedup): confirmed merged into the unified `listMarkdownFiles` with `{maxDepth, skipDotfiles}`.
- 2 minors still present: see §3 and §4.

## 2. Scope

**In:**

1. `src/services/memory/project-memory-service.ts` — extract 3 named constants in `summarizeMemoryBody`; add mtime-based guard to `readMemoryIndex`.
2. `tests/unit/project-memory-service.test.ts` — add 2 unit tests (one for each fix).
3. `.peaks/memory/hot/feedback/review-memories-extract-and-memory-index.md` — rewrite as "closed" with cross-reference to this slice.
4. `.peaks/memory/index.json` — update the entry's `description` and `updatedAt` to reflect closure.

**Out (explicit non-goals):**

- No new CLI command (per dev-preference default-no).
- No behavior change in any public function (mtime guard is an internal optimization; constants are extraction of literals).
- No API surface change (`MemoryIndexEntry` shape, `readMemoryIndex` return type, `extractSessionMemories` result — all unchanged).
- No new `.peaks/` artifact directory.
- No new skill content; peaks-rd / peaks-qa / peaks-sop / peaks-solo runbooks already reference the existing extract command and stay untouched.

## 3. Design: `summarizeMemoryBody` magic-number extraction

**Current state** (lines 367-385 of `project-memory-service.ts`):

```ts
function summarizeMemoryBody(body: string): string {
  const cleaned = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();

  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20 && !/^\[.+\]$/.test(s));
  if (sentences.length === 0) {
    return cleaned.slice(0, 120) || 'Project memory';
  }

  const first = sentences[0]!;
  if (first.length <= 120) {
    return first;
  }
  return first.slice(0, 117) + '...';
}
```

**Opaque numbers (the review's pain point):**

- `20` (L375) — minimum sentence length to be considered a "real sentence" vs. a stray fragment. Below 20 chars, the regex split produces noise like "is", "the" that doesn't summarize anything.
- `120` (L377, L381) — max length of the description in the index entry. Matches the convention in the original `summarizeMemoryBody` design (and what `peaks project memory-index` consumers expect to be a one-line blurb).
- `117` (L384) — `120 - 3`, where `3` is the length of the trailing `'...'` ellipsis.

**Change:** extract as named constants in a new block at the top of the function (or near the existing `summarizeMemoryBody` helper):

```ts
// Length bounds for index entry descriptions. The numbers were chosen when
// summarizeMemoryBody was first introduced; locking them in as named
// constants is a doc-as-code move so the truncation rule is no longer
// "magic". Bump MAX_DESCRIPTION_LENGTH deliberately if downstream UIs grow.
const MIN_BODY_SENTENCE_LENGTH = 20;   // skip fragments shorter than this when picking a leading sentence
const MAX_DESCRIPTION_LENGTH = 120;    // hard cap on description length in the memory index entry
const ELLIPSIS_RESERVE = 3;             // length of the trailing "..." when truncating with an ellipsis
```

The function body then references the constants. `117` is no longer present in the source — the slice is `MAX_DESCRIPTION_LENGTH - ELLIPSIS_RESERVE`, computed inline at the call site with a one-line comment.

**Test:** one new unit test `summarizeMemoryBody truncates long sentences with ellipsis at MAX_DESCRIPTION_LENGTH boundary` covering sentence lengths 117, 118, 120, 121, 122 — confirming the boundary is exactly `120` (no truncation at 120 or below; ellipsis applied at 121+).

## 4. Design: `readMemoryIndex` mtime-based regeneration guard

**Current state** (lines 515-548): every call to `readMemoryIndex` regenerates the full `index.json` whenever any markdown file exists in `.peaks/memory/`. This is a "read has write side effect" smell — the function name promises a read.

**Change:** guard the regeneration on a mtime check.

```ts
export function readMemoryIndex(projectRoot: string): MemoryIndex | null {
  const normalizedRoot = normalizeRoot(projectRoot);
  const memoryDir = assertSafeProjectMemoryDir(normalizedRoot);
  const indexPath = join(memoryDir, 'index.json');

  // Read-side bootstrap: directory / index may not exist on a stock project.
  // Fail-open — missing artefacts are materialised silently, not surfaced.
  if (!existsSync(memoryDir)) {
    ensureMemoryBootstrap(normalizedRoot);
    return readExistingIndex(indexPath);
  }
  if (!existsSync(indexPath)) {
    try {
      writeFileSync(indexPath, renderEmptyIndex(), { mode: 0o644 });
    } catch {
      // fall through — readExistingIndex will return null
    }
  }

  // Mtime-based regeneration guard: only rebuild the index when at least one
  // memory markdown has been modified after index.json. Preserves the
  // "index is always fresh" property without paying the full rebuild cost
  // on every read. Edge case: if any memory's statSync fails, the safe
  // default is to regenerate (matches the prior always-rebuild behavior
  // and avoids serving a stale index from a partially-corrupt dir).
  const memoryFiles = listMarkdownFiles(memoryDir);
  if (memoryFiles.length > 0 && shouldRegenerateIndex(indexPath, memoryFiles)) {
    try {
      generateMemoryIndexFile(normalizedRoot, memoryDir, indexPath);
    } catch {
      // fall through to read existing
    }
  }

  return readExistingIndex(indexPath);
}
```

**New helper** (private to the file):

```ts
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

**Test:** one new unit test `readMemoryIndex only regenerates when memory mtime exceeds index mtime` covering three states:

1. index.json newer than all memory.md → read returns the existing index, **no rewrite** (verified by mtime preservation).
2. one memory.md newer than index.json → read returns the regenerated index.
3. index.json missing entirely → bootstrap-then-regenerate path (existing bootstrap logic still runs first; this case is exercised by an existing test, no new case needed).

**Behavioral parity:** the public output of `readMemoryIndex` is byte-identical for the user-facing case in (1) — index file content unchanged. In case (2) and (3), the result is identical to the prior always-regenerate path. The only difference is performance and mtime stability for case (1).

## 5. Test plan

Two new unit cases in `tests/unit/project-memory-service.test.ts`. Per [coverage-red-line](../../.peaks/memory/coverage-red-line.md): write the test only when it covers a real branch the existing suite doesn't. Both cases here hit a real branch the existing 34-case suite does not cover (constant extraction is a refactor; the truncation algorithm still has untested boundary at length 120). Cases:

1. `summarizeMemoryBody` truncation boundary (length 117 / 118 / 120 / 121 / 122)
2. `readMemoryIndex` mtime-based regeneration guard (index-newer-than-memory vs memory-newer-than-index)

No new integration test. The CLI tests at `tests/unit/project-commands-*.test.ts` (if any) and the existing service test already cover the bootstrap / idempotency / escape-rejection paths.

## 6. Memory housekeeping

**File:** `.peaks/memory/hot/feedback/review-memories-extract-and-memory-index.md`

Replace the body with a "closed" stub. The original review content (the BLOCKER / MEDIUM / minor analysis) is preserved as git history, not in the live memory file:

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

This review memory is **closed**. The 3 BLOCKER + 1 MEDIUM + 1 of 3 minor findings were addressed in commit `e611daf` (2026-06-02 00:04). The remaining 2 minor findings (magic numbers in `summarizeMemoryBody`, read-side regeneration in `readMemoryIndex`) are addressed in slice **2026-06-03-memory-housekeeping-minor-findings**.

For historical context, see the original file body in `git log -p e611daf^ -- .peaks/memory/hot/feedback/review-memories-extract-and-memory-index.md` or before this rewrite.

**Why closed:** All BLOCKER findings must be fixed before a memory goes live; the BLOCKERs are gone. Review-of-uncommitted-changes memories should not remain in the hot tier after the change lands.

**How to apply:** Do not re-introduce this memory as a live blocker. If a future change touches `project-memory-service.ts` extract paths, run a fresh review rather than consulting this closed record.
```

**.peaks/memory/index.json** — update the `hot.feedback` entry for this memory:

- `description`: from the current `"...three blockers and one MEDIUM finding that should be fixed before this lands."` to `"[CLOSED 2026-06-02 in e611daf] Code review findings on the 2026-06-01 uncommitted changes to project-memory-service.ts."`
- `updatedAt`: today's date `2026-06-03`

The `regenerate-index` change in §4 will pick this up on the next read.

## 7. Type classification & workflow

**Type:** `chore` (per the type taxonomy in `skills/peaks-solo/SKILL.md`):

- Pure mechanical hygiene
- No API surface change
- No new CLI, no new artifact path, no new skill content
- All 34 existing service tests must still pass; 2 new tests added (real-branch coverage per coverage-red-line)

**Workflow** (per main-branch-iteration, no worktree):

- Skip the full peaks-solo / PRD / RD / QA / SC handoff
- One commit on main
- Commit message format: `chore(memory): clear 2 minor findings + retire stale review memory`

## 8. Risk and rollback

**Risk:** low. The changes are:

- Constant extraction: refactor only. If a test catches a regression, the diff is one revert commit.
- Mtime guard: behavioral parity for the user-visible output. Worst case if the mtime comparison has a bug: the index goes stale (case 1 mishandled → no regeneration when needed), which is detectable by `peaks project memory-index` returning out-of-date entries. Mitigated by the safe-default (any statSync failure → regenerate).
- Memory file rewrite: description is the only field an LLM/agent reads. The new wording is more accurate. Description field is text, not code, so no test gates it; the `closedAt` / `closedBy` frontmatter is the audit trail.
- index.json regenerated by §4's read-side path; today's `updatedAt` is what the user sees.

**Rollback:** one `git revert` of the single commit restores everything (code, tests, memory file, index.json) to the prior state.

## 9. Open questions (none blocking)

- Do we want to add a `closedAt` / `closedBy` convention to the memory frontmatter schema for future use, or keep this as a one-off? **Defer to a separate iteration; this slice only needs the frontmatter that exists today.**
- Should `readMemoryIndex` be renamed to `readOrRegenerateMemoryIndex` as a follow-up naming fix? **Defer; the mtime guard changes the smell enough that the name fits.**
