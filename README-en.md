<div align="center">

# ⛰️ Peaks

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=22&duration=3000&pause=800&color=6366F1&center=true&vCenter=true&multiline=true&width=720&height=110&lines=peaks-cli%3A%20cross-AI-IDE%20engineering%20gates%20%26%20orchestration;11%20%E2%9A%99%EF%B8%8F%20workflow%20skills%20%2B%20%E2%9A%96%EF%B8%8F%20executable%20gates;%E2%9C%89%EF%B8%8F%20%E2%9A%96%EF%B8%8F%20%E2%9C%89%EF%B8%8F%20%E2%9A%91%EF%B8%8F%20%E2%9A%96%EF%B8%8F%20%E2%9C%89%EF%B8%8F%20%E2%9A%91%EF%B8%8F%20gates%20%2B%20audit%20%2B%20cross-IDE%20adaptation" alt="peaks-cli tagline typing animation" />

**English** | [简体中文](./README.md)

<table>
<tr>
<td align="center" width="180"><b>🔥 PROJECT</b></td>
<td align="center" width="180"><b>⚡ BASED ON</b></td>
<td align="center" width="180"><b>📚 SKILLS.SH</b></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/SquabbyZ/peaks-cli">peaks-cli / Homepage</a></td>
<td align="center">13 Skills + Cross-IDE</td>
<td align="center"><a href="https://skills.sh/SquabbyZ/peaks-cli">Listed on skills.sh</a></td>
</tr>
<tr><td colspan="3">&nbsp;</td></tr>
<tr>
<td align="center" width="180"><b>⭐ STARS</b></td>
<td align="center" width="180"><b>📦 VERSION</b></td>
<td align="center" width="180"><b>📄 LICENSE</b></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/SquabbyZ/peaks-cli/stargazers"><img src="https://img.shields.io/github/stars/SquabbyZ/peaks-cli?style=for-the-badge&logo=github&logoColor=white" alt="stars" /></a></td>
<td align="center"><a href="https://www.npmjs.com/package/peaks-cli"><img src="https://img.shields.io/npm/v/peaks-cli?style=for-the-badge&logo=npm&logoColor=white&color=CB3837" alt="npm version" /></a></td>
<td align="center"><a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="license" /></a></td>
</tr>
<tr><td colspan="3">&nbsp;</td></tr>
<tr>
<td align="center" width="180"><b>🧪 TESTS</b></td>
<td align="center" width="180"><b>🔧 LANG</b></td>
<td align="center" width="180"><b>📥 DOWNLOADS</b></td>
</tr>
<tr>
<td align="center"><b>2,800+</b></td>
<td align="center"><b>TypeScript</b></td>
<td align="center"><a href="https://www.npmjs.com/package/peaks-cli"><img src="https://img.shields.io/npm/dm/peaks-cli?style=for-the-badge&logo=npm&logoColor=white&color=CB3837" alt="downloads" /></a></td>
</tr>
<tr><td colspan="3">&nbsp;</td></tr>
<tr>
<td align="center" width="180"><b>🌐 中文</b></td>
<td align="center" width="180"><b>🚀 QUICK START</b></td>
<td align="center" width="180"><b>👁️ VISITORS</b></td>
</tr>
<tr>
<td align="center"><a href="./README.md">简体中文</a></td>
<td align="center"><a href="#-30-seconds-to-running">30s to running →</a></td>
<td align="center"><img src="https://komarev.com/ghpvc/?username=SquabbyZ&repo=peaks-cli&label=views&color=blue&style=for-the-badge" alt="visitors" /></td>
</tr>
</table>

<img src="https://github-readme-streak-stats.herokuapp.com?user=SquabbyZ&repo=peaks-cli&theme=radical&hide_border=true&date_format=j%20M%5B%20Y%5D" alt="GitHub Streak Stats" />

