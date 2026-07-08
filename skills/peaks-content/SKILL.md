---
name: peaks-content
description: Non-code orchestrator for content workflows (draft / edit / publish / archive). Use when a user wants to drive an end-to-end content-production loop (blog post, newsletter, marketing copy, social thread, doc page) where the LLM must coordinate draft / edit / tone / publish / archive stages with explicit gates between them, and where the user only wants to speak natural language and pick options. NOT for free-form chatting; NOT for code review. Reuses the peaks-loop Loop Engineering primitives (Loop Engineering Asset, Bee Asset, Workflow Trace, Evolution Evaluation) but does NOT import peaks-code internals. Triggers on `/peaks-content`, "peaks content", "content workflow", "publish this to <channel>", "edit the draft", "archive the previous version".
---

# peaks-content

`peaks-content` is the **content-domain** orchestrator for peaks-loop. It drives an end-to-end content-production loop — draft, edit, publish, archive — through LLM-mediated sub-agents (the "bees") so a non-technical user can produce a polished, channel-ready piece of writing by speaking natural language and picking from multi-choice options. The user never types a CLI verb; the user never hand-authors markdown or JSON; the LLM runs every structured operation on the user's behalf.

This is a **content-domain** orchestrator. It is NOT code (peaks-code does that), NOT research (a future `peaks-research` skill does that), NOT data, NOT medical, and NOT legal. It does NOT import peaks-code internals — it reuses the same Loop Engineering primitives (Loop Engineering Asset, Bee Asset, Workflow Trace, Evolution Evaluation) defined in the shared guideline file at `.peaks/standards/loop-engineering-guidelines.md`.

## Loop Engineering role

`peaks-content` is a **non-crystallizing orchestrator** for the content domain. The skill drives LLM-mediated sub-agents (the "bees" — see "Sub-agents (the bees)") that perform the actual draft / edit / publish work. The skill does NOT crystallize `loop_release` / `bee_release` / `crystallization_event` rows by itself. A user may optionally invoke `peaks asset crystallize` AFTER a run to persist the workflow as a Loop Engineering asset, but that is a separate, post-run step owned by `peaks-maker` (not this skill).

This non-crystallizing shape mirrors the M6 `peaks-maker` pattern: the durable artifact of a content run is the published piece + the archive history, not a peaks-loop SkillHub release. Crystallizing the orchestrator itself would conflate "I shipped a blog post" with "I want this run to become a reusable skill" — two different user intents, kept on two different timelines.

Reference: the karpathy-engineered red lines that govern every Loop-Engineering-participating peaks-* skill live at `.peaks/standards/loop-engineering-guidelines.md`. `peaks-content` honors `RL-0` (karpathy × darwin co-equal), `RL-1` (Human-NL-Choice-Only), `RL-2` (no durable change pre-run), `RL-8` (peaks-code domain boundary), and `RL-9` (desktop + share go through the peaks CLI).

## When to use

Concrete triggers:

- The user says `/peaks-content` or "peaks content" or "content workflow".
- "Draft a blog post about `<topic>`" / "write a post on `<topic>`".
- "Edit the draft" / "tighten the tone" / "check the claims" / "shorten this".
- "Publish to `<channel>`" / "post this to Medium" / "send the newsletter" / "schedule the thread".
- "Archive the previous version" / "supersede the old post".
- "Take this topic from draft to publish" (full-pipeline run).
- "What stage is `<draft>` in?" (inspect-pipeline-state run).
- "Save this draft → edit → publish loop as a Loop Engineering asset" (crystallization request — routed to `peaks asset crystallize`).

## When NOT to use

The rubric-banned surfaces — `peaks-content` MUST refuse these targets:

