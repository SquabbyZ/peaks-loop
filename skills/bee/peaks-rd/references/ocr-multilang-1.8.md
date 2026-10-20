---
title: OCR 1.x Multi-language Reviewer Adapter
rid: ocr-language-integration
session: 2026-10-20-session-a545d0
status: implemented (4.1.10 tree, unreleased)
---

# OCR 1.x Multi-language Reviewer Adapter

Supersedes the 1.8-era reference of the same path. The 1.8 content described a
`--filter-language` flag and a `findings[]` envelope. Neither exists: the real
binary rejects the flag with `Error: unknown flag`, and `ocr review --format json`
returns `comments[]`. Read this file, not the old one, before touching the bridge.

Pinned runtime: `@alibaba-group/open-code-review@1.13.1` (`OCR_18_PACKAGE` in
`src/services/lint/ocr-multilang-adapter.ts`).

## 1. The real CLI surface

```
ocr review [--from <ref>] [--to <ref>] [--commit <sha>] [--format json]
ocr review --preview          # lists which files WOULD be reviewed, no LLM call
ocr delegate preview [--format json]   # delegation: selection only, no LLM key
ocr delegate rule <path...> [--format json]  # delegation: resolved rules, no key
```

There is **no language flag**. The 1.8-era `--filter-language` was removed from
the adapter in `194eccf5` after the real binary was consulted; every non-delegate
run failed with `Error: unknown flag: --filter-language` before that.

Not adopted by this bridge, deliberately: `--format sarif`, `-o/--output`,
`--effort`, `--max-tokens-budget`, `ocr scan`. They are new capability, not
integration; adding them is its own slice.

## 2. Post-review scoping — where language routing actually happens

`ocr review` reviews the whole diff. The bridge attributes each returned comment
to a language **after** the review, by the extension of `comment.path`:

```
comments[] (path, content, start_line, end_line, severity, category)
        │
        ├─ extension → LANGUAGE_EXTENSIONS → language
        └─ severityFor(severity) → error | warn | info
```

Consequences, stated plainly:

- A comment on a format the caller did not route is still REPORTED — it lands in
  `unroutedFindings` rather than being dropped.
- Scoping is what gets reported, not what the LLM was asked to look at. The
  review is over the whole range either way.
- Extension matching is case-insensitive.

## 3. Language coverage and its source of truth

`LANGUAGE_EXTENSIONS` (57 languages, 97 extensions) is the single source of
truth. `OCR_18_LANGUAGES`, the extension lookup and `--languages` token
resolution are all derived from it, so a language cannot be routed without an
extension entry.

The table is a **snapshot** of the pinned runtime's own allowlist:
`internal/config/allowlist/supported_file_types.json` at tag `v1.13.1`
(115 entries), vendored in `src/services/lint/ocr-18-allowlist.ts`. The rest of
the allowlist is listed in `OCR_18_EXCLUDED_EXTENSIONS` with a reason (CSS,
HTML, XML, YAML/JSON/TOML/INI, `.po`/`.pot`, `.ipynb`) — markup, stylesheets,
data/config and notebook containers are reviewed by the CLI but carry no source
semantics to route per language.

Tests that keep it honest
(`tests/unit/services/lint/ocr-multilang-adapter.test.ts`):

- every language has at least one extension;
- no extension routes to two languages;
- every routed extension is in the vendored allowlist;
- routed ∪ excluded covers the allowlist exactly — an upstream addition reddens
  here instead of vanishing.

Three documented divergences, each deliberate:

- **`.mts` / `.cts`** are TypeScript to the PRD, but the 1.13.1 allowlist omits
  both and `ocr review --preview` classifies them `unsupported_ext`. They are NOT
  routed: routing them would report "typescript: 0 findings" for files the CLI
  never read. They surface in `unsupportedFiles` instead.
- **`.m`** is claimed by both Objective-C and MATLAB upstream and cannot be told
  apart by extension. It routes to Objective-C.
