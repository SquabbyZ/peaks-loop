---
name: peaks-prd
description: Product and requirement skill for Peaks. Use when a workflow needs PRD, refactor goals, non-goals, behavior preservation, acceptance criteria, product change proposals, or user-confirmable product artifacts.
---

# Peaks PRD

Peaks PRD turns user intent into verifiable product artifacts.

## Responsibilities

- clarify goals and non-goals;
- define behavior that must be preserved;
- write acceptance criteria;
- create refactor goal artifacts;
- produce product-side intermediate artifacts for downstream RD and QA skills.

## Refactor role

For refactor workflows, avoid writing a full product PRD unless needed. Produce a focused refactor product package:

- refactor goal;
- non-goals;
- preserved behavior;
- acceptance criteria;
- risk notes;
- user confirmation record.

## External capability guidance

Use `peaks capabilities --source mcp-server --json` before recommending product or workflow methodology resources.

- OpenSpec can structure spec-first product and engineering artifacts.
- Superpowers can inform workflow methodology and artifact sequencing.
- gstack can inform product-stack tradeoffs, but user goals and non-goals remain authoritative.
- External methods are inspiration and governance inputs, not automatic executors.

## Boundaries

Do not implement code, run tests, install hooks, or modify runtime configuration. Use Peaks CLI reports and downstream artifacts instead.

Reference: `references/workflow.md`.
