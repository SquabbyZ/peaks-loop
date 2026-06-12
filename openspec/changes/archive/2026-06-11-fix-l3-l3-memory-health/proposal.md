# Doctor Finding: L3:l3-memory-health

**Date**: 2026-06-11
**Change ID**: 2026-06-11-fix-l3-l3-memory-health
**Source**: `peaks doctor` finding (CRITICAL severity: fail)

## Why

A `peaks doctor` scan flagged the following issue at `L3:l3-memory-health`:

> .peaks/memory/index.json missing schema_version field

The current behavior is broken or degraded. This proposal outlines a fix.

## What Changes

- Address the doctor finding at `L3:l3-memory-health`.
- See the Why section above for the original error message.
- Acceptance criteria below describe the success conditions.

## Acceptance Criteria

- `peaks doctor --json` returns `ok: true` for the `L3:l3-memory-health` check.
- Re-running the audit does not regress other findings.

## Out of Scope

- Other doctor findings (each is tracked in its own OpenSpec change).
- Refactors that don't fix this specific issue.

## Risks

- Low: this is a doctor-flagged issue with a clear acceptance criterion.

## Status

- created: 2026-06-11
- last update: 2026-06-11
- state: draft
- state reason: auto-generated from peaks doctor; LLM must review + edit before validate
