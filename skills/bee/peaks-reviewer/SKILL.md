---
name: peaks-reviewer
description: Third-party independent code-review skill for Peaks. Use as a parallel reviewer to karpathy-reviewer when a workflow needs an out-of-band (non-RD-model) review pass to mitigate single-LLM self-dogfood blind spots. Emits a schema-validated ReviewerEnvelope (no free-form LLM JSON). v2.14.0 G4.
---

## Single-scope-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by a **single scope axis** (session-id, at `.peaks/_runtime/<sessionId>/...`) with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<sessionId>` placeholders (NEVER bare `<sid>`). The peaks-loop change-id axis was removed in slice `2026-06-29-change-id-root-removal`; reviewable artifacts now live under `.peaks/_runtime/<sessionId>/<role>/...` only. OpenSpec's independent `openspec/changes/<change-id>/` vocabulary (L4) is preserved untouched. CLI mapping: session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Regression test `tests/unit/skills/skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) every `.peaks/_runtime/<X>/` has an axis label, (c) this callout is present.

## peaks-context auto-build (v3.0)

The peaks-reviewer workflow automatically runs `peaks context build --audience peaks-reviewer` before the LLM is invoked. No manual setup needed.

# Peaks-Loop Third-Party Reviewer (v2.14.0 G4)

`peaks-reviewer` is a **parallel** reviewer to `karpathy-reviewer`. It is intentionally **not** a replacement: karpathy-reviewer keeps enforcing the 4 guidelines; peaks-reviewer adds an out-of-band perspective from a different model family to mitigate single-LLM self-dogfood blind spots.

## Why a separate reviewer (R6 from the PRD)

In v2.13.x, two real cases slipped through 49/49 unit-test-pass + tsc-clean + single-LLM dogfood:
- v2.13.1: aggregateVerdict cross-source dedup BLOCKER
- v2.13.2: parseSecurity/Perf v2.12.0 markdown envelope parse failure

`peaks-reviewer` does NOT promise to eliminate such cases (A4.5 prohibits the claim). It is a structural mitigation that adds a second opinion with a guaranteed-distinct model family.

## Hard contract — modelFamily distinctness (BLOCKING)

The peaks-reviewer modelFamily MUST differ from the karpathy-reviewer modelFamily. Configuration enforces this:
- `~/.peaks/config.json` `reviewer.providers[]` lists at least 2 distinct providers
- `reviewer.requireDistinctModelFamily: true` (default)
- The CLI/agent stamps `modelFamily` from the actual `modelId` we called — the LLM cannot self-report a different family

If the distinctness check fails, the CI gate fails. See `references/reviewer-schema.md` for the envelope shape and `references/reviewer-prompt.md` for the prompt the provider receives.

## CLI surface

```
peaks reviewer run --rid <rid> [--json]
peaks reviewer status [--json]
```

`run` produces `rd/third-party-review.json` (and a human-readable `rd/third-party-review.md`) under `.peaks/_runtime/<sessionId>/`. `status` shows whether the reviewer is configured and which selection mode is active.

## Configuration (`~/.peaks/config.json`)

```jsonc
{
  "reviewer": {
    "providers": [
      { "name": "ollama",    "model": "llama3.2:8b", "endpoint": "http://localhost:11434" },
      { "name": "anthropic", "model": "claude-haiku-4-5" },
      { "name": "openai",    "model": "gpt-4o-mini" }
    ],
    "selection": "round-robin",
    "rdProviderName": null,
    "requireDistinctModelFamily": true,
    "fallbackOnError": "skip",
    "schemaPath": "schemas/reviewer-envelope.schema.json"
  }
}
```

Missing section: reviewer is skipped (transition still passes; envelope records `skipped: no-reviewer-config`). Per A4.1, the CLI flag `--reviewer-model` is REMOVED — users edit the config file.

## Hard prohibitions

- DO NOT modify karpathy-reviewer (NG4). peaks-reviewer is a parallel addition.
- DO NOT introduce new heavy dependencies (no langchain / openai-sdk). Use `fetch` + manual schema validation.
- DO NOT silently prompt users for API keys. Missing env vars surface as `providerUnavailable` and the `fallbackOnError` policy decides skip vs throw.
- DO NOT change the schema for the 5 existing envelope parsers (v2.13.3 territory). The ReviewerEnvelope schema is additive.

## Sub-agent dispatch (when launched by peaks-code swarm)

When this skill runs as a sub-agent dispatched by peaks-code, the sub-agent receives the parent session id and change-id via envelope. It MUST write its output to `.peaks/_runtime/<sessionId>/rd/third-party-review.json` + `.md` and return a compact JSON envelope.