- **Medical advice** — anything that contains (or appears to contain) clinical recommendations, dosage, diagnosis, or treatment. The skill refuses and routes the user to a different peaks-* skill with stricter medical gates.
- **Legal advice** — anything that contains statutory interpretation, contract review, or jurisdictional guidance. The skill refuses and routes the user to a legal-domain peaks-* skill.
- **Financial advice** — anything that contains investment guidance, tax planning, or securities recommendations. The skill refuses and routes the user to a finance-domain peaks-* skill.
- **User-generated content moderation** — bulk review, flagging, takedown, or appeal handling for user-submitted content is a different policy with different gates; the user must use a moderation-specific peaks-* skill.
- **Personal data extraction** — drafts that ingest emails, phone numbers, addresses, government IDs, or other PII into the piece. The skill refuses to ingest PII (see RL-2).
- **Code-coupled content** — drafts that require the LLM to write or modify source code (e.g. "show me the API response in this post") are routed to peaks-code for the code part; the content part stays here, but only after the code piece is stable.
- **Hand-authored markdown / JSON** — anything that requires the user to type markdown structure or fill a JSON file. The LLM authors the markdown; the user describes the intent in NL.

If the only available candidate falls in a banned surface, the skill surfaces the skip list with reasons and asks the user to expand the topic source — it does not bypass the rubric.

## Domain boundary (RL-8 echo)

`peaks-content` is **content-domain only**. It does NOT do code, research, data, medical, or legal. Cross-domain work goes to:

- `peaks-code` for code.
- `peaks-research` (future) for research.
- `peaks-product` (future) for product artifacts.
- A medical-domain peaks-* skill for medical content.
- A legal-domain peaks-* skill for legal content.

Each of these is a separate orchestrator skill, NOT a subclass of `peaks-content` and NOT a subclass of `peaks-code`. Each must import `.peaks/standards/loop-engineering-guidelines.md` and pass `peaks skill lint --category loop-engineering-readiness`.

## Inputs (NL or choice only — RL-1)

The skill accepts exactly **four** trigger forms. Every form resolves via `AskUserQuestion` multi-choice or free-form NL; the user never types a CLI verb or hand-authors JSON.

1. **A. Run a stage on a piece** — "draft a post about `<topic>`" / "edit the draft" / "publish to `<channel>`" / "archive `<old-version>`". The user names the stage; the LLM finds the piece in `.peaks/content/drafts/` and runs only that stage.
2. **B. Run a full pipeline** — "take this topic from draft to publish". The skill proposes the 4-stage chain (draft → edit → publish → archive) and asks for one confirm pick.
3. **C. Inspect pipeline state** — "what stage is `<draft>` in?" The skill reads the frontmatter and returns a one-screen status.
4. **D. Crystallize the workflow** — "save this draft → edit → publish loop as a Loop Engineering asset". The skill routes to `peaks asset crystallize` after a successful run; the crystallization prompt itself is owned by `peaks-maker`, not this skill.

The user also provides: (a) the topic or piece slug (NL — "hermes-agent launch post", "Q3 newsletter", "developer-tool thread"); (b) the target channel (NL — "blog", "Medium", "Twitter thread", "email newsletter", "internal doc"); (c) the tone (NL — "casual", "editorial", "technical"); (d) the length target (NL — "500 words", "a long-form post"); (e) the publish deadline (ISO or NL — "next Friday" → the LLM derives an ISO date).

## Default runbook

The 6-step procedure the LLM must follow on every run. The LLM runs the CLI on the user's behalf — the user only describes and picks.

### 1. Anchor + skill marker

```bash
peaks workspace init --project .
peaks skill presence:set peaks-content --gate startup
```

### 2. NL interview (one question at a time)

The LLM asks ONE question at a time (the "test user does not know the system" scenario). The interview collects: the piece slug (or the LLM looks it up in `.peaks/content/drafts/`), the target channel, the tone, the length target, and the publish deadline. The user never sees a JSON form or a CLI prompt — every input is a multi-choice pick or free-form NL.

### 3. Draft stage — `bee-content-draft`

The LLM dispatches to the draft bee. The draft is a plain markdown file at `.peaks/content/drafts/<slug>.md`. The frontmatter captures the 4-section brief (see "PR / artifact format"). The body is the actual content.

### 4. Edit stage — `bee-content-edit`

A separate edit bee runs. The 4-section gate fires between draft and edit:

- **Tone gate** — the edit bee confirms the piece matches the user-confirmed tone.
- **Factual-claims gate** — the edit bee flags any claim that lacks a citation. Drafts with unflagged claims cannot advance to publish (RL-3).
- **Length gate** — the edit bee confirms the piece is within the user-confirmed length target.
- **No-PII gate** — the edit bee scans for emails, phone numbers, addresses, government IDs. If any are present, the bee refuses to advance and tells the user which lines to remove (RL-2).

