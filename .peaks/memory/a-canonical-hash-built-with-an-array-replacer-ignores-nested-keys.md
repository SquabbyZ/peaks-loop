---
name: a-canonical-hash-built-with-an-array-replacer-ignores-nested-keys
description: a canonical hash built with an array replacer ignores nested keys
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-19-session-94b084/txt/handoff-mut-producer-chain.md
---

`JSON.stringify(value, Object.keys(value).sort())` does not mean "sort the keys". The second
argument is an array replacer: it whitelists property names at EVERY level, so a nested object whose
keys are not also top-level names serializes as `{}`. An artifact digest built this way silently
ignores nested fields — measured: editing `impl.json#astGateResult` to a forged verdict without
touching `sha256` still verified.

**Why:** the hash looked canonical and passed every top-level tamper test; only a nested-field edit
exposed that the covered surface was the top level.

**How to apply:** for a canonical checksum, write a recursive serializer that sorts keys per level
(and decide explicitly whether unknown keys are stripped or refused). Verify RAW parsed JSON, before
any schema parse that might drop fields. Add a tamper test that edits a NESTED value, not only a
top-level one.
