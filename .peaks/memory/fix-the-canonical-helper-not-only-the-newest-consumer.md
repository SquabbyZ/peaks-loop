---
name: fix-the-canonical-helper-not-only-the-newest-consumer
description: fix-the-canonical-helper-not-only-the-newest-consumer
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-sessid.md
---

The reviewer producer had already grown its own `/`/`\` check; the canonical `getSessionDir` had not.
This slice fixed the canonical helper, and the producer's local check remains as defense in depth.

**Why:** a defect in a shared helper surfaces again in every new consumer. Fixing only the consumer
that reported it leaves the next caller exposed.

**How to apply:** when a new consumer adds a guard the shared helper's doc claims to provide, fix the
helper and leave the consumer's check in place; add the test at the helper.
