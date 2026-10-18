---
name: a-refusal-needs-a-machine-shape-not-only-prose
description: a-refusal-needs-a-machine-shape-not-only-prose
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-prereq.md
---

`PrerequisitesNotSatisfiedError` already said "N unmet requirement(s)" and the CLI already said
`Satisfy <path>: <description>`, but `data.missing` still listed a PRESENT file under a field named
`missing` and a code named `PREREQUISITES_MISSING`. A consumer had to parse prose to tell "you have
not written it" from "you wrote it and it does not satisfy the contract". §10.3 closed by adding
`kind: 'absent' | 'body'` to each entry and splitting the message counts.

**Why:** a human-readable sentence can be correct while the machine-readable envelope is wrong; the
next LLM or gate reads the envelope.

**How to apply:** when a refusal can mean two different things, put the discriminator in the data,
not only in the sentence. Keep the old fields and the public code for compatibility; add the kind.
