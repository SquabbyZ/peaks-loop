# peaks design — S5 Implementation Plan (pilot gaps)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four gaps the ModelMatrix pilot exposed: the drift evidence contract, a contract without a primary colour that blocks `verify-ui`, init's missing paved-road/URL flags, and G3a comparing blank SPA shells.

**Architecture:** One spike settles the drift evidence shape and a page-usability probe; `contract-writer`/`design-init` gain a derived primary colour and explicit flags; `design-check-g3` gains a pre-fidelity usability gate that returns `blocked` instead of comparing noise. Nothing in the gate's accept set changes.

**Tech Stack:** TypeScript ESM, designlang 13.4.1, Vitest; the pilot evidence lives under `.peaks/_runtime/2026-11-24-session-pilot/design/`.

**Spec:** the S3/S4 spec plus the pilot report `.peaks/_runtime/2026-11-23-session-320f58/design/pilot-report.md`

## Spike findings (t1, complete — measured on designlang 13.4.1)

- `drift --json` carries `url, tokensFile, tolerance, verdict, driftRatio, drifted, matched, unknown, summary` — **no `generatedAt`, no `pages`, on any page**. It echoes the exact `url` and resolved `tokensFile` it was given, so those two fields are the forgery-resistant part of its evidence.
- `verify-ui` and `slop` also lack `generatedAt`/`pages` (`slop` has `readAt`). Running the real `parseDesignlangEvidence` on the real payloads refuses **every one**, including a `pass:true` verify-ui — so **G2 cannot pass today**; the tests are green only because their fakes inject the timestamp. This makes the positive-evidence rule a dead gate for these tools, which is the same failure class as a gate that can never fire.
- Exit semantics: `verify-ui` exits 1 for a scored fail and 2 for an unusable page (empty stdout, `No primary colour found` / unreadable); G2 currently maps any nonzero to `fail`, so a blank or login page becomes a FAIL verdict.
- Usability: static HTTP text length cannot separate a rendered SPA route from a blank one (both 200, same URL, 0 chars). `designlang stats --as-json` does: `fontFamilyCount` 0 for blank shells, ≥1 for every rendered page with text; `typeScale` 1 vs 2–9. A login wall is a 3xx to a different path plus a password field. False-block risk: an artwork-only rendered page also scores `fontFamilyCount 0` — it blocks (with the measured fields), never fails.
- Task 2 caveat: the key splitter must see a DTCG `color.primary` as the named role (last segment `primary`/`brand`), not only `--color-primary`.

## Global Constraints

- Never turn a blank/unusable page into a verdict: `blocked(DESIGN_PAGE_UNUSABLE)`, never pass and never a noise-driven fail.
- Never fabricate evidence: the adapter may accept a documented shape the tool really emits; it may not invent `generatedAt`.
- `design init` may derive a primary colour from tokens; if it cannot, it records the gap and `verify-ui` stays blocked with a named reason.
- New init flags are additive; existing behaviour without them is unchanged.
- ≤300 raw lines per src file (tests ≤500); BDD triple first; `.js` specifiers; prettier; eslint 0; stage only; orchestrator commits after QA.

## Review Focus

- A drift payload without a real timestamp must still never pass — Task 1 records what the tool emits and Task 4 pins the refusal.
- A derived primary colour must be traceable to a token, not a constant; Task 2 pins the provenance.
- Flags must round-trip into `paved-road.json`/`engine.json` idempotently; Task 3 pins re-runs.
- The usability probe must not block a genuinely rendered page (false block is as bad as a false pass); Task 4 pins both directions.

---

### Task 1: Spike — drift evidence and page usability (no product code)

- [ ] Serve a page WITH content (a static fixture with text + a styled component) and record the exact `designlang drift --json`, `verify-ui --json` and `slop --json` payloads: do they carry `generatedAt`/`pages`? What does an EMPTY shell return?
- [ ] Probe a login-walled route: status, final URL, body size, visible text length — record which signal separates "rendered content" from "shell".
- [ ] Record the recommendation for Task 4's probe and for the drift acceptance shape.

### Task 2: A primary colour from tokens

**Files:** `src/services/design/contract-writer.ts` (or the renderer it uses), `design-init.ts`, tests.

- [ ] `derivePrimaryColor(tokens): { value: string; token: string } | null` — a documented order (a `--primary`/`brand` token, then the most frequent colour token), never a hard-coded hex.
- [ ] `contract.md` renders the primary with its token name; the init envelope reports `primaryColor` and `primarySource`.
- [ ] Tests: token precedence, absent → null + recorded gap, rendered contract contains it; `verify-ui` no longer fails on a fixture whose contract now has it.

### Task 3: Init flags for the paved road and the URL

**Files:** `src/cli/commands/design-commands.ts`, `design-init.ts`, paved-road/engine writers, tests.

- [ ] `--page-roots <list>`, `--exclude <list>`, `--url <url>`: additive; recorded in `paved-road.json` (`pageRoots`, `exclude`) and `engine.json` (`render.url`).
- [ ] Idempotent re-runs; `--force` never deletes them.
- [ ] Tests: each flag round-trips; absent flags keep today's defaults; a re-run does not duplicate entries.

### Task 4: Per-tool evidence shapes, exit mapping, and a shared page-usability gate

**Files:** `src/services/design/designlang.ts` (evidence), `design-check-g2.ts`, a new `page-probe.ts`, `design-check-g3.ts`, tests.

- [ ] **Evidence shapes, per the spike:** `drift` is accepted iff `verdict` is one of its four values, `driftRatio` is numeric 0..1, `summary` is an object with `total >= 1` and `total === matched + drifted`, and its `url`/`tokensFile` echo the values passed; `verify-ui` requires `pass: boolean` + `onBrand` numeric; `slop` requires its score field plus `readAt`. Never synthesise `generatedAt`; never require it from a tool that does not emit one.
- [ ] **Exit mapping:** `verify-ui` exit 1 → `fail`; exit 2 → `blocked('DESIGN_PAGE_UNUSABLE')`; exit 3 → retryable block; a report-backed score still wins over the code.
- [ ] **Shared usability probe** (`page-probe.ts`), run before G2 and G3a per URL: Stage A HTTP — block on non-2xx, on a 3xx whose path changes, or a password field with <300 body chars; Stage B — one `designlang stats --as-json` per URL, block when `fontFamilyCount === 0` (corroborated by `typeScale <= 1`). The blocked message carries status/finalUrl/fontFamilyCount, never a score.
- [ ] Tests: each evidence shape accepted/refused (including a `pass:true` verify-ui with no timestamp — must now pass); each exit mapping; rendered fixture passes the probe, blank shell and login redirect block, network failure blocks; an artwork-only page blocks rather than fails.

### Task 5: Re-run the pilot (bounded)

- [ ] Re-run init with the new flags on the pilot worktree and `design check --gate`; record whether the check moves from `DESIGN_RENDER_NO_EVIDENCE` to a real G2 verdict or a named block; update the pilot report. A remaining blocker is recorded, not papered over.

## Release note

S5 is a patch-class fix round for S3/S4 (no new gate semantics). The `backCompatUntil` window is untouched.