- **`.h`** is ambiguous between C and C++ and stays under `cpp`, because that is
  the surface inherited from `194eccf5`: `--language cpp` matched `.h` before this
  slice, and the preserved-behaviour clause forbids silently changing it. It is
  absent from `c` — `--language c` does not match a header. It is deliberately not
  assigned to both: one file maps to one language, or the same comment would be
  counted twice in `byLanguage`. Moving it is a breaking change needing its own
  decision; a test pins the current assignment.

Empirical control used to settle the allowlist (2026-10-20, win32-x64): a scratch
repository holding one file per extension was run through `ocr review --preview`.
Every routed extension appeared under "Will review"; `.mts`, `.cts` and `.glsl`
appeared under `Excluded from review (unsupported_ext)`. `.glsl` is in HEAD's
allowlist but not in v1.13.1 — which is why the tag, not HEAD, is the snapshot.

When the pin moves, update `OCR_18_PACKAGE`, re-vendor the allowlist at the new
tag, and let the partition test tell you what changed.

## 4. Auto-detection

`detectLanguages(cwd, range)` derives the changed files from the same git range
the review will use:

| Selector | git command |
|---|---|
| `--commit <sha>` | `git show --pretty=format: --name-only --diff-filter=ACMR <sha>` |
| `--from` / `--to` | `git diff --name-only --diff-filter=ACMR <from> <to> --` |
| none (workspace) | `git diff … HEAD --` **plus** `git ls-files --others --exclude-standard` |

The workspace case reads untracked files too: `ocr review` reviews them, so a
brand-new source file must not be able to skip the language detection that
decides whether the review runs at all.

`detectLanguages` **throws** when git cannot answer. The CLI turns that into
`OCR18_DETECT_FAILED`. "Could not detect" must never be reported as "nothing to
review".

## 5. One invocation, many languages

`runOcr18Multi` runs `ocr review` **once** for the whole change set and groups
the returned comments by language. A Python+Go change costs one review, not two;
the unit suite asserts the spawn count rather than observing it manually.

A range with no routed language SKIPS the invocation entirely and returns
`state: 'no-routed-language'`. Spawning OCR to discover there is nothing to
review is exactly the cost this guard exists to avoid.

## 6. The four outcomes

| # | Outcome | Where it is expressed |
|---|---|---|
| 1 | language detected, findings returned | `languages[].count > 0` |
| 2 | language detected, zero findings | `languages[].count === 0` with `state: 'ok'` |
| 3 | file present, format not reviewed as a routed language | `unsupportedFiles[]` (and `state: 'no-routed-language'` when that is all the range holds) |
| 4 | OCR could not run | `state` in `ocr18-missing` / `execution-failed`, **`languages: []`**, `summary: null` |

No two of these collapse. A zero is only ever reported with `state: 'ok'`, so a
zero cannot be confused with "never ran"; a failure carries no language reports
at all. When the CLI reports outcome 4 it also runs `detect-ocr-18` and puts the
detector's own state (`binary-missing`, `llm-config-missing`, …) in
`data.detector`.

## 7. Invocation

Single language (unchanged, still supported):

```
peaks code-review run-ocr-18 --language python --from main --to HEAD --json
```

Multi-language, the code-review step's form:

```
peaks code-review run-ocr-18 --languages auto --from <base> --to HEAD --json
peaks code-review run-ocr-18 --languages ts,js,go --from <base> --to HEAD --json
```

- `auto` detects from the range.
- A csv resolves through the routing table: language names (`python`) and
  extensions (`ts`, `.py`) both work, because both are the same table.
- `--language` and `--languages` together are refused with a message naming both.
- `--delegate` is not language-scoped (`ocr delegate preview` ignores a language)
  and is refused alongside `--languages`.

## 8. Gate B3 — dual-track for TypeScript/JavaScript

