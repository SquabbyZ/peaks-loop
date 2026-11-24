# peaks design — S5 Implementation Plan (pilot gaps)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four gaps the ModelMatrix pilot exposed: the drift evidence contract, a contract without a primary colour that blocks `verify-ui`, init's missing paved-road/URL flags, and G3a comparing blank SPA shells.

**Architecture:** One spike settles the drift evidence shape and a page-usability probe; `contract-writer`/`design-init` gain a derived primary colour and explicit flags; `design-check-g3` gains a pre-fidelity usability gate that returns `blocked` instead of comparing noise. Nothing in the gate's accept set changes.

**Tech Stack:** TypeScript ESM, designlang 13.4.1, Vitest; the pilot evidence lives under `.peaks/_runtime/2026-11-24-session-pilot/design/`.

**Spec:** the S3/S4 spec plus the pilot report `.peaks/_runtime/2026-11-23-session-320f58/design/pilot-report.md`

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

### Task 4: A page-usability gate before G3a

**Files:** `src/services/design/design-check-g3.ts` / `fidelity.ts` / a new `page-probe.ts`, tests.

- [ ] Before spawning fidelity, probe both URLs per the spike's signal; an unusable page → `blocked('DESIGN_PAGE_UNUSABLE')` with the measured signal (status, final URL, text length), never a score.
- [ ] Tests: rendered fixture passes the probe; blank shell and login redirect block; a probe failure (network) blocks, never passes.

### Task 5: Re-run the pilot (bounded)

- [ ] Re-run init with the new flags on the pilot worktree and `design check --gate`; record whether the check moves from `DESIGN_RENDER_NO_EVIDENCE` to a real G2 verdict or a named block; update the pilot report. A remaining blocker is recorded, not papered over.

## Release note

S5 is a patch-class fix round for S3/S4 (no new gate semantics). The `backCompatUntil` window is untouched.
