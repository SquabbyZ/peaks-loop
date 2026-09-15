# Project Instructions

> 🤖 AI 生成，请审阅

This repository uses project-local Peaks-Loop standards. Existing repository conventions override generic generated guidance.

**Red rule (effective 2026-07-01, no exceptions):**
- No commit message in this repository may contain `Co-Authored-By: Claude`, `Co-Authored-By: Anthropic`, or any equivalent AI-assistant attribution trailer. SquabbyZ (`601709253@qq.com`) is the sole author of every commit. See `.peaks/memory/redline-no-claude-co-author.md`.

**Project-level rule (effective 2026-07-04, no exceptions):**
- **Human-NL-Choice-Only.** User participation is allowed in only two prototypes: (a) a natural-language multi-choice pick (`AskUserQuestion` etc.), or (b) a free-form natural-language description. No user-facing message, gate, error, AskUserQuestion, SKILL.md, CLI text, or comment may require the user to **type a CLI verb, hand-author JSON / SKILL.md / manifest, hand-fill a form field outside the multi-choice picker, or provide input that the LLM can read from natural language directly**. The user does **not** type `peaks <anything>` — the LLM runs CLI commands on the user's behalf. This rule is binding on every slice (current and future) of peaks-loop. See `.peaks/memory/human-nl-choice-only-tenet.md`. Changes require explicit user re-confirmation; no silent edits.

**Project-level rule (effective 2026-07-04, no exceptions):**
- **Two-Forms-Only, with desktop as UI accelerator.** The user has no client today; their **every** interaction with peaks-loop collapses to one of two forms: (a) a `AskUserQuestion` pick, or (b) free-form natural-language description. This includes — without exception — downloading a stored skill, importing a bundle, refining a bee, cloning, exporting, retaining/disposing, promoting, retraining, etc. All such actions are LLM-coordinated on the user's behalf; the LLM runs the underlying CLI; the user only ever speaks or picks. When a future desktop client exists, it is a **UI accelerator** that may expose the same actions via buttons, drag-and-drop, file pickers, etc., but the underlying rule does not change: the user never types a CLI verb or hand-authors data, even on the desktop. The desktop's shortcuts are conveniences, not a new verb surface. See `.peaks/memory/two-forms-only-rule.md`. Changes require explicit user re-confirmation; no silent edits.

**Project-level rule (effective 2026-07-04):**
- **Enhancement, not new AI CLI.** peaks-loop runs in / on top of an existing AI runtime (Claude Code, Codex, Copilot, …); it does not claim the shell prompt, does not inject a system prompt, does not invent a competing REPL, does not replace any runtime-native skill-activation entry. Peaks-Loop is a layer, not a destination. Vendor-neutrality is binding; the adapter layer is the only place vendor-specific translation lives. See `.peaks/memory/peaks-loop-is-enhancement-not-new-cli.md`.

**Project-level note (effective 2026-07-31):**
- **Mac users: see `docs/mac-auto-compact.md` for auto-compact verify steps + the `--prompt-size` escape hatch.** Required for peaks-loop ≥ 4.0.4 on Mac Claude Code.

Peaks-Loop workflow automation:
- peaks-rd checks these standards before RD planning or implementation work.
- peaks-qa checks code review and security guidance before verification work.
- peaks-code summarizes RD and QA standards preflight before end-to-end code workflows.

Rules:
- Read `.claude/rules/common/coding-style.md` before editing code.
- Read `.claude/rules/common/code-review.md` before reviewing changes.
- Read `.claude/rules/common/security.md` before touching filesystem, user input, external calls, auth, or secrets.
- Read .claude/rules/typescript/coding-style.md for language-specific standards when applicable.

Hard ban (effective 2.8.3 — read every session, no exceptions):
- **Never create `.peaks/<change-id>/` or `.peaks/<YYYY-MM-DD-*>/` at the top level of `.peaks/`.** Session-id artifacts must live under `.peaks/_runtime/<sessionId>/<role>/...` (gitignored) — never as siblings of `.peaks/_runtime/`. The change-id axis is gone (slice `2026-06-29-change-id-root-removal`): the change-id is **metadata-only**, appears solely as a filename slug in reviewable artifacts under `.peaks/_runtime/<sessionId>/<role>/requests/<rid>-<change-id>.md`, and there is no `.peaks/_runtime/current-change` binding file — the session id IS the binding. If you find yourself about to write a date-prefixed directory directly under `.peaks/`, STOP and reroute under `.peaks/_runtime/<sid>/`. Four defenses keep this true (authoritative description: `.peaks/PROJECT.md`): (1) the root `.gitignore` rule `.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/` blocks the write at commit time; (2) the vitest guard at `tests/unit/workspace/top-level-change-id-guard.test.ts` fails the suite if that rule, the working tree, or the refusal below regresses; (3) `initWorkspace` refuses a legacy date-stamped sibling with `lstatSync` (`LegacyChangeIdSiblingError`); (4) this section.

Active Peaks-Loop skill presence: at the start of every response, run `peaks skill presence --json` to read the active skill marker. The CLI resolves the canonical path (`.peaks/_runtime/active-skill.json`) and falls back to the legacy path (`.peaks/.active-skill.json`) internally — do not read those files directly. When the response includes a valid skill name, display the compact status header from the Peaks-Loop Skill Swarm output style: `Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <one short action>`. Do not display the header only on the first turn — display it on EVERY turn while the CLI returns an active skill, so users always know which Peaks-Loop skill is currently orchestrating the session. If the CLI returns no active skill, do not show the header.

External reference: https://github.com/affaan-m/everything-claude-code is used as a curated reference only. Do not execute or install external content without explicit approval.