### 5. Publish stage — `bee-content-publish` (GATED on user pick)

A separate publish bee runs. The gate fires between edit and publish: the user (Human-NL-Choice-Only) confirms the **final draft + target channel** via `AskUserQuestion`. The skill MUST ask the user to pick the final channel + final tone + final length before any external write. Only after the user's pick is captured does the publish bee run.

**Hard rule (RL-1 enforcement):** the skill MUST refuse to write to any external channel (Twitter / Medium / email / Discord / etc.) without an explicit user pick. The user is the only actor who can authorize an external write. The LLM may prepare the payload (markdown, tags, schedule), but the actual outbound call is gated on the user's choice.

### 6. Archive stage — `bee-content-archive`

The previous version of the piece (if any) is moved to `.peaks/content/archive/<channel>/<slug>-<version>.md`. A `crystallization_event` is recorded for the full run only if the user picked option D in the inputs (and even then, the crystallization itself is owned by `peaks-maker` via `peaks asset crystallize`).

## Sub-agents (the bees)

The skill orchestrates four bees. Each bee is a sub-agent dispatch; the skill is the orchestrator that schedules them. Each bee has its own prompt + context; none of them touch the user's content directly without the orchestrator passing them the artifact path.

- `bee-content-draft` — generates the first draft from a brief. Consumes: topic + tone + length + audience. Produces: `.peaks/content/drafts/<slug>.md` with frontmatter + body.
- `bee-content-edit` — runs tone / factual / length / PII checks. Consumes: the draft path + the frontmatter brief. Produces: an edit report (line-level findings) + an advance/blocked verdict.
- `bee-content-publish` — formats + posts to the channel (gated on user pick). Consumes: the final-draft path + the user-confirmed channel. Produces: the outbound payload + the publish receipt.
- `bee-content-archive` — moves the previous version to the archive dir. Consumes: the current-version path + the new-version path. Produces: the archived copy + a manifest update.

## PR / artifact format

The markdown file header used in `.peaks/content/drafts/<slug>.md`:

```markdown
---
title: <piece title>
channel: <target channel>
status: draft | edit | publish | archive
version: <semver>
created_at: <ISO>
updated_at: <ISO>
author_intent_raw: <the user's original NL request>
tone: <user-confirmed tone>
length_target: <user-confirmed length>
publish_deadline: <ISO or null>
crystallization_event: <id or null>
---
```

The 4-section brief is stored as the frontmatter; the body is the actual content. This mirrors M4/M5 evidence-brief conventions. The `crystallization_event` field is null unless the user picked option D in the inputs and a crystallization event was recorded by `peaks-maker`.

## Red lines (karpathy 4-section form)

Each red line below is written in the karpathy 4-section form (Failure modes / Rewrite / Self-check / Out-of-scope). The skill refuses to advance past any red line violation.

## RL-1 — Human-NL-Choice-Only (echo; the publish gate)

**Failure modes.** User is asked to hand-fill JSON or type a CLI verb; user pushed into schema decisions; user accepts opaque publish recommendations by default; the publish bee writes to an external channel without an explicit user pick.

**Rewrite.** Every user input is either an `AskUserQuestion` multi-choice pick or free-form NL. The LLM runs the CLI. The publish bee is gated on an explicit `AskUserQuestion` confirm of channel + tone + length; the LLM may prepare the payload, but the outbound call only fires after the pick.

**Self-check.** Did any step require the user to type a verb? Is the publish bee blocked until the user picks the channel? Does every recommendation include an evidence brief? Does the new skill still gate every CLI invocation through the LLM?

**Out-of-scope.** Machine-driven CI flows; emergency security gates (LLM + red lines take over; user is informed in NL).

## RL-2 — No personal data (PII) in any draft

**Failure modes.** A draft contains an email, phone number, postal address, or government ID; the edit bee advances the piece anyway; the piece publishes with PII and the user's privacy is exposed.