[Install](#-30-seconds-to-running) · [5-min onboarding](#-5-minute-onboarding) · [Skill family](#-11-skills-in-the-family) · [Killer feature: un-bypassable gates](#-killer-feature-un-bypassable-gates)

</div>

---

## 🤔 Why Peaks

> Do you put `git push --force`, `rm -rf`, `npm publish`, `DROP TABLE` into your `CLAUDE.md`?
> The LLM won't really listen. It has a 99% chance of "respecting your preference" — then forgetting it in the next session.
> **CI can only block at merge time; prose rules rely on goodwill; only gates can stop the agent mid-swing.**

Peaks models the "engineering team" inside your AI IDE as 13 workflow skills + a set of **executable gates**:

- 🧭 **Skills** — `peaks-solo` orchestrates; `peaks-prd / rd / qa / ui / sc / txt / sop` each own a phase; the LLM picks the right role for the task
- 🚧 **Gates** — SOP attaches checkable conditions (file-exists / grep / command exit code) to each phase; unmet gates block `git push` **in front of the agent itself** — even under `--dangerously-skip-permissions`
- 🧠 **Project memory** — `.peaks/memory/` captures decisions, gotchas, conventions into git; next session picks up where you left off
- 🌐 **Cross-IDE** — one CLI, native-skill rendering for Claude Code / Trae / Cursor / Codex / Qoder
- 📦 **Discoverable** — the 13 skills are also published to [skills.sh](https://skills.sh); `npx skills add` to install on demand

## 🚀 30 seconds to running

```bash
# 1. Install the CLI
npm install -g peaks-cli

# 2. Open Claude Code in your project
cd /path/to/your-project && claude

# 3. Tell the AI what to do
> peaks-solo add OAuth callback to the login page
```

That's it. First run bootstraps the `.peaks/` workspace, scans the project archetype, and dispatches the task to the right skills (PRD → RD → UI → QA → SC → TXT). All intermediate artifacts stay on disk. **In daily use, 1 skill (`peaks-solo`) covers ≥ 90% of needs.** As of v2.13.1, 5 heterogeneous signals (security-audit / perf-audit / karpathy / mut / qa) converge into a single verdict via `block > return-to-rd > warn > pass` precedence; the repair loop prints a `re-run reason: { source, signal, file, line, hint }` payload for every re-dispatch.

## ⏱️ 5-minute onboarding

In an adapted AI IDE conversation, just ask the AI to use a skill by name:

```text
peaks-solo add OAuth callback to the login page    # end-to-end orchestrator (the common case)
peaks-prd  define goals, non-goals, acceptance for the invitation feature
peaks-rd   analyze the smallest refactor slice and risks
peaks-qa   design tests and regression checks for this change
peaks-ui   design the login page interaction and visual approach
peaks-sc   record change impact, artifact retention, commit boundaries
peaks-txt  generate a context capsule with key decisions
peaks-sop  turn my "publish a post" flow into a gated SOP
```

**Two ways to use Peaks**:

1. **Let `peaks-solo` orchestrate** (the common case) — tell it what to do and it coordinates the PRD → RD → UI → QA → SC → TXT chain
2. **Invoke a single role skill directly** (advanced) — when you only want one phase of the workflow

Quick status check? Ask the AI to run:

```bash
peaks -V                       # version
peaks doctor --json            # environment / skills / config one-shot check
peaks project dashboard --project . --json   # one-shot project view
```

## 🧰 13 skills in the family

| Skill | What you use it for | Typical scenario |
|------|--------------------|------------------|
| `peaks-solo` | **End-to-end orchestrator** — coordinates prd/rd/ui/qa/sc/txt | Full-cycle dev, PRD-to-ship, batched cross-slice iterations |
| `peaks-prd` | Fuzzy intent → **verifiable PRD** (goals / non-goals / preserved behavior / acceptance) | Requirements, PRD authoring, refactor goal definition |
| `peaks-rd` | Engineering analysis + slice planning + risk + execution contracts | Architecture analysis, minimum slices, risk review |
| `peaks-qa` | Test design + coverage + regression matrix + acceptance evidence | Test cases, regression, browser E2E |
| `peaks-ui` | Visual direction + interaction design + design-system constraints | Page design, interaction, prototypes, UI regression |
| `peaks-sc` | Change control + commit boundaries + retention + rollback evidence | Impact records, change control, audit |
| `peaks-txt` | Context capsules + decision records + knowledge compression | Module understanding, decision capture, retros |
| `peaks-sop` | **Turn any workflow into a gated SOP** (not just dev) | Content publishing, compliance checklists, data pipelines, ops runbooks |
| `peaks-solo-resume` | Continue the unfinished slice | "resume the unfinished slice" |
| `peaks-solo-status` | One-shot snapshot of where you are | "where are we now" |
| `peaks-solo-test` | Run the project test suite (auto-detects vitest / jest / pytest / ...) | "run the tests" |
| `peaks-security-audit` | **Independent security audit** (OWASP Top-10 + 8-dim threat model) | Slices introducing authn/authz, secrets, input validation, SQL injection, external API surface |
| `peaks-perf-audit` | **Independent perf audit** (6-dim perf impact) | Hot loops, I/O throughput, concurrency model, bundle size, cold-start changes |

**3 solo wrappers + 7 role skills + 2 standalone audits + 1 orchestrator = 13 skills.** In daily use, 1 skill (`peaks-solo`) covers ≥ 90% of needs.

> **v2.13.0**: zero-human-intervention **auto-compact** (`peaks solo context-now` + `peaks solo auto-compact`) — peaks-cli probes context-fill % autonomously. ≥85% writes a pre-compact checkpoint + convergence plan + dispatches IDE compact. ≥95% forces a synchronous RED-LINE compact. The LLM-runner stays alive with context < 95% without human intervention.

## 🚧 Killer feature: un-bypassable gates

> CI only blocks at **merge time**; `CLAUDE.md` rules rely on agent **goodwill**. **SOPs do what neither can: stop an irreversible action mid-conversation, against the agent itself.**

```jsonc
// sop.json
"guards": [ { "phase": "publish", "bash": "git +push" } ]
```

```bash
peaks hooks install --project <repo>   # explicit opt-in: writes one PreToolUse entry
```

After that, when the agent tries `git push` while a publish gate is failing, Claude Code receives `permissionDecision: "deny"` — the command is blocked **before any permission check, even under `--dangerously-skip-permissions`**. Three gate types:

| Type | Meaning | Example |
|------|---------|---------|
| `file-exists` | File exists → pass | `CHANGELOG.md` exists |
| `grep` (+ `absent`) | Regex matches in file → pass; `absent: true` inverts ("must not contain X") | "post body has no `TODO`" |
| `command` | Run a command, judge by exit code (refused by default; needs `--allow-commands`) | run `npm test` |

Definitions (`sop.json` + `SKILL.md`) can live in the **global** layer `~/.peaks/sops/` (your personal cross-project SOPs) or the **project** layer `<repo>/.peaks/sops/` (committed into the repo, team-shared — wins over global). **Emergency bypass**: `peaks gate bypass --sop <id> --phase <phase> --reason "<why>"` (one-shot, capped per project per SOP, reason audited).

## 🌍 Real-world scenarios

**Scenario 1: ad-hoc refactor decision**

```text
> peaks-rd analyze src/auth/ current state and give me the smallest-slice plan
```
`peaks-rd` outputs: 3-phase slices, risk assessment, regression points, executable contracts. **Whether to actually code is your call.**

**Scenario 2: turn "blog publishing" into a controlled flow**

```text
> peaks-sop turn "blog publishing" into a gated SOP: draft → self-check (no TODO / ≥ 800 words) → human review → publish
```
`peaks-sop` generates `sop.json` + `SKILL.md`, registers globally, **the agent cannot publish if any step is skipped**.

**Scenario 3: browser E2E regression**

```text
> peaks-qa run a browser over the full register → login → dashboard flow and list the blockers
```
`peaks-qa` outputs: test matrix, regression checklist, `code-review.md`-style evidence document.

**Scenario 4: resume the slice from yesterday**

```text
> peaks-solo-resume
```
Detects the in-flight slice's deepest-completed gate, saves 3-5k tokens vs re-reading artifacts. **Sessions break, context survives.**

## 📦 Discover peaks on skills.sh

The 11 `peaks-*` skills auto-index on the [skills.sh](https://skills.sh) registry — **no separate registration needed**. Indexing is driven by the config in this repo:

- 13 `skills/<name>/SKILL.md` files (each with `name` + `description` YAML frontmatter) — the standard skills.sh discovery convention
- `.claude-plugin/marketplace.json` — explicit manifest listing the 13 public skills (internal `peaks-doctor` / `peaks-ide` are hidden via `metadata.internal: true`)

Any environment with `npx skills` installed (Claude Code, Cursor, Codex, ...) can pull them directly:

```bash
# Install all 13:
npx skills add SquabbyZ/peaks-cli

# Or just one:
npx skills add SquabbyZ/peaks-cli --skill peaks-solo
npx skills add SquabbyZ/peaks-cli --skill peaks-rd
npx skills add SquabbyZ/peaks-cli --skill peaks-sop
```

Browse [skills.sh/SquabbyZ/peaks-cli](https://skills.sh/SquabbyZ/peaks-cli) for the full catalog. The skills shipped here and the skills shipped via `npm install -g peaks-cli` are the same artifact — both paths deliver the same content.

## 🛠️ How it works: skills first, CLI as gates

The `peaks <cmd>` CLI is **not your daily driver**. It exists for three machine-level reasons only:

1. **Explicit opt-in for irreversible side effects** (`peaks sop init --apply`, `peaks openspec archive --apply`) — actions that must not happen on the LLM's discretion
2. **Structured JSON contracts** (`peaks request show ... --json`, `peaks scan archetype ... --json`) — let a skill read a machine verdict to gate its next decision
3. **Invokable from hooks / CI / scripts** (`peaks hooks install`, `peaks gate enforce`) — turn "satisfy these gates before X" from prose into enforcement

One line: **SKILL = the workflow's brain; CLI = the workflow's joints**.

### CLI commands you'll *see* skills call

```bash
peaks workspace init / reconcile / scan archetype / scan libraries
peaks request init / show / transition          # PRD/RD/QA/SC state machine
peaks session list / info / title / rotate
peaks sop init / lint / check / advance / register
peaks code-review detect-ocr / config-template / run-ocr   # Alibaba Open Code Review second opinion
peaks hooks install / gate enforce / gate bypass
peaks project dashboard / memories
```

Full list: `peaks --help`.

## 🌐 Supported IDEs

| IDE | Status |
|---|---|
| ✅ **Claude Code** | 13 skills + PreToolUse hook, agent team dogfooded |
| ⚠️ **Trae** | slim `IdeAdapter` registered, real-Trae dogfood is a follow-up slice |
| 📋 **Codex / Cursor / Qoder / Tongyi Lingma, and more** | On the roadmap |

## 🏗️ Project status

- ✅ **13 skills** + cross-IDE CLI + 2,800+ tests (v2.12.0 adds `peaks-security-audit` + `peaks-perf-audit`)
- ✅ **Gate mechanism** dogfooded on real projects
- ✅ **v2.12.0 RD fan-out collapse** (3-way: code-reviewer + qa-test-cases-writer + karpathy-reviewer) shipped 2026-06-27
- ✅ **v2.13.0 zero-human-intervention auto-compact** (peaks-cli drives context compression on any AI CLI; context stays < 95% autonomously) shipped 2026-06-27
- 📋 Roadmap: real Trae / Codex / Cursor integration, `peaks-doc` / `peaks-i18n`, SOP template marketplace

See [`CHANGELOG.md`](./CHANGELOG.md) and [`docs/`](./docs/) for details.

## 📄 License

[MIT](LICENSE) — commercial use, modification, private forks all welcome; keep the copyright notice.

## 💬 Join the WeChat community

Got usage questions, feature requests, or want to chat with the team and other peaks-cli users? Scan to join the **Peaks-Cli** WeChat group:

<div align="center">
  <img src="./docs/images/wechat-group-qr.png" alt="Peaks-Cli WeChat group QR code" width="240" />
</div>

> When the QR code expires, feel free to open a GitHub Issue / Discussion instead.

---

<div align="center">

**Find it useful?**

⭐ [Star peaks-cli on GitHub](https://github.com/SquabbyZ/peaks-cli) · 🔍 [Browse on skills.sh](https://skills.sh/SquabbyZ/peaks-cli)

</div>
