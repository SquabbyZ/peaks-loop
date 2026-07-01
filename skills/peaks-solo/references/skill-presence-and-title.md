# Step 2 + 2.5 — Skill presence and session title

> Combined body for `### Peaks-Loop Step 2: Re-set skill presence with the chosen mode` and `### Peaks-Loop Step 2.5: Set session title`.

## Step 2 — Re-set skill presence

Step 0 already set presence with no mode. Now that the mode is known (user selected or explicitly named), re-run presence:set so the header/status line shows the profile:

```bash
peaks skill presence:set peaks-solo --project <repo> --mode <mode-value> --gate startup
```

On the first presence:set in a project, ensure the out-of-band status bar is installed so the user can see at a glance that Peaks is orchestrating — it renders the active skill in Claude Code's terminal status line, independent of model output:

```bash
peaks statusline install --project <repo>   # idempotent; skips if already installed
```

Then display the compact status header: `Peaks-Loop Skill: peaks-solo | Peaks-Loop Gate: startup | Next: <one short action>`. Display this header on EVERY turn while the skill is active.

Update with `peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate <gate>` when gates change. The presence file persists across the full workflow lifecycle — do NOT clear it at workflow end.

## Step 2.5 — Set session title

Extract a short (8-20 Chinese characters, or 4-10 English words) descriptive title from the user's first request. The title should capture the core task — e.g. "修复登录页OAuth回调异常", "添加暗色模式开关", "搭建项目基础架构". Then run:

```bash
peaks session title $(peaks session info --active --project "$(git rev-parse --show-toplevel)" --json | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['sessionId'])") "<title>"
```

If the session directory already has a title (check via `peaks session list --json`), skip this step — the title is already set.