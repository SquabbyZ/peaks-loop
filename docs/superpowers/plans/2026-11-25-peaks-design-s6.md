# peaks design — S6 Implementation Plan (route identity)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the usability probe answer the second question the pilot exposed — "is this the page I asked for?" — so a client-side sign-in redirect or a router 404 card becomes `blocked`, never a G3a/G2 verdict.

**Architecture:** A spike enumerates what `designlang extract`/`stats` actually expose about the rendered page (final URL after client navigation, forms/password fields, headings/text, HTTP-error markers). `route-identity.ts` then compares the observation with the expected route using only those measured signals, and the probe runs it after the paint stage. A configuration seam lets a project declare an expected marker per route; nothing is invented where the tool exposes nothing.

**Tech Stack:** TypeScript ESM, designlang 13.4.1, Vitest; evidence from the pilot report (rounds 2/4) and the round-3 usability spike.

**Spec:** the S3/S4 spec plus `.peaks/_runtime/2026-11-23-session-320f58/rd/s5-usability-round3.md` and `design/pilot-report.md`.

## Global Constraints

- A wrong-page block is `blocked(DESIGN_ROUTE_MISMATCH)` with the measured signal; never a fail, never a score.
- Only signals the tool really exposes may be used; a spike that finds none records the gap and the stage stays inert (documented) rather than guessing.
- An expected-marker declaration is optional; absent, the stage uses only the generic signals (client-side redirect, password field, not-found text).
- No new dependency; no fabricated evidence; ≤300 raw lines per src file (tests ≤500); BDD triple first; `.js` specifiers; prettier; eslint 0; stage only; orchestrator commits after QA.

## Review Focus

- **False block on a legitimate page:** a real page that happens to contain a password form (e.g. a settings page) must not block when its route matches; Task 1 measures and Task 2 pins the precedence.
- **Client-side redirect:** the final URL must come from the rendered page, not the HTTP response; Task 1 proves which field carries it.
- **Constant SPA titles:** a title mismatch alone cannot be the signal (the pilot's app has one title); Task 1 records it.
- **Config drift:** an expected marker that no longer exists must be reported, not silently ignored; Task 3 pins it.

---

### Task 1: Spike — what the rendered observation exposes

- [ ] On the pilot app (or a local fixture trio: rendered page, sign-in page with a password form, 404 card), dump the full `designlang extract --json` and `stats --as-json` payloads and list every field per page.
- [ ] Identify which field(s) carry: the final URL after client-side navigation, a password/form signal, not-found text, and any heading/text sample. Record the numbers for each page.
- [ ] Write `rd/s6-spike.md` with the field table and a recommendation per signal, including which are absent on this app.

### Task 2: `route-identity.ts`

**Files:** `src/services/design/route-identity.ts`, `tests/unit/design/route-identity.test.ts`.

- [ ] `type RouteIdentityInput = { expectedRoute: string; observation: { finalUrl?: string; hasPasswordField?: boolean; textSample?: string; headings?: string[]; title?: string }; expectedMarker?: string }`
- [ ] `evaluateRouteIdentity(input): { ok: true } | { ok: false; code: 'DESIGN_ROUTE_MISMATCH'; signal: string; detail: string }` with a fixed precedence: final-URL path mismatch (when observed) → password field on a non-sign-in route → not-found text → missing expected marker. Every signal names itself in the result.
- [ ] Tests: each signal alone blocks; a matching route with a password form (settings page) does not block when the route matches; constant-title cases do not block; a missing expected marker reports `expected-marker-missing`.

### Task 3: Wire the stage into the probe

**Files:** `page-probe.ts`, `page-probe-http.ts`/`design-engine-deps.ts`, `design-check-g3-suite.ts`, tests.

- [ ] After the paint stage, the probe calls `evaluateRouteIdentity`, passing the expected route (G3a: the route under test; G2: the page) and the observation fields the spike found.
- [ ] A mismatch blocks with `DESIGN_ROUTE_MISMATCH` and the signal; a field the tool does not expose is simply absent from the observation (no guess).
- [ ] Tests: fixture sign-in page blocks; 404 card blocks; rendered fixture passes; the stage is inert (documented) when no observation field exists.

### Task 4: Pilot round 5 (bounded)

- [ ] Re-run on `ModelMatrix-pilot`: `/channels` (client redirect → sign-in) and a component URL (404 card) must now block with `DESIGN_ROUTE_MISMATCH` naming the signal; `/about` must still pass.
- [ ] Append "Round 5" to the pilot report with commands and outputs; a remaining gap is recorded.

## Release note

S6 is a patch-class fix round; `backCompatUntil` is untouched.
