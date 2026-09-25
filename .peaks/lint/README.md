# `.peaks/lint/` — what these files are, and what their metadata does NOT say

Added 2026-09-25 with `rid-6f1df581`. Written because the two files here carried metadata that was
**byte-identical to `HEAD` while their contents had changed**, and nothing in the repository explained
the difference. Their only account lived in a gitignored session handoff, which is the same defect as a
comment the code contradicts.

## `baseline.json` — the per-file waiver

**Read by** `matchBaseline` / `loadBaseline` (`src/services/lint/eslint-runner.ts`). A finding whose
`ruleId` + `file` + `line` + `severity` + `message` matches an entry is moved out of `findings` and into
`baselineWaived`. **Written by** `peaks lint baseline` (`writeBaselineJson`,
`src/cli/commands/lint-commands.ts`).

### Its two dates are different, and the file says neither

| what | when | which tool |
|---|---|---|
| the **violations** | `generatedAt: 2026-08-07T01:47:16.559Z` | `toolVersion: peaks-loop-4.0.16+` |
| the **`file` keys** | 2026-09-25 | peaks-loop **4.0.54** |

`generatedAt` and `toolVersion` are the original generation's, and they were **deliberately left
untouched** by the re-rooting, because they are the true provenance of the *entries*. They are
therefore **not** the provenance of the keys. A reader who takes the header as describing the whole file
will be wrong, which is why this file exists.

### Why the keys were re-rooted in place rather than regenerated

Before 2026-09-25 every `file` key was an **absolute** path rooted at a different machine
(`C:\Users\smallMark\Desktop\peaks-loop\`). `matchBaseline` compares by exact string, so on any other
checkout the waiver was **null** — not degraded, null — and editing a baselined file surfaced its own
pre-existing violations as **new** findings.

`peaks lint baseline` could not be used to fix it. It writes **`full scan MINUS what the existing
baseline covers`**, so the 7 tuples the reader was waiving were absent from its output
(`2881 + 7 = 2888`). That is **not a snapshot of the tree**, and regenerating would have replaced 192
reviewed waivers with 2881 unreviewed ones across 692 files instead of 53.

So the data was **transformed in place**, and the transform was checked as a multiset:
`ruleId|file|line|severity|message` is identical before and after, 0 entries added, 0 dropped. (192
entries over 185 distinct tuples: 6 collision groups contribute 7 extra entries — genuinely distinct
violations that share a line.)

`peaks lint baseline` now emits **repo-relative** keys, so a future regeneration no longer re-roots the
file at whichever machine ran it.

## `gate-baseline.json` — the ratchet

A **different artifact** with a different reader. It holds repo-wide ceilings
(`eslintFindings`, `prettierUnformatted`, `tscErrors`), not per-file waivers. Changing this file changes
a ceiling; changing `baseline.json` changes which findings are exempt. They are not
interchangeable and a fix to one is not a fix to the other.

## Two behaviours worth knowing before trusting a run here

- **`peaks lint check` is diff-scoped** (`inDiff`), so an untouched file surfaces nothing. A green run
  on a clean tree says nothing about whether the waiver works. Demonstrate it by editing a line that
  the baseline covers.
- **`peaks lint baseline` is not idempotent** — its read side ignores `--baseline-file`, so measuring
  against a scratch path does not subtract what the real file covers. This is a known open item, not a
  property to rely on.
- **31 of the entries are `line: 0` parsing errors.** A parse error has no line, so it can never be
  diff-scoped, and it will behave differently from the other entries under `diffOnly: true`.
