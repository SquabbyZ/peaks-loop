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
  <img src="./assets/readme/hero.svg" alt="peaks-loop 4.0.3 — Loop Engineering, Engineered" width="92%"/>
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

## Status · shipping 4.0.17

<p align="center">
  <img src="./assets/readme/pulse.svg" alt="peaks-loop live metrics — 4 tiles + sparkline + pipeline progress" width="92%"/>
</p>

<p align="center">
  <img src="./assets/readme/trace-stream.svg" alt="peaks-loop live diff & log stream — code diff + scrolling log + 7-gate chain" width="92%"/>
</p>

| | |
| --- | --- |
| **Latest** | [![npm](https://img.shields.io/npm/v/peaks-loop?style=for-the-badge&logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/peaks-loop) — 4.0.17 (2026-08-07) |
| **Domains** | Code (`peaks-code`) · Content (`peaks-content`) · Project health (`peaks-doctor`) · Issue sweep (`peaks-issue-fix-orchestrator`) · Custom SOP (`peaks-sop`) · Cross-domain primitives (`peaks-solo` dispatcher · `peaks-resume` · `peaks-status` · `peaks-test` · `peaks-slice-decompose`) |
| **Sediment pool** | `~/.peaks/` local pool · twice-clean runs auto-promote to a bee · broken runs come back for you to redefine · the bee grows with your taste |
| **Test suite** | 285+ cases · 4 packages (peaks-loop / peaks-loop-mut / peaks-loop-shared-channel / peaks-loop-shared) · **0 timeouts** · 14 BDD caller-binding edge cases |
| **IDE adapters** | ✅ Claude Code · ✅ Z Code · 🚧 Codex / Cursor / Trae / Tongyi Lingma / Hermes / OpenClaw / Qoder (adapters in progress — contributions welcome) |
| **Runtime** | Node ≥ 20 |
| **License** | MIT |

### What 4.0.17 actually shipped (2026-08-07)

| Epic | Solved | Verified by |
| --- | --- | --- |
| **Vitest worker cap (root-cause fix)** | 17 timeouts blocked the full suite; the root cause was `pool: 'forks' + fileParallelism: true` with no `maxWorkers` cap. On a 16-core box, ~15 fork workers + 2 files spawning real `node` processes = 8.8× oversubscription. `testTimeout` measures wall clock, so descheduled tests burned 30s doing nothing. Fix: `maxWorkers = floor(cpus/2)` + `PEAKS_VITEST_MAX_WORKERS` env override + 6-case drift-guard test. **17 timeouts → 0, wall 383.67s → 360.40s, 3/3 AC-1 runs all 0 timeouts.** | commit `ace1a03d` + guard test `tests/unit/vitest-concurrency-guard.test.ts` |
| **PRD-002b ESLint strictification (`no-magic-numbers`)** | Slice 2 dropped 917 → 192 violations (−725). 20 source files extracted 140+ inline magic numbers into named `const`s. `no-magic-numbers` config got `ignore: [-1, 0, 1, 2, 100, 1000]` + `ignoreArrayIndexes / ignoreDefaultValues`. 7 BDD tests, 31/31 lint tests PASS. Severity stayed `warn` (D5 no-touch-stockcode). | commits `d5ef17c1` + `0c3187c4` + 7 BDD tests |
| **Statusline `--now` injection + 24-spawn amortization** | Slice 1 root cause: the test wrote `updatedAt = new Date().toISOString()` (just-NOW) and expected the lifecycle to be "within 10s window", but under full-suite concurrency the spawned subprocess is descheduled and only executes several seconds later — the completed-expiry window ages out → C1 baseline fallback → `expected '' to contain '[████████]'`. Fix: add `--now <ms>` CLI option; test pins `TEST_NOW_MS` shared by both CLI and lifecycle. **Slice 7** went further: replaced 24 real `node dist/cli/index.js` spawns with a single `beforeAll` IPC server (JSON over stdio). Wall 216s → 29s (7.5× speedup), 24/24 PASS. | commit `3d6e4bc9` (slice 1 inside) + `44c42424` (slice 7) |
| **Complexity refactor (slice 3 A+B+C+D + slice 4 bundle-reader rewrite)** | Slice 3 four-stage refactor dropped 357 → 330 complexity violations (target ≤90, this wave covers the high cohort): spec-service parser → table-dispatch, slice-decompose → FSM, project-context `detectComponentLibrary` → 11-dispatch table. **Slice 4** = bundle-reader full rewrite, 5 violations → 1, public API preserved verbatim. | commits `72ef798c` + `31160051` + `1ac6e56d` + `923be824` + `0603754d` + `6b27eb94` |
| **Type-narrowing + max-lines pilot (slice 5+6)** | Slice 5 closed 670 violations: 667 phantom `no-explicit-any` config swap (broken ruleId fix, same pattern as the no-duplicate-imports 4.0.16 fix) + 3 real narrowings (`catch (error: any)` → `unknown` + `instanceof Error`). Slice 6 split 4 over-length functions in `dispatch-record-writer.ts`, 4 → 0 in target file. Both slices prove the rules are essentially exhausted — true count is an order of magnitude smaller than the sediment claimed. | commits `fbb43e9e` + `3d6e4bc9` (inside) |
| **Mac auto-compact ESM anti-fake-green: 5/5 verified** | Slice 8 audit-only: 5 defenses (`readClaudeTranscriptFallback` / `readClaudeStatuslinePercent` / `presence-marker-detector` / `post-compact-detector` / `step-08-gate`) all in place, ESM `require()` 0 hits, legacy silent-catch blocks already explicit re-throw `ReferenceError` / `SyntaxError`. | sediment `.peaks/memory/2026-08-07-mac-esm-defense-audit.md` |
| **Caller-binding coverage extension (slice 9)** | 14 BDD tests covering 5 gap categories: multi-tenant isolation / post-rotation recovery / TTL freshness / rotation hygiene / primary-wins contract. `tests/unit/session/*` grew from 51 → 65 tests. | commit `823be8c4` + new file `tests/unit/session/caller-binding-slice-9-edge-cases.test.ts` |
| **Pre-publish gates all green** | `gate-cli-version` ALIGNED (root 4.0.17 == shared CLI_VERSION 4.0.17), `build-integrity: OK`, 0 `Co-Authored-By` trailers. | per `peaks-loop-publishing-critical-hard-rules` recipe |

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

## For developers · 24h mode and batch tooling

> **For peaks-loop project maintainers and "24h mode" users** — end-users, skip this section and head straight to FAQ.

If your workflow reaches **24h mode** (`peaks session 24h-mode` → `24H_ACTIVE`), **batch closure passes**, or anything that needs to spawn many `peaks request transition` (or similar) calls from a parent LLM context, **install Python 3.10+ first**:

```bash
# macOS / Linux
brew install python@3.12   # or: pyenv install 3.12

# Windows
winget install Python.Python.3.12
```

**Why not Node.js?peaks-loop itself is Node/pnpm, isn't it?** — peaks-loop's *own* hard dep stays Node.js, **unchanged**. The reason Python wins for *batch-utility scripting* is the `subprocess` layer: Python's `subprocess.run(capture_output=True, env=...)` is significantly less painful than Node's `child_process.spawn` on Windows + UTF-8 + cross-platform (one line of `LANG` / `LC_ALL` / `PYTHONIOENCODING` env in the child fixes it; Node's `child_process` needs separate `windowsHide` + `console.log` encoding tricks). And the code is shorter.

**Rules** (sedimented at `.peaks/memory/2026-08-01-24h-mode-59-rid-closure-pass.md`):

1. **Detect-then-pick**: probe `python3 --version` (or `py -3` on Windows) first; use Python if available; else fall back to `node`; else surface the missing-runtime error — do not silently degrade.
2. **Path**: place the script at **`.peaks/_tools/<name>.py`** (or `.mjs`). Do **not** place under `bin/` — that directory is reserved for peaks-loop's own source-shipped scripts and pollution from temporary helpers is a maintenance hazard. The `_`-prefixed `.peaks/_tools/` mirrors `.peaks/_runtime/`, `.peaks/_sub_agents/`, `.peaks/_dogfood/` and is gitignored.
3. **Delete when the work is done.** Temporary scripts are not deliverables; leaving them around invites the "what is this?" question.

This section is **not for ordinary end-users** — `npm i -g peaks-loop` + a slash command is all you need. Python is for the layer of people who want to write their own batch utilities.

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

<p align="center">
  <img src="./assets/readme/skill-index.svg" alt="peaks-loop 13 user skills — full index with category badges" width="92%"/>
</p>

---

## Ship summary (4.x · 19 rids)

`009 · 010 · 011 · 014 · 015 · 016 · 017 · 020b · 024 · 025 · 026 · 027 · 028 · 029 · 030 · 031 · 032 · 033 · 034` — CLI surface collapse (73 → 5 byte-identical), Trusted Publishing + OIDC, 24h-mode, context spillover, DAG wave + barrier, dashboard aggregation, test-rebuild epic, karpathy-cost self-review, compact visibility, retire-auto-compact-hook, and more.

<p align="center">
  <img src="./assets/readme/ship-summary.svg" alt="peaks-loop 4.x 19-rid ship timeline with category chips" width="92%"/>
</p>

---

## Downstream consumer notes

If you maintain a project that depends on `peaks-loop` (or that runs `npm install peaks-loop` as part of CI / contributor onboarding), three behaviors are worth pinning in your head:

- **`codegraph` is a transitive dependency.** `peaks-loop` pins `@colbymchenry/codegraph@0.7.10` in its `dependencies`, so `npm install` / `pnpm install` will pull it automatically. The CLI command group `peaks codegraph …` (status / init / index / query / files / context / affected) is shipped inside `dist/services/codegraph/`. No extra install step required.
- **`.codegraph/` directory ownership is shared.** Tools like aider, cody, and similar agents also create a top-level `.codegraph/`. `peaks codegraph init` will refuse to overwrite a foreign schema and exits with code 73 + a `CODEGRAPH_INIT_CONFLICT` envelope. If your project already has a `.codegraph/` from another tool, move / rename it (or remove it if you no longer need it) before running `peaks codegraph init`.
- **Session binding lives under `.peaks/_runtime/<sessionId>/`.** Codegraph orchestration context (and other per-session evidence) is written there by RD / QA slices. Add `.peaks/_runtime/` to your project's `.gitignore` to avoid committing local session state. A missing / unbound session produces a graceful skip-with-warning, never a crash.
- **Doctor fallback for yarn-pnp / pnpm-strict.** `peaks doctor` falls back to a filesystem walk when `require.resolve('@colbymchenry/codegraph/package.json')` throws, so downstream installs under strict resolution modes still get a green check (or a `severity: 'warning'` if the version drifted from the pinned `0.7.10`).
- **Tarball size / verify.** Each release ships the codegraph service under `dist/services/codegraph/`. Per-release verification lives at `scripts/verify-codegraph-tarball.mjs` (run `node scripts/verify-codegraph-tarball.mjs` locally before tagging a release). Exit 0 means the whitelist is intact; exit 1 means the tarball is missing the codegraph service files.

Install snippet (typical consumer):

```bash
# Add peaks-loop to your project
npm install peaks-loop

# Bootstrap codegraph for the first time (refuses if .codegraph/ already
# exists with a non-peaks-loop schema; exit code 73 + envelope)
npx peaks codegraph init --project .

# Verify the doctor is green for downstream resolution modes
npx peaks doctor --project .
```

Three common pitfalls:

1. **`peaks codegraph init` exits 73** — your project has a pre-existing `.codegraph/` from another tool. Move it out of the way (or remove it), then re-run.
2. **`peaks doctor` warns about codegraph version drift** — your lockfile resolved a different `@colbymchenry/codegraph` version than the pinned `0.7.10`. Pin to `0.7.10` in your lockfile; the warning does not flip the doctor exit code.
3. **Session-bound artifacts under `.peaks/_runtime/` are noisy in `git status`** — add the path to your project's `.gitignore`. The `peaks-loop` repo already does this; consumers should mirror the rule.

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