---
schemaVersion: 1
artifactKind: perf-audit
rid: 2026-06-27-verdict-aggregator
sid: 2026-06-27-session-83acf5
handoffHash: deadbeef
templateVersion: 1
generatedAt: 2026-06-27T22:00:00.000Z
verdict: pass
violationsCount: 0
---
## Summary
Test perf envelope for dogfood.

## Baseline
N/A

## Measurement result
OK

## Threshold check
OK

## Findings
- none

## Verdict
verdict: pass
CRITICAL: 0


## Embedded JSON

```json
{
  "verdict": "warn",
  "violations": [
    {
      "dimension": "embed",
      "severity": "HIGH",
      "file": "embed.ts",
      "line": 1,
      "hint": "embedded json"
    }
  ],
  "summary": "embedded json inside markdown"
}
```
