---
name: a-mocked-external-cli-is-not-evidence-of-its-contract
description: a mocked external CLI is not evidence of its contract
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-a545d0/txt/handoff.md
---

`src/services/lint/ocr-multilang-adapter.ts` passed `--filter-language` to `ocr review` and parsed `payload.findings[]` with `{file, line, rule, severity, message}`. Neither exists: the flag is unknown to the real binary in 1.8.9 and 1.13.1 alike, and the envelope is `{status, summary, tool_calls, comments: [{path, content, start_line, end_line, severity, category}]}`. The adapter had never worked — it returned `execution-failed` on the flag and would have returned zero findings even if the flag had been accepted.

The suite was green throughout, because the tests mocked `spawnSync` and fed the adapter the same made-up payload the adapter was written against. A mock asserts agreement between the code and the author's belief, not between the code and the tool.

The check that finds this class costs one command: run the pinned binary's `--help` and a real invocation with a control. `ocr review --filter-language python --preview` → `Error: unknown flag: --filter-language` answers it in a second, and the upstream struct definitions (`jsonOutput`, `LlmComment`) settle the payload shape. Do this before believing any adapter that shells out to a third-party CLI, and pin the real shape in a test that feeds a verbatim sample.

Related: [[a-dependency-whose-backend-was-replaced-must-be-checked-for-ability-not-for-the-label]], [[a-test-that-cannot-fail-is-worse-than-no-test]].
