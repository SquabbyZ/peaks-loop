# peaks design — S6 Implementation Plan (route identity)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the usability probe answer the second question the pilot exposed — "is this the page I asked for?" — so a client-side sign-in redirect or a router 404 card becomes `blocked`, never a G3a/G2 verdict.

**Architecture:** A spike enumerates what `designlang extract`/`stats` actually expose about the rendered page (final URL after client navigation, forms/password fields, headings/text, HTTP-error markers). `route-identity.ts` then compares the observation with the expected route using only those measured signals, and the probe runs it after the paint stage. A configuration seam lets a project declare an expected marker per route; nothing is invented where the tool exposes nothing.

**Tech Stack:** TypeScript ESM, designlang 13.4.1, Vitest; evidence from the pilot report (rounds 2/4) and the round-3 usability spike.

**Spec:** the S3/S4 spec plus `.peaks/_runtime/2026-11-23-session-320f58/rd/s5-usability-round3.md` and `design/pilot-report.md`.

## Spike findings (t1, complete — measured)

- **No final-URL-after-client-navigation field exists.** `meta.url`, `pageIntent.path` and `stats.url` echo the REQUEST; the crawler never reads `page.url()`. A client-side redirect cannot be detected from the payload.
- **No password type.** `inputTypesSeen` degrades to the tag (`{"input":2}`), and input counts are legitimately non-zero on a settings page — an input count alone must never block.
- Headings are placement-dependent: the pilot's sign-in h1 and 404 h1 sit outside semantic regions and expose `[]`; the same markup inside `<main>` exposes them. Not-found text is not exposed on the pilot 404; its buttons leak as "Go Back"/"Back to Home". Devtools pollute `buttonPatterns`.
- Consequence: on the current pilot, identity can only be caught by a DECLARED expected marker (unobserved → form wall / marker missing) or a NEGATIVE marker in title/headings/buttonPatterns/anatomy sampleText — not by URL.
- **Capture defect found:** `extract <url> --json --screenshots` never prints its JSON within 120 s on auth-gated routes (>381 s), while the same extract without `--screenshots` takes 3.0 s. That is why round 4 blocked on a capture timeout.

## Global Constraints

