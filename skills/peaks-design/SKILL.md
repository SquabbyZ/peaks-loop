---
name: peaks-design
description: Design-governance orchestrator for the Peaks-Loop skill family. Use when the user asks to establish a design system, audit page consistency, or bring a page back to the business style in a code repository (设计治理 / UI 治理 / 设计系统 / 页面风格不一致). Coordinates peaks-ui, peaks-rd and peaks-qa on top of the design/ contract while preserving user confirmation gates; never dispatched by peaks-code. Triggers on `/peaks-design`, "设计治理", "UI 治理", "设计系统", "页面风格不一致".
---

<!-- peaks:loop-hygiene — HAND-MAINTAINED block, NOT generated; byte-identical in every SKILL.md, enforced by tests/unit/skills/loop-hygiene-block.test.ts. Edit one, edit all 26. -->

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
6. Delivery: the LLM invokes `peaks design check --gate` on the user's behalf to write the
   evidence. A `fail` returns to RD inside the 3-round cap; a `blocked` fixes the environment
   first and does not consume a round.
7. Wrap up: update the exemplars after user confirmation, then extract memory.
8. Contract revision happens only after user confirmation, through design init --refresh.
   `status` shows the contract age and the latest observed drift; an observed outlier is never
   adopted into the contract automatically.

## Hard rules (spec §10)

- Never return `pass` when the engine, the browser, URL trust or the change set is missing.
  `blocked` is not a pass.
- Never write an observed outlier into the contract automatically.
- Never require the user to type a CLI verb or hand-author evidence: the user picks or
  describes in natural language, and the LLM runs the CLI on the user's behalf.
- Never vendor designlang source, or install its plugin, MCP or skill.
- Never commit session artifacts or runtime screenshots; only redacted or synthetic
  screenshots may be committed, and only after user confirmation.
- Never let general taste rules from `peaks-ui` override a project contract.
- Never let the `peaks-code` core flow depend on an optional MCP.
- Never become a second `peaks-code`: this skill does not edit source and does not take over
  feature development.
