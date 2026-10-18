---
name: validate-before-the-expensive-read
description: validate-before-the-expensive-read
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-fromdag.md
---

The role check runs before the DAG file is opened. An invalid role plus a nonexistent `--from-dag`
path now reports `INVALID_ROLE`, not `INVALID_DAG` or ENOENT.

**Why:** the order is observable. Reading the file first would make a caller with two errors fix the
wrong one, and a bad role could start expensive work before being refused.

**How to apply:** order validations cheapest-first and before any file/network work; add a test that
pairs an invalid input with a missing dependency and asserts the input error wins.
