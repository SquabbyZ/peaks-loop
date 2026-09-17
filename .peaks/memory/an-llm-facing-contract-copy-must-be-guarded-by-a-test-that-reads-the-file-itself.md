---
name: an-llm-facing-contract-copy-must-be-guarded-by-a-test-that-reads-the-file-itself
description: An LLM-facing contract copy must be guarded by a test that reads the file itself
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-16-session-5bcf09/txt/handoff.md
---

`PROJECT_MEMORY_KINDS` has 21 values; the sentence telling LLMs which `kind` values are legal advertised 7 — and the same stale sentence had been copy-pasted into 7 live files plus a CLI literal. The existing guard pinned the canonical tuple against the tier map and the parser, i.e. the CODE's internal consistency, and never read `skills/**`. So the LLM-facing copy was unguarded, and prose in a SKILL.md has no way to fail a build when it drifts. **How to apply:** when a contract is stated in prose that an LLM reads, the guard must READ THAT FILE and assert it against the canonical source. Extend the existing guard's reach rather than adding a parallel scanner, and include an anti-vacuity pin — in this case a mutation that blinded the scanner left the main assertion green and was caught only by the pin that asserts the scanner can still see a known file.
