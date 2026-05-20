---
name: peaks-txt
description: Context and knowledge skill for Peaks. Use when a workflow needs context capsules, role-specific context slices, decision records, assumptions, discarded options, staleness checks, lessons, or reusable project memory.
---

# Peaks TXT

Peaks TXT compresses workflow context into portable, role-specific artifacts.

## Responsibilities

- generate context capsules;
- slice context for PRD, RD, QA, UI, and SC consumers;
- record decisions, assumptions, discarded options, and staleness conditions;
- archive lessons from refactor slices;
- capture reusable Peaks skill usage habits and workflow lessons for future sessions.

## Refactor role

For refactors, create initial context before RD analysis and final context after validation and artifact retention.

## Compaction-safe outputs

When used alone or when a workflow needs portable artifacts that must survive session compaction, end with a short structured capsule: mode, validated decisions, artifact paths, standards deltas, open questions, and next action. Prefer links or paths over long narrative. Do not duplicate the full workflow log when a compact capsule is enough.

## GStack integration

Use gstack as a concrete context and reflection workflow reference for the `Reflect` stage:

- map `/retro` summaries to Peaks lessons, discarded options, and staleness conditions;
- map documentation-release ideas to compact downstream context for PRD, RD, QA, UI, and SC;
- keep durable memory writes behind Peaks memory extraction and user-approved persistence.

## Skill-usage learning capture

When a Peaks workflow reveals a reusable skill usage habit, orchestration preference, artifact convention, browser/login rule, or repeated failure mode, capture it through Peaks TXT before the session ends.

Default output path: `.peaks/<session-id>/txt/skill-usage-lessons.md` or the Peaks CLI-provided local artifact workspace. Keep this local by default and do not commit or sync it unless the user or active profile explicitly authorizes persistence.

Each entry should include:

- lesson or rule;
- why it exists;
- affected skills;
- how future PRD/RD/UI/QA/SC/Solo workflows should apply it;
- whether it is stable enough for `.claude/memory` extraction.

## Project memory guidance

When a skill artifact contains reusable project facts, decisions, rules, or constraints, mark only the stable extract with:

```markdown
<!-- peaks-memory:start -->
title: Short project memory title
kind: project
---
Stable memory body.
<!-- peaks-memory:end -->
```

The primary write target is the target project's `.claude/memory`. Use `peaks memory extract --project <path> --artifact <artifact> --apply` only after the user or active profile allows durable project memory writes.

## External capability guidance

Use `peaks capabilities --json` before recommending memory or context-management resources.

- claude-mem and context-mode can inform reusable context workflows only when durable memory is explicitly approved.
- Never store secrets, credentials, private customer data, or non-exportable business data in memory artifacts.
- Prefer Peaks TXT context capsules when external persistence is unavailable or not authorized.

## Boundaries

Do not choose the refactor plan or install runtime resources. Use artifacts produced by other skills and CLI reports.

Reference: `references/context-capsule.md`.
