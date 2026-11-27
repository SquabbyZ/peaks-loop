---
name: peaks-design
description: Design-governance orchestrator for the Peaks-Loop skill family. Use when the user asks to establish a design system, audit page consistency, or bring a page back to the business style in a code repository (设计治理 / UI 治理 / 设计系统 / 页面风格不一致). Coordinates peaks-ui, peaks-rd and peaks-qa on top of the design/ contract while preserving user confirmation gates; never dispatched by peaks-code. Triggers on `/peaks-design`, "设计治理", "UI 治理", "设计系统", "页面风格不一致".
---

<!-- peaks:loop-hygiene — HAND-MAINTAINED block, NOT generated; byte-identical in every SKILL.md, enforced by tests/unit/skills/loop-hygiene-block.test.ts. Edit one, edit all 27. -->

## Loop hygiene (every turn — MANDATORY)

**Skill header.** While this skill is active, open every turn with
`Peaks-Loop Skill: <skill> | Peaks-Loop Role: <role> | Peaks-Loop Gate: <gate> | Peaks-Loop Context: <ratio%> (<zone>) | Next: <one short action>`.
Every turn, not only the first — it is how the user knows which skill is driving.
`Role` and `Context` are machine facts: copy them from `peaks skill presence --json`
(`data.role`, `data.context.ratioPct`, `data.context.action`) — never invent them.

**Context is this skill's own business.** Run `peaks skill presence --json` every turn and
read its `context` block. When `action` is `auto-fire`, `pre-compact`, or `red-line`,
run `peaks code auto-compact --project .` **yourself**, then continue. Tell the user the
ratio in one line if it helps, but never hand them the compaction step: asking the user to
run `/compact` is the regression the zero-pause contract forbids. This holds in **every
mode** — standard *and* 24h. The mode moves the threshold, never the obligation.

**Read before you edit.** Read a file before your first `Edit` / `Write` / `MultiEdit` on
it — the normal way to work here — for every path outside `.peaks/**` (source, tests, docs,
config); `.peaks/**` writes are exempt.

**Expect one denial per file anyway — and do NOT pre-empt it.** A `PreToolUse` gate (ECC's
"Fact-Forcing Gate") denies the FIRST edit a session makes to any given path, once, by
design. Reading does NOT prevent it: the gate keys on the path's first touch, not on whether
you read it. **Do not recite its four questions before every edit** — it asks when it wants
them, and reciting unprompted burns a round-trip per file for nothing. Answer only when a
denial actually arrives.