- A wrong-page block is `blocked(DESIGN_ROUTE_MISMATCH)` with the measured signal; never a fail, never a score.
- Only signals the tool really exposes may be used; a spike that finds none records the gap and the stage stays inert (documented) rather than guessing.
- An expected-marker declaration is optional; absent, the stage uses only the measured generic signals (negative page-state labels — including an HTTP status label — on the page's OWN title and headings, and the rendered-input form wall only when a declared marker is unobserved). **Shared chrome — button labels and anatomy sample text — decides neither direction** (round-6 critical: a sidebar link satisfied a declared marker). It never uses `meta.url` as a final URL.
- No new dependency; no fabricated evidence; ≤300 raw lines per src file (tests ≤500); BDD triple first; `.js` specifiers; prettier; eslint 0; stage only; orchestrator commits after QA.

## Review Focus

- **False block on a legitimate page:** a real page that happens to contain a password form (e.g. a settings page) must not block when its route matches; Task 1 measures and Task 2 pins the precedence.
- **Client-side redirect:** the final URL must come from the rendered page, not the HTTP response; Task 1 proves which field carries it.
- **Constant SPA titles:** a title mismatch alone cannot be the signal (the pilot's app has one title); Task 1 records it.
- **Config drift:** an expected marker that no longer exists must be reported, not silently ignored; Task 3 pins it.

---

### Task 1: Spike — what the rendered observation exposes

- [x] On the pilot app (or a local fixture trio: rendered page, sign-in page with a password form, 404 card), dump the full `designlang extract --json` and `stats --as-json` payloads and list every field per page.
- [x] Identify which field(s) carry: the final URL after client-side navigation, a password/form signal, not-found text, and any heading/text sample. Record the numbers for each page.
- [x] Write `rd/s6-spike.md` with the field table and a recommendation per signal, including which are absent on this app.

### Task 2: `route-identity.ts`

**Files:** `src/services/design/route-identity.ts`, `tests/unit/design/route-identity.test.ts`.

- [x] `type RouteIdentityInput = { expectedMarker?: string; observation: { title?: string; headings?: string[]; buttonPatterns?: string[]; sampleText?: string[]; renderedInputs?: number } }`
- [x] `evaluateRouteIdentity(input): { ok: true; inert?: boolean } | { ok: false; code: 'DESIGN_ROUTE_MISMATCH'; signal: string; detail: string }`. **As shipped after rounds 5–6 and the reviews:** (1) a declared marker observed on the page's own identity (title/headings) → ok; (2) a NEGATIVE page-state marker in title/headings → block(negative-marker); (3) renderedInputs > 0 while the declared marker is unobserved → block(rendered-form); (4) a declared marker unobserved with no inputs → block(marker-unobserved); (5) nothing declared → inert (ok, documented). The original `http-redirect` cell was deleted (review D10): Stage A already refuses a changed path before this stage exists. Shared chrome (button labels, anatomy sample text) can satisfy neither the declared marker nor a negative one — it is on every route. Never use `meta.url` as a final URL.
- [x] Tests: each live signal alone blocks; a matching route with inputs AND its declared marker observed does not block (settings page); constant titles do not block; an unobserved declared marker reports honestly; an undeclared route is inert; a header-only `Sign in` button never blocks.

### Task 3: Wire the stage into the probe

**Files:** `page-probe.ts`, `page-probe-http.ts`/`design-engine-deps.ts`, `design-check-g3-suite.ts`, tests.

- [x] **As shipped (Task 8 changed the order):** after the identity extract and BEFORE the screenshot capture, the probe calls `evaluateRouteIdentity` with the observation the identity document carries; only a plausible route pays for a screenshot. The paint stage still refuses a blank/artwork-only page for a route that passed.
- [x] A mismatch blocks with `DESIGN_ROUTE_MISMATCH` and the signal; a field the tool does not expose is simply absent from the observation (no guess).
- [x] Tests: fixture sign-in page blocks; 404 card blocks; rendered fixture passes; the stage is inert (documented) when no observation field exists; a route refusal preempts the capture (no screenshot, no capture cost).

### Task 4: Pilot round 5 (bounded)

- [x] Re-run on `ModelMatrix-pilot`: `/channels` (client redirect → sign-in) and a component URL (404 card) must now block with `DESIGN_ROUTE_MISMATCH` naming the signal; `/about` must still pass.
- [x] Append "Round 5" to the pilot report with commands and outputs; a remaining gap is recorded. **Round 5 FAILED the expectation both ways** — see Task 6.

### Task 5: Fix the capture invocation

- [x] `extract <url> --json --screenshots` hangs on auth-gated routes (>381 s) while the same extract without `--screenshots` takes 3 s. Split the two needs: identity/extract JSON without `--screenshots`, and the paint screenshot from a separate invocation (probe the flag combination that returns promptly); bound each; a capture that still times out blocks with the measured elapsedMs.
- [x] Tests with a fake designlang: the split calls happen in order; a slow capture reports capture-timeout with elapsedMs; no JSON is required from the screenshot call.

### Task 6: Round-5 defects — traffic on page identity, not shared chrome

Round 5 (`.peaks/_runtime/<sid>/rd/s6-r5-defects.md`) measured the stage on the real app and it
failed both ways: `/about` blocked because the site-wide header's `Sign in` button matched, and the
404 component was invisible because nothing was declared. The fix:

- [x] **Page identity — title and headings only — decides both directions:** a negative marker blocks, and a declared marker is observed, on the page's own identity; button labels and anatomy sample text are shared chrome and decide neither (round-6 critical: a sidebar "channels" link satisfied a declared "Channels").
- [x] A **declared** marker that is unobserved blocks with signal `marker-unobserved`; an undeclared route stays inert.
- [x] Precedence: declared-observed → ok; negative(title/headings) → block; `rendered-form` (declared unobserved + inputs) → block; `marker-unobserved` → block; else inert. A `http-redirect` cell was written and then **deleted** (review D10) — Stage A already refuses a changed path before this stage exists.
- [x] `error` was dropped from the negative markers (review D9): once the branch became reachable it false-blocked a page titled "Error handling"; the five page-state labels remain.
- [x] The `DESIGN_RENDER_UNREACHABLE` detail names the resolved base URL it probed and points at `--url` (round 5's 3.5 s false unreachable).
- [x] Tests: header-only `Sign in` button does not block; title/heading negative marker does; a declared marker appearing only in a button does not count; every precedence cell; the unreachable message names the base.
- [x] The pilot's `paved-road.json` gains `routeMarkers` for `/about` ("About"), `/channels` ("Channels") and the component URL ("channel type"); the pilot rerun is Task 7. A declared marker must be text the page's own title or a *captured* heading carries — designlang collects headings inside semantic sections only, so a marker whose only home is a non-semantic `<h1>` reads as unobserved and blocks a correct page.
- [x] The stage header documents the honest bound: without declared markers, a client-side redirect is not detectable from designlang 13.4.1's payload.

### Task 7: Pilot round 6 (bounded)

- [x] Re-run the three routes with `routeMarkers` declared: `/channels` → `DESIGN_ROUTE_MISMATCH` (`rendered-form` or `marker-unobserved`), component URL → `DESIGN_ROUTE_MISMATCH` (`marker-unobserved`), `/about` → route stage ok (it may still block later on G2 drift, which is not a route block).
- [x] Append "Round 6" to the pilot report with commands and outputs.

### Task 8: Review fix round (batched)

Three independent reviews and QA measured Task 6's tree. §"Round-6 review findings" in
`.peaks/_runtime/<sid>/rd/s6-r5-defects.md` is authoritative; the batch is D4 (unreachable
negative-marker branch), D5 (route judged before the capture), D6 (block code had no next action),
D7+D11 (control bytes and unbounded page text in evidence), D8 (declared marker satisfied by shared
chrome), D9 (`error`), D10 (dead `http-redirect` cell), D12 (the index held the pre-fix precedence),
plus housekeeping and the skill slice's manifest/count paperwork.

## Release note

S6 is a patch-class fix round; `backCompatUntil` is untouched.
