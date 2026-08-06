---
title: OCR 1.8.x Multi-language Reviewer Adapter
rid: 2026-08-06-ocr-multilang-1-8
session: 2026-08-06-session-cacde8
status: shipped-4.0.16
---

# OCR 1.8.x Multi-language Reviewer Adapter

## Section 1 — per-platform optionalDependencies (1.8.x postinstall fix)

`@alibaba-group/open-code-review@1.8.9` replaces the 2.0.3-era
GitHub Releases HTTPS download with per-platform `optionalDependencies`
(`@alibaba-group/ocr-{darwin,linux,win32}-{arm64,x64}`). `npm install`
hits the registry only; postinstall runs the embedded Node installer
(`scripts/install.js`) and resolves the platform binary locally.

Sandbox evidence (2026-08-06, `npm@10.9.4`):

```
npm install @alibaba-group/open-code-review@1.8.9
added 2 packages in 5s
npm info run @alibaba-group/open-code-review@1.8.9 postinstall { code: 0, signal: null }
```

No HTTPS to `github.com` is required. The 2.0.3 install pain (which
drove the 2.8.2 peerDep downgrade) no longer applies.

## Section 2 — 8-language routing

| `--language` | file extension filter (ocr 1.8.9) |
|---|---|
| `python` | `*.py` |
| `go` | `*.go` |
| `java` | `*.java` |
| `rust` | `*.rs` |
| `cpp` | `*.cc` / `*.cpp` / `*.h` / `*.hpp` |
| `csharp` | `*.cs` |
| `ruby` | `*.rb` |
| `php` | `*.php` |

`--language java` maps to Java review. The wrapper rejects any other
language with `state: 'language-unsupported'` and a supported list in
`nextActions`.

## Section 3 — 5-state detect table

`detect-ocr-18` returns one of:

| State | Meaning | Behavior |
|---|---|---|
| `ready` | npx + ocr 1.8.9 both resolve | run review |
| `ocr18-missing` | npx or ocr package cannot resolve | warn |
| `binary-missing` | platform binary optionalDep missing | warn |
| `llm-config-missing` | Delegation Mode not requested and no key | warn |
| `detection-failed` | unexpected detection exception | warn |

The runtime wrapper returns `language-unsupported` as a 6th state
when the caller supplies a non-mapped language.

## Section 4 — Delegation Mode

`peaks code-review ocr-18-delegate-preview` runs `ocr delegate preview`
with no LLM key. The wrapper returns the spec the host agent must
fill in (file list + rule references); the host agent's own LLM
performs the analysis. This is the fallback path when the user does
not have an Anthropic/OpenAI key configured.

## Section 5 — soft-fail policy

`run-ocr-18` never blocks a slice. When ocr 1.8.x is not ready, the
wrapper returns `state: 'ocr18-missing'` (or appropriate) and
peaks-rd records a TXT note `code-review-ocr18-degraded-to-inline`.

## Section 6 — Gate B3 routing

- JS/TS / TSX / JSX: `peaks lint` + ECC bridge.
- Python / Go / Java / Rust / C++ / C# / Ruby / PHP:
  `peaks code-review run-ocr-18 --language <lang>`.
- Mixed monorepo: per-language routing, findings merged.

## Section 7 — Why per-language routing matters

OCR 1.8.x is the multi-language reviewer in the peaks-rd Gate B3
router; ECC bridge stays the JS/TS path. The split is intentional and
informed by AACR-bench (Alibaba's multi-language review benchmark):

- **Precision vs. recall trade-off.** ECC bridge is tuned for JS/TS
  idioms and ships tighter precision for that surface; on Python or
  Java codebases it under-recalls (false-negative on async/lifetime
  bugs). OCR 1.8.x is the inverse: broad language coverage with
  per-language rule packs.
- **Enterprise-class checks per language.** OCR 1.8.x's Java pack
  reports NPE / SQL injection / XSS / thread-safety patterns that
  have no analogue in the JS/TS ECC skill set. Routing a Java
  project through ECC would silently drop these findings.
- **Layered output normalization.** Each language's OCR output is
  flattened into the peaks-loop `Ocr18Finding` envelope (filePath,
  line, ruleId, severity, message) so downstream Gate B3 merge
  works uniformly across all 8 languages.
- **Failure isolation.** When OCR 1.8.x is missing for one language
  on a given host, only that language degrades to inline review;
  other languages still get the full Gate B3 path.

A Python project therefore routes to OCR 1.8.x (not ECC) because
(a) the Python rule pack has the broadest coverage in 1.8.9, and
(b) routing it through ECC would mask Python-specific findings.

For monorepos, the router scans the changed file extensions to pick
a per-language reviewer. A commit that touches `.py` and `.ts`
sources gets a parallel ECC + OCR-1.8 invocation; the resulting
finding arrays are merged at Gate B3 with severity sort and
duplicate suppression (same `filePath:line:ruleId` collapses to a
single entry).

When Delegation Mode is enabled, the host agent receives a JSON
spec listing files and candidate rules, applies the user's own LLM
key, and returns structured findings that the wrapper normalises
back into the same `Ocr18Finding` envelope — so downstream Gate B3
merge code does not need a separate code path for the delegation
flow.

## Cross-references

- PRD: `.peaks/_runtime/2026-08-06-session-cacde8/prd/requests/002-2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild.md`
- Sediment: `.peaks/memory/2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild-sediment.md`
- Skills: `skills/bee/peaks-rd/SKILL.md` Gate B3 paragraph
- Skills: `skills/peaks-code/SKILL.md` Quality-gate commands cheat sheet
- Runner: `src/services/lint/ocr-multilang-adapter.ts`
- Detect: `src/services/lint/detect-ocr-18.ts`
- CLI: `src/cli/commands/code-review-commands.ts`
- ECC bridge (production JS/TS path): `src/services/code-review/ecc-bridge.ts`