**When one does arrive:** a denial is not a failure and the tool is not broken — your edit
was NOT applied. State the facts it asks for (importers, affected API, data schemas if any,
the user's verbatim instruction), then retry the SAME operation. The retry is allowed. Do not
switch tools, do not give up, do not retry blindly. One more thing worth knowing: an idle gap
of ~30 minutes clears the gate's "already passed" list, so a file you cleared earlier can be
denied again after a long pause. That is the gate resetting, not you regressing.
<!-- /peaks:loop-hygiene -->

# Peaks-Loop Design

`peaks-design` is the design-governance orchestrator of the Peaks-Loop skill family. It owns
the design domain end-to-end — the `design/` contract, the design audit, the remediation plan
and the delivery gate — as a sibling lane beside `peaks-code`, not beneath it.

## Scope (RL-8 — design work in code repositories only)

Design work here means visual and token governance of a frontend surface inside a code
repository: building the contract, auditing page consistency, and bringing a page back to the
business style. This skill imports `.peaks/standards/loop-engineering-guidelines.md` and is a
sibling lane, never a subclass or variant of `peaks-code`.

- **In scope:** the design truth layer (design init / status / uninit / refresh), the source
  consistency audit, design-shaped requests, systematic UI remediation planning, and exemplar
  registration.
- **Out of scope:** generating pages or design files, Figma sync, non-frontend projects,
  absolute "beauty" scores, and brand, print or slide design.
- **Sibling-lane boundary:** `peaks-code` owns feature development and dispatches `peaks-ui`
  inside it. `peaks-code` never dispatches `peaks-design`, and `peaks-design` never takes over
  a feature-development flow; when a request is the other lane's shape, each recommends the
  switch to the user instead of stretching its own boundary.

## Owned vs delegated

Owned by this skill:

- the `design` request and its gate transitions (the same gate ownership `peaks-code` has,
  limited to design-shaped requests);
- building and revising the contract (design init orchestration, review summary, user
  confirmation);
- the design audit (`peaks design check`, plus render evidence and drift interpretation);
- the remediation plan and acceptance for systematic UI fixes;
- exemplar registration, review and refresh;
- the pre-delivery design gate.

Delegated, and never done here:

- **`peaks-ui`** owns design direction, prototypes, page states and design artifacts —
  aesthetics on top of the contract. Its general taste rules apply only when no contract
  exists; they never override a project contract.
- **`peaks-rd`** owns every `src/**` and `tests/**` edit. This orchestrator never calls
  Edit/Write on source; it dispatches `peaks sub-agent dispatch rd` with the contract and the
  findings as hard constraints.
- **`peaks-qa`** owns verification and regression evidence.
- **`peaks-prd`** is dispatched only when a design change needs a requirement frame.

## Default flow (spec §9.3)

1. Recognise a design-shaped request; read `.peaks/standards/loop-engineering-guidelines.md`
   and the project contract (the contract file inside the app root's `design/` directory)
   when one exists.
2. The LLM runs `peaks design status --project .` to decide whether the project is integrated.
3. Not integrated: walk design init (the three user choices at spec §6.6), then let the user
   confirm the contract.
4. Design audit: the LLM invokes `peaks design check` on the user's behalf. A `blocked` result
   is handled by its reason — never skipped, never turned into a pass.
5. Code change needed: dispatch `peaks sub-agent dispatch rd` with the contract, the paved
   road and the findings as hard constraints, then dispatch `peaks-qa` for verification.
6. Delivery: `peaks design check --gate` writes the conformance evidence. Use
   `--allow-source-only --accept-note "<user words>"` only as the explicit source-only
   acceptance. A `fail` returns to RD inside the 3-round cap; a `blocked` fixes the
   environment first and does not consume a round.
7. Wrap up: update the exemplars after user confirmation — registration is the file
   convention `design/exemplars/<archetype>/` holding `meta.json`, `<name>.tsx` and
   `<name>.png` (screenshots redacted or synthetic, per the README beside them) — then
   extract memory.
8. Contract revision happens only after user confirmation, through design init --refresh.
   `status` shows the contract age and the latest observed drift; an observed outlier is never
   adopted into the contract automatically.

## Per-route parallel read-only audit

The audit and the fidelity check are reads, so they may fan out; the page write never does.
When the audit covers two or more routes, give each route one **read-only** reader:

- **One reader per route.** Each reader inspects its route's screenshot, fidelity verdict
  and declared `routeMarkers` evidence, and returns a bounded report. It reads and reports;
  it does not edit, does not write the page, and never commits.
- **Writes stay sequential.** `peaks-rd` still receives one sequential dispatch once the
  readers' evidence is merged, and page edits stay single-threaded. Parallelism lives in the
  audit, never in the remediation.
- **A failed reader is an ERROR, never a pass.** A reader that times out or errors marks its
  route **ERROR**; it is never read as "this route had no problem". Rerun it, or audit the
  routes serially, and state the degradation in the conclusion. One route's `blocked` still
  blocks the audit — it does not become a pass because another route was green.
- **No rid, no artifact contract, no worktree lease.** Read-only auditing writes nothing, so
  nothing is bound or leased; those belong to the parallel-write surface (S3.3).

## From usable to good-looking (the five moves)

"The features are there, but it still looks wrong" is not fixed by "make it more premium".
Replace adjectives with these five moves, in order; the fast lane `peaks-race-design` uses the
same method for a single page.

1. **Reference by the kind of page.** Tool UI: Linear (hierarchy), Raycast (search/shortcuts);
   marketing site: Stripe (narrative), Notion (content organisation); flows: Mobbin; brand and
   motion: Awwwards.
2. **Screenshot plus the reason.** Circle what you like — title size, whitespace, nav, image-to-
   text ratio — and name it. One primary reference per round; others fill local gaps only.
3. **Rules before pages.** Write the numbers first: background, accent, type scale, spacing,
   radius ("body 16px, card gap 24px"), then adjust per content and device.
4. **First screen first.** Real title, image and button; decide the direction there, then
   extend to the rest and to the interaction states.
5. **Look at the actual screenshot every round**, desktop and phone. Name the three most
   obvious problems (what is cramped, what steals attention, what is misaligned), fix those
   three, screenshot again.

## Slop audit (before any direction)

Aim the gate at AI tells, not at taste adjectives. Method adapted from two external
references (read them; do not install or execute them without the user's approval):
`github.com/felipebasurto/unslop-ui` (a rule catalog for tells) and `github.com/heydamir/unslop`
(an audit-first procedure). The catalog below is the subset the design gate can check.

- **Audit first, name the tell, then propose a direction.** List each problem with where it
  lives; derive the direction from the product (its character, the one or two moments that carry
  the colour, a signature detail), never from a generic "premium" aesthetic. Do not redesign a
  screen that is already good — say so.
- **Ordered passes** (each pass touches only its axis): spacing → colour → icons → copy → type →
  layout → details → visuals and motion. This is a redline review, not a rewrite.
- **Copy tells** (remove, do not restyle): eyebrows above headings; decorative `01 /` numbering;
  subtitles that repeat the title; botsplaining ("click the button above"); leaked design notes
  ("(updates in real time)"); status strings not tied to real state; label + placeholder + helper
  all saying the same word; staccato slogans; badges and status dots with no state; decorative
  emoji or tinted icon squares; arrows after links; generic names ("Learn more", "Submit").
  Rewrite the retained string as a plain statement; no em dashes, no AI vocabulary ("seamless",
  "robust", "empower", "effortlessly"), no forced rule of three.
- **Surface tells (opt-in, only when the user asks for the visual surface):** hue-to-hue gradients,
  gradient text, coloured glows; off-scale spacing (use 4, 8, 12, 16, 20, 24, 32, 40, 48, 64);
  `font-extrabold`/`font-black` (use 500 or 600); `transition-all`, `hover:scale-*`, fade-up on
  scroll, count-up numbers (named properties at 150 ms; show content in place); thick coloured
  edge stripes unless they encode state.
- **Charts:** title the measure, not the chart type; no reading instructions; direct labels instead
  of a legend box; hairline gridlines; one line of KPI context.
- **Guardrails:** delete first, write little; never invent numbers, speeds, features or
  testimonials; preserve `aria-label`, `alt`, visible labels, links and anything tied to real
  state; a screen with nothing to cut stays untouched; unverifiable claims become follow-up tasks,
  not silent edits.

## Hard rules (spec §10)

- Never return `pass` when the engine, the browser, URL trust or the change set is missing.
  `blocked` is not a pass.
- Never write an observed outlier into the contract automatically.
- Never require the user to type a CLI verb or hand-author evidence: the user picks or
  describes in natural language, and the LLM runs the CLI on the user's behalf.
- Never vendor designlang source, or install its plugin, MCP or skill.
- Never commit session artifacts or runtime screenshots; only redacted or synthetic
  screenshots may be committed, and only after user confirmation — see
  `design/exemplars/README.md`.
- Never deliver a feature/bugfix handoff without `design/check-<rid>.md`: the
  `DESIGN_CONFORMANCE` prerequisite refuses `rd:qa-handoff` once its back-compat window closes.
- G3a is hard only where a baseline exists: fidelity below 90 fails, an unreachable or
  trusting-side block is `blocked`, and a route without a baseline is `skipped('no-baseline')`
  — never a pass and never an invented baseline.
- Route identity is evidence-bound, in BOTH directions. A negative marker counts only when it
  opens the page's own title or a heading, and a declared marker is observed only there too — a
  shared header button (`Sign in` on every page) or a sidebar link is chrome, so it can neither
  prove a wrong route nor satisfy a declaration.
  A route whose `paved-road.json` declares no `routeMarkers` entry cannot be told apart after a
  client-side redirect, so the stage is inert. G2 and G3a record that judgment as an evidence line:
  `route <path>: inert (no routeMarkers entry)` for an inert route, or
  `route <path>: declared marker observed` for one whose marker was observed. Declare a marker for
  every route the gate must identify, and never read the inert line as a pass. The marker must be
  text the page's own title or a collected heading carries; designlang collects headings inside
  semantic sections only, so a marker whose only home is a non-semantic `<h1>` reads as unobserved
  and blocks the route.
- G3b is advisory: the rubric's six dimensions (each 1–5) are normalised to the 40-point scale
  the spec names, a below-threshold total warns, and the threshold only becomes a failure after
  a recorded calibration run. `--skip-exemplar` needs the user's own words and never skips G3a.
- Never let general taste rules from `peaks-ui` override a project contract.
- Never let the `peaks-code` core flow depend on an optional MCP.
- Never become a second `peaks-code`: this skill does not edit source and does not take over
  feature development.
