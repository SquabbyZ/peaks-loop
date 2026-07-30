<div align="center">

# peaks-loop

### You talk. It runs the entire engineering chain for you — beyond just code, twice-run flows sediment into local tactics.

[![npm](https://img.shields.io/npm/v/peaks-loop?style=for-the-badge&logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/peaks-loop)
[![publish](https://img.shields.io/github/actions/workflow/status/SquabbyZ/peaks-loop/publish.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=publish)](https://github.com/SquabbyZ/peaks-loop/actions/workflows/publish.yml)
[![ci](https://img.shields.io/github/actions/workflow/status/SquabbyZ/peaks-loop/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=ci)](https://github.com/SquabbyZ/peaks-loop/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://www.npmjs.com/package/peaks-loop)
[![tests](https://img.shields.io/badge/tests-285%2B%20cases%20%C3%97%204%20pkgs-22c55e?style=for-the-badge&logo=vitest&logoColor=white)](#status)
[![stars](https://img.shields.io/github/stars/SquabbyZ/peaks-loop?style=for-the-badge&logo=github&github=github&logoColor=white)](https://github.com/SquabbyZ/peaks-loop/stargazers)

**English** · [简体中文](./README.md)

</div>

<p align="center">
  <img src="./assets/readme/hero.svg" alt="peaks-loop 4.0.1 — Loop Engineering, Engineered" width="92%"/>
</p>

---

## What it is

peaks-loop is a **Loop Engineering crystallization system**, not a workflow tool — what sediments from the runs you do is **not** a procedure, it's a set of **Loop Engineering** method assets that are karpathy-engineered at the rule level and darwin-verified at the change level.

| Asset layer | Role | One-liner |
| --- | --- | --- |
| **Loop Engineering Asset** | Method system, first-class | Answers "why this loop exists, when it fires, what counts as success, how it improves" |
| **Bee Asset** | Executable body, first-class | The runnable body of a Loop Engineering Asset — every bee in the swarm |
| **Workflow Trace** | Evidence, **NOT** the durable product | Immutable per-run record; feeds crystallization + evaluation, not the user-facing asset |
| **Evolution Evaluation** | Anti-drift gate, mandatory | Every improvement needs an independent-context scorer + a regression skeptic; keep only if it passes, otherwise revert |

- **Engineering principles = karpathy-style · Verify every improvement = darwin-style** — both are required, not optional. Drop karpathy and your principles are never written down; drop darwin and your changes are never verified. They are co-equal layers, not sequential steps.
- `/peaks-code` is the **code-domain** long-task Loop Engineering orchestrator, not a general orchestrator; non-code lanes (`peaks-content` / `peaks-doctor` / `peaks-issue-fix-orchestrator` / `peaks-sop`) ship as independent `peaks-*` bees, **not** as subclasses of `peaks-code`.
- Twice-clean runs sediment into your local tactic pool (bee); broken runs come back for you to redefine. Your few bees grow with your taste.

<p align="center">
  <img src="./assets/readme/architecture.svg" alt="peaks-loop four asset layers, seven gates, one engineering spine" width="92%"/>
</p>

---

## Up and running in 30 seconds

```bash
npm i -g peaks-loop
```

Then, in the **Claude Code** or **Z Code** chat you already use, send an **explicit slash command** (the leading slash is what triggers peaks-loop — a plain sentence won't always route here):

```
/peaks-code walk me through this codebase
```

The rest is peaks-loop's job — it picks the domain from the slash, routes to the right orchestrator, splits the work gate by gate, **stops where it breaks**, never hands you a half-finished slice.

Other slash commands you'll reach for:

```
/peaks-content                 draft and publish today's post
/peaks-doctor                  run a health check on this repo
/peaks-issue-fix-orchestrator  fix the next 30 open issues upstream
/peaks-sop                     author the team's release SOP
/peaks-solo                    I'll do this again — sediment it as a local tactic
/peaks-solo                    run it like last time
```

<sub>📦 Adapters for other AI coding tools are coming — contributions welcome → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues).</sub>

No CLI to memorize. No manifest to hand-author. No second terminal to open. **Send the slash, the rest is on it.**

---

## What it does for you

Code, content, project health, issue sweeps, custom workflows — **4.x ships five first-class domains**, each with its own orchestrator. Same discipline on every lane: "gate fails = stop, run the next gate".

<p align="center">
  <img src="./assets/readme/command-palette.svg" alt="peaks-loop 13 slash commands — command palette" width="92%"/>
</p>

| Domain | Send this slash command | It will… |
| --- | --- | --- |
| 💻 **Code (code-domain) only** | `/peaks-code build this feature` | PRD → RD → code → QA → UI → slice, ready for your sign-off |
| 💻 **Code (code-domain) only** | `/peaks-code fix this bug` | reproduce → patch → review → tests, ship same day |
| 📝 **Content** | `/peaks-content draft and publish this post` | draft → edit → tone check → publish → archive, no skipped steps |
| 🩺 **Project health** | `/peaks-doctor run a health check on this repo` | red-line audit + L3 doctor + convert to OpenSpec, stops where it breaks |
| 🐛 **Issue sweep** | `/peaks-issue-fix-orchestrator fix the next 30 open issues upstream` | survey → classify → reference PRs → fix + commit + PR draft |
| 📋 **Custom workflow** | `/peaks-sop author the team's release SOP` | describe in plain language → auto-generate + validate + register |
| 🔁 **Replay** | `/peaks-solo run it like last time` | pull up your sedimented tactic, replay it |
| 🆕 **Onboard** | `/peaks-code this is a new repo, walk me through it` | map structure, flag risks, hand you a learning order |
| 🧠 **Sediment** | `/peaks-solo I'll do this again — save it` | ground it locally as a reusable tactic |
| 🧪 **Open the audit gate** | `/peaks-audit` | 6-dim audit, mandatory entry before RD / QA |
| ✅ **4-dim sign-off** | `/peaks-final-review` | functional / problem / no-new-bugs / no-regression |
| 🔌 **IDE adapter** | `/peaks-ide` | hooks + statusline + handle |
| ⏯ **Resume from a checkpoint** | `/peaks-resume` | scan the deepest finished gate, AskUserQuestion |
| 🔬 **Slice decomposition** | `/peaks-slice-decompose` | multi-pass + cross-pass edges + arbitration |

Every lane opens with **one slash command**.

---

## Why people pick it

- **Natural language is the interface.** No CLI to learn, no commands to memorize. **Use an explicit slash command (e.g. `/peaks-code xxx`)** to route to the right orchestrator; everything after the slash is plain language. The LLM runs the commands on your behalf.
- **Gates that actually block, not decorate.** 285+ test cases across 4 packages, all green by default; QA gate, review sign-off — all on. **Audit fails = stop. QA fails = stop.**
- **Run-once flows become local tactics (bees).** Sedimented loop engineering lands in your local `~/.peaks/` pool — twice-clean runs auto-promote to standing tactics, broken runs come back for you to redefine. **Next time, just say "run that one" and the whole playbook slots back in.** Your few tactics grow with your taste.
- **Sits on top of what you already run.** Not a new AI CLI to learn — it rides on **Claude Code** and **Z Code**. No shell grab, no prompt grab, no IDE grab. Other tools: adapters in progress, contributions welcome.
- **You decide, it executes.** Decisions that touch your assets are yours; everything else it runs on its own. **Zero learning cost. One minute to first task.**

---

## What gates ship by default

| Gate | Default | What it catches |
| --- | --- | --- |
| Unit + integration tests | ✅ on | regressions at the code level |
| Code audit (lint / prose / type) | ✅ on | drift in style and intent |
| Security scan | ✅ on | secrets, SSRF, injection, dangerous IO |
| QA review | ✅ on | task-level gate — fails loud, stops clean |
| Review sign-off | ✅ on | nothing ships without eyes on it |
| Anti-drift evaluation (Evolution Evaluation) | ✅ on | every improvement needs an independent scorer + a regression skeptic, otherwise revert |

**All gates on by default. You only speak to turn one off.**

---

## Status · shipping 4.0.1 GA

<p align="center">
  <img src="./assets/readme/pulse.svg" alt="peaks-loop live metrics — 4 tiles + sparkline + pipeline progress" width="92%"/>
</p>

<p align="center">
  <img src="./assets/readme/trace-stream.svg" alt="peaks-loop live diff & log stream — code diff + scrolling log + 7-gate chain" width="92%"/>
</p>

| | |
| --- | --- |
| **Latest** | [`4.0.1`](https://github.com/SquabbyZ/peaks-loop/releases) — GA (2026-07-30) |
| **Domains** | Code (`peaks-code`) · Content (`peaks-content`) · Project health (`peaks-doctor`) · Issue sweep (`peaks-issue-fix-orchestrator`) · Custom SOP (`peaks-sop`) · Cross-domain primitives (`peaks-solo` dispatcher · `peaks-resume` · `peaks-status` · `peaks-test` · `peaks-slice-decompose`) |
| **Sediment pool** | `~/.peaks/` local pool · twice-clean runs auto-promote to a bee · broken runs come back for you to redefine · the bee grows with your taste |
| **Test suite** | 285+ cases · 4 packages (peaks-loop / peaks-loop-mut / peaks-loop-shared-channel / peaks-loop-shared) · ~80s full run |
| **IDE adapters** | ✅ Claude Code · ✅ Z Code · 🚧 Codex / Cursor / Trae / Tongyi Lingma / Hermes / OpenClaw / Qoder (adapters in progress — contributions welcome) |
| **Runtime** | Node ≥ 20 |
| **License** | MIT |

### What 4.0.1 GA actually shipped (2026-07-30)

| Epic | Solved | Verified by |
| --- | --- | --- |
| **Test suite rebuilt from scratch** | Old 559-file unit suite took 3+ hours; the 11-file / 161-case rebuild runs in ~80s, and combined with sub-package tests and later slices the workspace-wide total is 285+ cases across 4 packages. Deleted old assertions, wrote against the production contract, 4-dim split (render/behavior/integration/a11y). | commits `f17aa377` → `1d6233bc` · `.peaks/memory/2026-07-30-test-rebuild-epic-sediment.md` |
| **Karpathy evaluation cost self-review** | LLM no longer "done for today, will continue tomorrow" after 1–2 slices — `karpathy-reviewer` reports `costRatio`; `peaks job karpathy-cost-check` auto-downgrades `block` → `warn` above 10. 24h-mode stays the override. | `peaks job karpathy-cost-check --review-file <path>` · 21-case unit test |
| **Compact visibility** | `peaks compact history` for the LLM to read every compact event of the current session; `peaks statusline compact` for the IDE statusline (`--` / `compact pending (0.85)` / `REDLINE 0.95` / `just compacted (0.92→?)`). | `auto-compact-orchestrator` appends to `compact-history.jsonl` · 19-case unit test |
| **Sub-package coverage + workspace-wide `pnpm test:full`** | Independent 4-dim tests for `peaks-loop-mut` / `peaks-loop-shared-channel`; `peaks-loop-shared` 0 file (`passWithNoTests`); redundant root mirror removed. | commits `593ffcdf` → `08e92d8f` · `pnpm test:full` runs all 4 packages in one go |
| **CLI surface collapsed (73 → 5 super-commands)** | Five super-commands (`peaks code / audit / doctor / openspec / release / release-pack`) replace 73 leaf commands, byte-identical contract preserved, opaque to downstream callers. | rid-009 · 26 routing tests |

---

## Strongly recommended · compose these four

> **Zero learning cost.** That's the biggest reason to use them together — not just that the effect is excellent, but that **all four projects speak the same interface: natural language + a choice.** You say one sentence; the LLM runs the commands, applies the gates, and follows the playbook.

<p align="center">
  <img src="./assets/readme/footer.svg" alt="peaks-loop recommended stack" width="92%"/>
</p>

| Role | Project | One-liner |
| --- | --- | --- |
| **Sediment + gates** | [**peaks-loop**](https://github.com/SquabbyZ/peaks-loop) ← you are here | loop-engineering crystallization system; install → PRD/RD/QA/UI/SC/TXT as one chain + sediment |
| **Tactical handbook** | [affaan-m/ECC](https://github.com/affaan-m/ECC) | everything-claude-code: the best tactics, skills, and SOPs you can put on top of Claude Code |
| **Code understanding** | [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) | any repo, one sentence to grok it — let the LLM actually *understand* the project, not guess |
| **Process & discipline** | [obra/superpowers](https://github.com/obra/superpowers) | brainstorming / TDD / debugging / code-review as flow disciplines, every one with a hard exit |

**One sentence to use them all**: clone the three repos above, install peaks-loop, hand the rest to your LLM — it pulls what it needs, holds the gates, lands the tactics, sediments the flow.

### Tribute

peaks-loop's two engineering spines come straight from these projects:

- [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) — "engineer every rule" is etched into our method layer.
- [alchaincyf/darwin-skill](https://github.com/alchaincyf/darwin-skill) — "verify every improvement" is etched into our anti-drift gate.

---

## FAQ

<details>
<summary><b>How does it relate to Claude Code / Z Code?</b></summary>

It **sits on top of** them, not in place of. peaks-loop doesn't grab your shell, your prompt, or your IDE. It runs as a first-class adapter on Claude Code and Z Code. **Adapters for other tools are in progress — contributions welcome** → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues).

</details>

<details>
<summary><b>Do I need to learn CLI commands?</b></summary>

No. You speak or pick; the LLM runs the commands. **All CLI verbs are hidden from you, open to the LLM.**

</details>

<details>
<summary><b>Do sedimented tactics stay on my machine?</b></summary>

Yes. Sediment lands in a local pool, scoped to you alone. Naming, reuse, iteration — your call. Flows that broke get sent back for you to redefine.

</details>

<details>
<summary><b>Will it change my code without me knowing?</b></summary>

It changes, but **the gates hold**. Audit fails = nothing ships. QA fails = nothing ships. Review fails = nothing ships. It runs; each gate stops for your eyes.

</details>

<details>
<summary><b>What's new in 4.x vs 3.x?</b></summary>

**The biggest shift: from "code-only tool" to multi-domain orchestration system.** 4.x no longer just writes code — it ships four new domain orchestrators: `peaks-content` (content production), `peaks-doctor` (project health), `peaks-issue-fix-orchestrator` (batch issue fix), `peaks-sop` (custom SOPs). On top of that, `peaks-solo` auto-routes to the right domain from plain language. Plus 9 IDE adapters, crystallization-system renaming, post-run crystallization. Full list → [`CHANGELOG.md`](./CHANGELOG.md).

</details>

---

## Full skill index

13 user skills · every entry point lives in `skills/<name>/SKILL.md`:

`/peaks-code` · `/peaks-content` · `/peaks-doctor` · `/peaks-audit` · `/peaks-final-review` · `/peaks-ide` · `/peaks-issue-fix-orchestrator` · `/peaks-sop` · `/peaks-solo` · `/peaks-resume` · `/peaks-status` · `/peaks-test` · `/peaks-slice-decompose`

---

## Ship summary (4.x · 19 rids)

`009 · 010 · 011 · 014 · 015 · 016 · 017 · 020b · 024 · 025 · 026 · 027 · 028 · 029 · 030 · 031 · 032 · 033 · 034` — CLI surface collapse (73 → 5 byte-identical), Trusted Publishing + OIDC, 24h-mode, context spillover, DAG wave + barrier, dashboard aggregation, test-rebuild epic, karpathy-cost self-review, compact visibility, retire-auto-compact-hook, and more. See [`CHANGELOG.md`](./CHANGELOG.md).

---

## Links

- All skills → [`skills/`](./skills/)
- Changelog → [`CHANGELOG.md`](./CHANGELOG.md)
- Questions → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)
- Tribute: [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) · [alchaincyf/darwin-skill](https://github.com/alchaincyf/darwin-skill)
- Recommended combo: [affaan-m/ECC](https://github.com/affaan-m/ECC) · [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) · [obra/superpowers](https://github.com/obra/superpowers)

---

---

<div align="center">

MIT License · Made by [SquabbyZ](https://github.com/SquabbyZ) · English · [简体中文](./README.md)

</div>