# Peaks Loop

**English** | [简体中文](./README.md)

[![npm](https://img.shields.io/npm/v/peaks-loop?style=flat-square&logo=npm)](https://www.npmjs.com/package/peaks-loop)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![stars](https://img.shields.io/github/stars/SquabbyZ/peaks-loop?style=flat-square&logo=github)](https://github.com/SquabbyZ/peaks-loop/stargazers)

<p align="center">
  <a href="https://raw.githubusercontent.com/SquabbyZ/peaks-loop/main/examples/video-demo/preview/peaks-loop-demo-en.mp4">
    <img src="https://raw.githubusercontent.com/SquabbyZ/peaks-loop/main/examples/video-demo/out/en-closing-960.png" alt="peaks-loop demo (click to play)" width="100%" style="border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.55);">
  </a>
  <br>
  <sub>👆 click the image to play the 60s demo</sub>
</p>

## What it is

### Loop engineering, engineered

**peaks-loop is your Loop Engineering crystallization system — not a workflow tool.** It crystallizes Loop Engineering assets out of real, completed work, and only evolves them through verified improvements. You operate the system through natural language and choices; every structured action is performed by the LLM on your behalf.

The product is governed by a four-layer asset model and a karpathy × darwin dual-discipline, both of which are non-negotiable:

- **Four-layer asset model**: Loop Engineering Asset (the method system, first-class) + Bee Asset (the executable body, first-class) + Workflow Trace (execution trace — evidence only, never the durable asset) + Evolution Evaluation (anti-drift gate, mandatory for any change).
- **karpathy × darwin dual discipline**: karpathy engineers every rule (failure modes + imperative→declarative rewrite + self-check + out-of-scope); darwin verifies every improvement (single object + single dimension + independent-context evaluator + ratchet). The two layers are co-equal partners — neither is a subset of the other. See `.peaks/standards/loop-engineering-guidelines.md` and the upstream references `multica-ai/andrej-karpathy-skills` and `alchaincyf/darwin-skill`.
- **Post-run crystallization**: `loop_release` and `bee_release` are only written after a real task completes; pre-run is always scratch. Four triggers are supported, with `user_explicit` ranked highest.
- **Human-NL-Choice-Only**: you speak or pick; the LLM runs the CLI. Hand-authoring JSON / manifests / form fields is forbidden.

### peaks-code is the code-domain entry — and only the code-domain entry

`peaks-code` is the code-domain long-task loop engineering orchestrator — it runs the long chain (PRD, RD, QA, UI, SC, TXT) and is the role you'll talk to most. It is **not a general-purpose orchestrator** — research, content, product, and other domains are independent `peaks-*` skills that reuse the same Loop Engineering guidelines. See the Loop Engineering design `docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md` §0.4 + RL-8, and the sediment design `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md`.

Summon them, they handle the work. Stand them down when it's done. **No skipped steps. No half-finished hand-offs.** No new AI CLI to learn — it sits on top of Claude Code, Codex, or Copilot you already run.

**Every gate has a hard exit.** Audit fails = stop. QA fails = stop. Any gate fails = full stop. You don't chase it, you don't patch it. You decide, it runs the next gate.

#### Gates aren't decoration — 5,439 tests passed · 19 skipped · 0 failed

Every line of code goes through our own gates. The test suite — 5,420 cases — actually blocks. Gates aren't written for users to admire; they're written for us to obey.

#### One person built this, an engineer's taste:

- **Geek ethos.**
- **Natural language only — no CLI surface for the user.**
- **Tests and gates that actually block, not decorate.**
- **Strict with self, lenient with users — our own code goes through our own gates; users say whatever they want, the system catches it.**
- **AI fluency floor is flat — no prompt-engineering chops, no CLI muscle memory; you talk like a person.**

Those project-level red lines live in `~/.peaks/memory/`. They aren't slogans. They are red lines the toolchain enforces.

## What's in the box

First tactician on the roster: `peaks-code`. The lead.

It runs the long chain — PRD, RD, QA, UI, SC, TXT — and it's the role you'll talk to most.

What it does:
- Long-task development (end-to-end requirement → PRD → implementation → QA), gate by gate, stops where it breaks
- Fix a bug and ship the same day — fix goes through review + tests, not just out the door
- Take on, break down, or hand off a long-running requirement — from fuzzy ask to landed code

One sentence from you, and a long task is done. No second terminal needed.
Coverage, audit, hard-stop — it treats every gate the same: under the bar = not delivered, off the rail = re-run.

It's the entry the moment you install, and the dispatcher for every role that grows in later.
Audit, QA gate, review sign-off — on by default. You only speak to turn one off.

More loop-engineering roles coming.

## Sediment your own loop engineering

When a flow has run twice, it can stay. One sentence and it's grounded into your box.

What you sediment is loop-engineering — a tactical play, not just a skill spell.
Next time you say "run that", the whole playbook slots back in.

It lands in a pool on your machine, scoped to you alone.
Name it, reuse it, iterate it — your call.
A flow that ran clean twice gets promoted.
A flow that broke gets sent back to you to redefine.
When a decision touches your assets, you decide.

The point isn't how many bees the tool ships.
The point is your few bees keep growing with your taste — you say one line, they grow one notch.

## Get it running

```bash
npm i -g peaks-loop
```

One sentence after install, and the squad is on the job.

## One more thing

This repo used to be [`peaks-cli`](https://github.com/SquabbyZ/peaks-cli). It's called `peaks-loop` now.

Inside the box, the skills evolved from `peaks-code` (single-role) to `peaks-code` (gate-bearing, code-domain) — both still here, both with their own lane: `peaks-code` is the older single-task flow entry, and `peaks-code` runs the end-to-end main path.

The job didn't change: you say it, the engineering gates get laid out — fail where it fails, you decide.

Install this one repo and every new requirement after has a roster waiting for your call.

---

MIT License · Made by [SquabbyZ](https://github.com/SquabbyZ)

- All skills → [`skills/`](./skills/)
- Design docs → [`docs/`](./docs/)
- Changelog → [`CHANGELOG.md`](./CHANGELOG.md)
- Questions → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)