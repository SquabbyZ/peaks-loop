# peaks-reviewer prompt (v2.14.0 G4)

The reviewer prompt is built deterministically from the slice context. The provider receives exactly one JSON object as response — no prose, no markdown, no free-form LLM JSON.

## Prompt structure

```
# peaks-reviewer prompt (v2.14.0 G4)

rid: <rid>
contextSha256: <sha256-prefix>

## Slice context (truncated to 8KB)
<context, capped at 8192 bytes>

## Required output (ReviewerEnvelope JSON)

Respond with EXACTLY one JSON object matching this schema (no prose):
{
  "reviewerId": "third-party-reviewer-v2.14.0",
  "modelId": "<your modelId>",
  "modelFamily": "<e.g. claude / gpt-4o / llama>",
  "passed": <bool>,
  "violations": [{"kind": "<kind>", "file": "<path>", "line": <int>, "hint": "<str>"}],
  "gateAction": "block" | "allow" | "warn",
  "reason": "<one-sentence rationale>"
}

Forbidden: prose, markdown, multiple objects, free-form JSON. Schema-validated only.
```

## What peaks-reviewer does NOT do

- Does NOT replace karpathy-reviewer.
- Does NOT mutate karpathy-reviewer.md.
- Does NOT introduce new dependencies (no langchain, no openai-sdk).
- Does NOT silently prompt the user for API keys.
- Does NOT claim "no more fake green" (A4.5).

## Failure modes

| Failure                          | fallbackOnError=skip | fallbackOnError=error |
| -------------------------------- | -------------------- | --------------------- |
| Missing `reviewer.providers`     | skip (envelope: `no-reviewer-config`) | throw + transition blocked |
| Missing API key env var          | warn envelope        | throw + transition blocked |
| Provider returns non-JSON        | warn envelope        | throw + transition blocked |
| JSON does not validate schema    | warn envelope        | throw + transition blocked |
| Same modelFamily as karpathy     | CI gate fail (AC-4.4) | CI gate fail |

The CLI never silently prompts for API keys; missing env vars surface as `providerUnavailable` and the fallbackOnError policy decides whether to skip or throw.