ESLint stays the PRIMARY gate for `.ts/.tsx/.js/.jsx/.mjs/.cjs`. The OCR pass is
a SUPPLEMENTARY semantic review of the same change set. This is a user decision,
not an accident: neither tool silently replaces the other.

The RD code-review artifact records the two outcomes separately, each finding
attributed to the tool that produced it, so a defect flagged by both is not
counted twice.

## 9. Degradation

When OCR cannot run, the code-review step records **`OCR unavailable`** plus the
detector state. It is never recorded as a clean review, and it never blocks the
rest of code review: the ESLint track and the rest of Gate B3 proceed.

## 10. Delegation mode — the no-credential review path

OCR has two review paths. They share the file selection and the rules; they differ
in who runs the model.

| Path | Command | Needs a provider key |
|---|---|---|
| API | `peaks code-review run-ocr-18 --languages auto …` | **yes** (OCR's own config) |
| Delegated | `peaks code-review run-ocr-18 --delegate --rid <rid> …` | **no** |

Prefer the delegated path whenever no provider is configured — it is the default
there, and it is the only path that works on a session authenticated through
`ANTHROPIC_AUTH_TOKEN` or a non-Anthropic endpoint, because OCR reads neither.
Prefer the API path when a provider **is** configured and you want OCR's own agent
and prompts.

Delegation is two phases. Neither phase calls an LLM from the CLI.

### 10.1 Phase 1 — the packet

```
peaks code-review run-ocr-18 --delegate --rid <rid> --from <base> --to HEAD --json
```

- `--languages auto` is accepted (detection, not scope). An explicit list and
  `--language` are refused: `ocr delegate preview` takes no language.
- `--rid` is required. The packet is named after it.
- No routed language skips both OCR invocations, exactly like the API path.

Written to `.peaks/_runtime/<sid>/rd/ocr-delegate/<rid>-packet.json` and returned in
the envelope (with `packetPath`). Contents:

```json
{
  "schema_version": "1", "mode": "delegate", "state": "awaiting-envelope",
  "findings": null, "rid": "…", "session": "…",
  "git": { "from": "main", "to": "HEAD", "commit": null },
  "detection": { "languages": ["typescript"], "changed_file_count": 2, "unsupported_files": ["README.md"] },
  "cost": { "total_files": 2, "reviewable_count": 1, "excluded_count": 1,
            "total_insertions": 30, "total_deletions": 5 },
  "selected_files": [ { "path": "src/a.ts", "status": "modified", "insertions": 30,
                        "deletions": 5, "language": "typescript", "pattern": "**/*.{ts,js}" } ],
  "excluded_files": [ { "path": "README.md", "status": "modified", "insertions": 2,
                        "deletions": 0, "exclude_reason": "unsupported_ext" } ],
  "rules": [ { "group_id": 1, "source": "system", "pattern": "**/*.{ts,js}",
               "files": ["src/a.ts"], "rule": "…resolved rule text…" } ],
  "warnings": [], "raw_output": null
}
```

- `selected_files[].pattern` is the `pattern` of the `rules[]` group that claimed
  the file — the join the agent needs to apply the right rule. A file no group
  claimed carries `pattern: null` and a `warnings[]` entry; the CLI never invents a
  pattern.
- `excluded_files` is OCR's own exclusion list with its `exclude_reason`.
- `cost` is the number to read before reviewing: a large change set is expensive in
  the session's remaining context, not in a billing account.
- `findings` is **always `null`** here.

Packet states, all with `findings: null`:

| State | Meaning |
|---|---|
| `no-routed-language` | zero changed files in the range |
| `unsupported-files-only` | files changed, none routed |
| `ocr-unavailable` | the CLI failed or did not return a delegation payload |
| `awaiting-envelope` | packet written, host review not recorded yet |

### 10.2 Phase 2 — the envelope and the record verb

The host agent reviews `selected_files` against `rules[].rule` (and the diff) and
writes an envelope **file** (the verb takes its path, not inline JSON). The envelope
mirrors OCR's own `LlmComment`, so the mapping is shared:

```json
{ "schema_version": "1",
  "packet": ".peaks/_runtime/<sid>/rd/ocr-delegate/<rid>-packet.json",
  "findings": [ { "path": "src/a.ts", "content": "why it is a defect",
                  "start_line": 12, "end_line": 12,
                  "severity": "high", "category": "bug" } ] }
```

- `packet` is required and must name the packet the findings belong to.
- `findings` must be an array. An empty array is a **clean review**; a missing array
  is malformed, because the CLI will not guess which one you meant.
- `severity` must be one of `error|critical|high|warn|warning|medium|info|low`.
  Unknown values are refused rather than mapped to `info`.
- `category` is optional; it becomes `ruleId`.

```
peaks code-review ocr-delegate-record --packet <packet-path> --envelope <envelope-path> --json
```

The verb refuses (non-zero exit) rather than coercing:

- a malformed envelope, naming the offending entry (`findings[2].start_line must be a
  positive integer`);
- an envelope whose `packet` names a different file than `--packet`;
- a packet that does not exist, is not a delegation packet, lies outside the project
  root, or is not in state `awaiting-envelope` (a `no-routed-language` packet has no
  review to record).

On success it writes `<rid>-packet.findings.json` beside the packet and returns
`state: "recorded"`, `findingsPath`, the findings and a summary. Recording does not
advance the packet — the findings document is the record — so recording again
replaces the earlier findings file and reports `replaced: true`.

### 10.3 Not executed is not clean

| Situation | Shape |
|---|---|
| packet written, no envelope recorded | packet `state: "awaiting-envelope"`, `findings: null` |
| review ran, zero findings | document `state: "recorded"`, `findings: []`, `summary.total: 0` |
| review ran, findings | document `state: "recorded"`, `findings: [...]` |

The record verb is the only producer of the second and third shapes, so a packet
cannot be turned into a clean review without an envelope. A count-only summary
cannot express "the agent never ran"; the `null` versus `[]` distinction is what
does.

Every recorded finding carries `attribution: "ocr-delegate"`, and so does the
document. A host-model finding is not an OCR finding: the selection and the rules
are OCR's, the review is this model's, and the artifact must not let it inherit
OCR's benchmark numbers.

### 10.4 The selection preview verb is not a review

`peaks code-review ocr-18-delegate-preview --json` prints what
`ocr delegate preview --format json` returns: the reviewable and excluded files and
the cost, and nothing else. It is a **selection preview**. It no longer feeds that
payload through the `comments[]` review parser — doing so is what kept delegation
from ever producing a finding.

## Cross-references

- Runner (API path): `src/services/lint/ocr-multilang-adapter.ts`
- Delegation payload parsers: `src/services/lint/ocr-18-delegate-payload.ts`
- Packet builder and states: `src/services/lint/ocr-18-delegate-packet.ts`
- Envelope validation and recording: `src/services/lint/ocr-18-delegate-record.ts`
- Allowlist snapshot: `src/services/lint/ocr-18-allowlist.ts`
- Detect / acquire: `src/services/lint/detect-ocr-18.ts`, `src/services/lint/ocr-18-acquire.ts`
- CLI: `src/cli/commands/code-review-commands.ts`, `src/cli/commands/code-review-run-ocr-18.ts`,
  `src/cli/commands/code-review-ocr-delegate.ts`
- Tests: `tests/unit/services/lint/ocr-multilang-adapter.test.ts`,
  `tests/unit/services/lint/ocr-18-delegate-payload.test.ts`,
  `tests/unit/services/lint/ocr-18-delegate-packet.test.ts`,
  `tests/unit/services/lint/ocr-18-delegate-record.test.ts`,
  `tests/unit/cli/commands/code-review-run-ocr-18.test.ts`,
  `tests/unit/cli/commands/code-review-ocr-delegate.test.ts`
- ECC bridge (the production JS/TS ESLint path): `src/services/code-review/ecc-bridge.ts`
