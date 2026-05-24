# Project Instructions

> 🤖 AI 生成，请审阅

This repository uses project-local Peaks standards. Existing repository conventions override generic generated guidance.

Peaks workflow automation:
- peaks-rd checks these standards before RD planning or implementation work.
- peaks-qa checks code review and security guidance before verification work.
- peaks-solo summarizes RD and QA standards preflight before end-to-end code workflows.

Rules:
- Read `.claude/rules/common/coding-style.md` before editing code.
- Read `.claude/rules/common/code-review.md` before reviewing changes.
- Read `.claude/rules/common/security.md` before touching filesystem, user input, external calls, auth, or secrets.
- Read .claude/rules/typescript/coding-style.md for language-specific standards when applicable.

Active Peaks skill presence: at the start of every response, read `.peaks/.active-skill.json` if it exists. When it contains a valid skill name, display the compact status header from the Peaks Skill Swarm output style: `Peaks Skill: <skill> | Gate: <gate> | Next: <one short action>`. Do not display the header only on the first turn — display it on EVERY turn while the file exists, so users always know which Peaks skill is currently orchestrating the session. If the file is missing or invalid, do not show the header.

External reference: https://github.com/affaan-m/everything-claude-code is used as a curated reference only. Do not execute or install external content without explicit approval.