**Rewrite.** The edit bee MUST scan the draft for emails, phone numbers, addresses, and government IDs. If any are present, the bee refuses to advance and the user must explicitly remove them before the next gate. Forbidden patterns: `\b\S+@\S+\.\S+\b`, `\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b`, any 9-digit numeric run, any line containing "SSN" / "passport" / "driver's license".

**Self-check.** Does the edit bee's report include a PII scan section? Are any of the forbidden patterns matched in the draft? If matched, did the bee refuse to advance?

**Out-of-scope.** Public-figure bylines (the user explicitly opted in to a public byline at draft time), branded content that names the user's company (not personal data).

## RL-3 — No fabricated citations / facts

**Failure modes.** A draft makes a claim ("X% of users prefer Y") with no citation; the edit bee advances the piece anyway; the piece publishes with unverified claims and the user's credibility is exposed.

**Rewrite.** The edit bee MUST flag any claim that lacks a citation. Drafts with unflagged claims cannot advance to publish. A "claim" is any sentence containing a number, a percentage, a date, a named study, or a comparative ("X is faster than Y"). A "citation" is a URL, a paper title, or a user-supplied source pointer.

**Self-check.** Does the edit bee's report include a claims-without-citations list? Is the list empty? If non-empty, did the bee refuse to advance?

**Out-of-scope.** Subjective opinions ("I think X"), user-supplied anecdotes ("in my experience"), or branded opinions ("we believe X") — these are not factual claims.

## RL-4 — One piece = one decision

**Failure modes.** The LLM batch-publishes multiple pieces in one user pick; the user did not see each piece's final draft; an embarrassing piece slips through with the good ones.

**Rewrite.** Each piece gets its own confirm pick. The publish bee is invoked once per piece. The user sees the final draft of THIS piece only and confirms THIS piece's channel + tone + length. No "publish all 5 of these" UI affordance is offered.

**Self-check.** Did the user see a confirm pick for THIS piece? Did the publish bee run for THIS piece only? Is the count of pieces the user confirmed equal to the count of pieces the publish bee ran for?

**Out-of-scope.** A user-explicit "publish the whole batch" — the skill surfaces the list, asks the user to confirm each one, and refuses to bulk-publish.

## RL-5 — Tone + length + channel are user-confirmed before publish

**Failure modes.** The LLM infers tone / length / channel from the brief alone; the user did not confirm; the piece publishes with the wrong shape.

**Rewrite.** The publish bee refuses to run without these three fields set in the frontmatter. The user-confirmed values come from the `tone`, `length_target`, and `channel` fields of `.peaks/content/drafts/<slug>.md`. If any of the three is null or empty, the publish bee returns `BLOCKED_NEEDS_USER_CONFIRM`.

**Self-check.** Are all three frontmatter fields non-null at publish time? Did the user confirm each of the three in the publish-gate pick? If any field changed during edit, did the user re-confirm?

**Out-of-scope.** Auto-correction at edit time — the edit bee may propose a tone tweak, but the user must re-confirm before the publish bee runs.

## RL-6 — Drafts are immutable once published

**Failure modes.** A live edit modifies a published piece without archiving the previous version; the user loses the audit trail; the piece's history is untraceable.

**Rewrite.** Once a piece is published, the only path to update it is the archive step. A "live edit" without archive is forbidden. The archive step moves the previous version to `.peaks/content/archive/<channel>/<slug>-<version>.md` before the new version is written.

**Self-check.** Is the previous version present in the archive dir? Does the new version have a semver greater than the archived one? Did the archive step run BEFORE the new write?

**Out-of-scope.** Typo fixes — those go through the same archive step (typo fixes are version bumps, not silent edits).

## RL-7 — No medical / legal / financial advice

**Failure modes.** The LLM drafts a piece that contains medical dosage, legal interpretation, or investment guidance; the user ships it; the user is exposed to liability.

**Rewrite.** The skill MUST refuse to draft any piece that contains (or appears to contain) advice in those domains. The trigger phrases are checked at draft time: any sentence containing "should take", "is safe to", "prescribe", "diagnose", "statute", "case law", "investment recommendation", or similar domain markers → the skill refuses and routes the user to the appropriate peaks-* skill.

