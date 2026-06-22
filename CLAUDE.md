# Project Instructions

> 🤖 AI 生成，请审阅

This repository uses project-local Peaks-Cli standards. Existing repository conventions override generic generated guidance.

Peaks-Cli workflow automation:
- peaks-rd checks these standards before RD planning or implementation work.
- peaks-qa checks code review and security guidance before verification work.
- peaks-solo summarizes RD and QA standards preflight before end-to-end code workflows.

Rules:
- Read `.claude/rules/common/coding-style.md` before editing code.
- Read `.claude/rules/common/code-review.md` before reviewing changes.
- Read `.claude/rules/common/security.md` before touching filesystem, user input, external calls, auth, or secrets.
- Read .claude/rules/typescript/coding-style.md for language-specific standards when applicable.

Hard ban (effective 2.8.3 — read every session, no exceptions):
- **Never create `.peaks/<change-id>/` or `.peaks/<YYYY-MM-DD-*>/` at the top level of `.peaks/`.** The 2.8.0+ two-axis convention requires ALL change-id / session-id artifacts to live under `.peaks/_runtime/<sessionId>/<role>/...` (gitignored) — never as siblings of `.peaks/_runtime/`. The `peaks workspace init --change-id <id>` flow must route into `.peaks/_runtime/<sid>/`, not the root. If you find yourself about to write a date-prefixed directory directly under `.peaks/`, STOP and reroute under `.peaks/_runtime/<sid>/`. The `.gitignore` rule `.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/` will block the write at commit time; the vitest guard at `tests/unit/workspace/top-level-change-id-guard.test.ts` will fail the suite if a regression sneaks through.

Active Peaks-Cli skill presence: at the start of every response, run `peaks skill presence --json` to read the active skill marker. The CLI resolves the canonical path (`.peaks/_runtime/active-skill.json`) and falls back to the legacy path (`.peaks/.active-skill.json`) internally — do not read those files directly. When the response includes a valid skill name, display the compact status header from the Peaks-Cli Skill Swarm output style: `Peaks-Cli Skill: <skill> | Peaks-Cli Gate: <gate> | Next: <one short action>`. Do not display the header only on the first turn — display it on EVERY turn while the CLI returns an active skill, so users always know which Peaks-Cli skill is currently orchestrating the session. If the CLI returns no active skill, do not show the header.

External reference: https://github.com/affaan-m/everything-claude-code is used as a curated reference only. Do not execute or install external content without explicit approval.
