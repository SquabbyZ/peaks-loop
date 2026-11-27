---
name: peaks-race-design
description: Fast lane for design work — this window edits the page directly, with no sub-agents and no paperwork. Use it when a single page or component needs a visual direction or a polish pass that a screenshot can check (spacing, type scale, a first-screen direction, a card that looks off). Not for a design system, many routes, shared components, or any work needing a durable audit trail — those belong to peaks-design or peaks-code, and a repo that adopted a design contract still runs its gate. Triggers on /peaks-race-design, "peaks race design", 直接改设计, 快速改 UI, 这个页面看着不对.
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

# Peaks-Loop Race Design

Fast lane for design work in a code repository: this window edits the page directly, inspects
real screenshots, and skips the sub-agent paperwork. Use it when the change is one page or one
component whose visual delta you can hold in your head and re-check in a screenshot — a spacing
pass, a type scale, a card that "looks off", a first-screen direction.

**Not this skill** when: the work is cross-cutting (a design system, many routes, a shared
component), needs a durable audit trail or acceptance gates, or touches a risk surface named in
`../peaks-code/references/fast-lane-norm.md` — those belong to `peaks-design` (the orchestrator)
or `peaks-code`. A fast lane is a smaller window, not a lower bar: if the repo has adopted a
design contract, the delivery gate still applies.

**Probe before you start.** Run
`peaks code orchestrator-can-do --lane race --race-subtasks <n> --race-files <n> --race-risk <list>`
first; when `raceVerdict.mustHandoff` is true, stop and hand the work to `peaks-code`.

## The five moves (what actually makes AI-made UI look right)

The failure sentence is always the same: "the features are there, but it still looks wrong."
Answering it with "make it more premium" buys more shadows and gradients. These five moves replace
that with something executable.

1. **Find the right reference first.** Tool UI: Linear for hierarchy, Raycast for search and
   shortcuts. Marketing site: Stripe for product narrative, Notion for content organisation.
   Product flows live on Mobbin; brand expression and motion on Awwwards. Pick by the *kind* of
   page, not by taste in general.
2. **Give a screenshot AND the reason.** A link alone is not a reference. Circle what you like —
   the title size, the whitespace, the nav, the image-to-text ratio — and say which one it is.
   One primary reference per round; other references only fill a local gap.
3. **Rules before pages.** Fix background, accent, type scale, spacing and radius as numbers
   first ("body 16px, card gap 24px" beats "refined"). Treat the numbers as a starting point and
   adjust per content and device — but write them down before drawing the page.
4. **First screen first.** Put the real title, image and button in it; decide the direction
   there. Only then extend to the rest of the page and to interaction states.
5. **Look at the actual screenshot every round.** Desktop and phone. Each round, name the three
   most obvious problems in plain words — what is cramped, what steals attention, what is
   misaligned — fix those three, and screenshot again. Repeat until the three are gone.

## The slop audit (run it before the five moves)

Tells are cheaper to delete than to design around. Adapted from
`github.com/felipebasurto/unslop-ui` (rule catalog) and `github.com/heydamir/unslop`
(audit-first procedure) — read them as references; do not install or execute them without
asking the user.

1. **Audit and name** every offending element with where it lives; audit-only when the screen
   is already solid. Do not redesign a good screen.
2. **Ordered passes, one axis at a time:** spacing → colour → icons → copy → type → layout →
   details → visuals and motion. A redline review, not a rewrite.
3. **Copy tells:** eyebrow labels, decorative `01 /` numbering, subtitles repeating the title,
   botsplaining, leaked design notes, status strings/dots/badges not tied to real state,
   label+placeholder+helper saying one thing, staccato slogans, decorative emoji, arrows after
   links, generic names. Rewrite as a plain statement; no em dashes, no "seamless/robust/
   empower/effortlessly", no forced rule of three.
4. **Surface tells:** gradients and glows, off-scale spacing (4/8/12/16/20/24/32/40/48/64),
   `font-extrabold`, `transition-all`, `hover:scale-*`, fade-ups, count-ups; thick coloured edge
   stripes unless they encode state.
5. **Guardrails:** delete first, never invent numbers or testimonials, preserve `aria-label`,
   `alt`, visible labels, links and real state; a screen with nothing to cut stays untouched.

## Contract and gate discipline (when `design/` exists)

- Read `design/contract.md` + `design/paved-road.json`; pages use `componentEntrypoints` only.
- Before delivery, the LLM runs `peaks design check` toward the gate (the user never types
  a CLI verb). A `blocked` is an environment problem to fix, not a pass; a `fail` is yours
  to fix.
- A `settings`-style page with inputs is legitimate: the probe's form signal only blocks when a
  declared route marker is unobserved.
- Route identity reads the page's own identity (title, headings) against a marker declared per
  route in `paved-road.json` `routeMarkers`; a shared header button is never evidence. Declare a
  marker for a route the gate must identify — undeclared, a client-side redirect leaves the
  stage inert, and inert is not a pass.
- Never commit runtime screenshots; only redacted or synthetic captures belong beside exemplars.

## Per-route parallel read-only audit

When the check spans two or more routes (the page plus a redirect target, or a shared shell
that renders on several routes), the audit and the fidelity check may run in parallel — but
only the reading and the judging:

- **One read-only reader per route.** Each reader audits its own route's screenshot,
  fidelity evidence and route-identity marker, and returns a bounded verdict. It never
  writes the page, never edits anything, and never commits.
- **Page writes stay single-threaded.** Only this window edits the page, and it does so
  after merging the readers' verdicts. Parallelism stops at the edge of the read and the
  judgment; it never reaches `Edit`, `Write` or the delivery gate.
- **A failed reader is an ERROR, never a pass.** A reader that times out or errors is
  marked **ERROR**, never "this route had no problem". Rerun it or read the routes serially,
  and say in the conclusion that the audit was degraded.
- **No rid, no artifact contract, no worktree lease.** Read-only auditing writes nothing,
  so it binds and leases nothing; those belong to the parallel-write surface (S3.3).

## Boundaries

- It imports `.peaks/standards/loop-engineering-guidelines.md` and is a sibling fast lane to
  `peaks-race-code`, not a sub-mode: it does design work in a repository, and it does not
  orchestrate RD/QA.
- The user speaks or picks; the LLM runs every command and reads every screenshot back to them
  in plain language.