**Self-check.** Does the draft contain any of the forbidden trigger phrases? If yes, did the skill refuse to advance? Did the skill surface the skip list with reasons?

**Out-of-scope.** General-audience health explainers ("how sleep works"), legal news summaries ("the EU passed a law"), financial education ("how index funds work") — these are not advice in the actionable sense.

## RL-8 — Cross-domain work is a different skill

**Failure modes.** The skill smuggles code-writing into a blog post; the user gets a code-coupled draft that the LLM cannot reliably produce; the content piece relies on broken code.

**Rewrite.** If the user asks for a content piece that requires code (e.g. "show me the API response in this post"), the skill routes the code part to `peaks-code`; the content part stays here, but only after the code piece is stable and reviewed. The skill never writes or modifies source code.

**Self-check.** Does the draft reference code that the LLM authored? If yes, did that code go through `peaks-code` first? Is the code piece reviewed and stable?

**Out-of-scope.** Documentation pages that link to existing code snippets in the user's repo (read-only references, no code authoring).

## RL-9 — Crystallization is opt-in

**Failure modes.** The skill auto-crystallizes a run, polluting the user's SkillHub with one-off content runs; the user did not opt in; the asset pool fills with low-signal content loops.

**Rewrite.** The skill does NOT auto-crystallize. The user must pick option D in the inputs to crystallize a run as a Loop Engineering asset. Even then, the crystallization itself is owned by `peaks-maker` via `peaks asset crystallize`; the skill only records the run in the frontmatter `crystallization_event` field.

**Self-check.** Is the `crystallization_event` field null unless the user picked option D? Did the skill refuse to call `peaks asset crystallize` without the user pick?

**Out-of-scope.** Replay of a previously crystallized content run — the replay is a new run, not a new crystallization; the frontmatter `crystallization_event` field points to the existing asset, not a new one.

## Boundaries

What this skill MUST NOT do:

- **Publish to any external channel without an explicit user pick** (RL-1 / RL-5).
- **Touch the user's repo** (write to source code) — `peaks-code` does that.
- **Hand-author markdown / JSON on the user's behalf** when the user is just describing intent.
- **Ingest personal data** into the draft (RL-2).
- **Run a publish** without the user-confirmed tone / length / channel (RL-5).
- **Live-edit a published piece** without archiving the previous version (RL-6).
- **Draft medical / legal / financial advice** (RL-7).
- **Smuggle code-writing into a content piece** (RL-8).
- **Auto-crystallize a run** without the user's option D pick (RL-9).
- **Batch-publish multiple pieces in one user pick** (RL-4).

## Audit (reproducibility)

The 5-line verification block the user can run after a content run:

```bash
cat .peaks/content/drafts/<slug>.md            # piece exists, frontmatter is complete
git status .peaks/content/                    # archive step committed
cat .peaks/content/archive/<channel>/<slug>-<version>.md 2>/dev/null   # previous version archived
.peaks/standards/loop-engineering-guidelines.md -c "RL-1|RL-5|RL-7"   # ensure RLs are referenced
.peaks/_runtime/<sessionId>/crystallization-event.json 2>/dev/null   # crystallization event if user picked D
```

If any line returns an unexpected value, the run has been mutated externally; the per-piece frontmatter + the archive history are the source of truth.

## First-class outputs

The skill produces the following files for the user to verify:

- `.peaks/content/drafts/<slug>.md` — the working draft (frontmatter + body).
- `.peaks/content/drafts/<slug>.edit-report.md` — the edit bee's report (tone / factual / length / PII findings).
- `.peaks/content/archive/<channel>/<slug>-<version>.md` — the previous version (after archive step).
- `.peaks/content/published/<channel>/<slug>-<version>.md` — a copy of the published piece (for audit; the real publish lives on the channel).
- `.peaks/_runtime/<sessionId>/peaks-content/run-summary.md` — the LLM's run summary (stage sequence, gate verdicts, user picks).
- `.peaks/_runtime/<sessionId>/peaks-content/publish-receipt.json` — the publish bee's receipt (channel, post URL, timestamp).
- `.peaks/_runtime/<sessionId>/crystallization-event.json` — the crystallization event (only if the user picked option D).
