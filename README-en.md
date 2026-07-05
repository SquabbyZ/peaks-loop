# ⛰️ Peaks Loop

**English** | [简体中文](./README.md)

[![npm](https://img.shields.io/npm/v/peaks-loop?style=flat-square&logo=npm)](https://www.npmjs.com/package/peaks-loop)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![stars](https://img.shields.io/github/stars/SquabbyZ/peaks-loop?style=flat-square&logo=github)](https://github.com/SquabbyZ/peaks-loop/stargazers)

Give your AI coding assistant a set of engineering gates + orchestration so it works like a senior engineer, not a guesser.

## What it is

peaks-loop is a pack of workflow skills that drops into Claude Code / Codex / Copilot / any AI CLI. It splits your 24-hour engineering flow (requirements → implementation → audit → testing → release) into 11 LLM role skills, so the AI follows your gates strictly — no shortcuts, no skips, no guessing.

## One-line install

```bash
npx peaks-loop install
```

Open your AI CLI and say **"use peaks to run this"**. Done.

Want to see it first? [`examples/video-demo/`](./examples/video-demo/) renders a 30-second walkthrough using React + [Remotion](https://www.remotion.dev/) — login flow / bug fix / refactor + the 11-skill wall.

```bash
cd examples/video-demo && pnpm install && npx remotion render peaks-code-demo out/peaks-code-demo.mp4
```

## One example

You say: **"I want to add user login"**

peaks-loop runs by itself:

1. **peaks-code** takes over → reads your project → produces PRD
2. **peaks-prd** writes the product requirement (readable back to you for sign-off)
3. **peaks-rd** produces the implementation + runs 4 independent audits (code / security / perf / QA)
4. **peaks-qa** runs tests + regression
5. **peaks-ui** produces interface prototypes (if UI is involved)
6. **peaks-sc** writes commits + PR descriptions
7. **peaks-txt** sediments context for future reuse

Any gate failing = automatic stop. **You only talk and decide.**

## What you can ask it

| You say | It does |
|---|---|
| "use peaks to run this requirement" | full end-to-end flow |
| "where are we" | session status |
| "continue the unfinished work" | resume from checkpoint |
| "sediment what we learned today" | write to project memory |

## How is it different

- **It actually runs**: not prompt templates, but real code with unit tests and audit gates
- **IDE-agnostic**: same `peaks` CLI across Claude Code / Codex / Copilot
- **Reusable**: flows you've run once are remembered next time — no re-guessing

## Want to go deeper

- All skills → [`skills/`](./skills/)
- Command reference → run `peaks --help`
- Design specs → [`docs/superpowers/specs/`](./docs/superpowers/specs/)
- Protocol & whitepapers → [`docs/`](./docs/)
- Changelog → [`CHANGELOG.md`](./CHANGELOG.md)
- Questions / feedback → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)

---

MIT License · Made by [SquabbyZ](https://github.com/SquabbyZ)