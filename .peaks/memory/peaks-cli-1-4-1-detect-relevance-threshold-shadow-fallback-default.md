---
name: peaks-cli-1-4-1-detect-relevance-threshold-shadow-fallback-default
description: peaks-cli 1.4.1 detect relevance threshold + shadow-fallback default
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-10-session-6bcac7/txt/handoff-001-r003.md
---

peaks-cli 1.4.1 (slice R003) tightens the `peaks skill scope` whitelist in 4 ways: (1) `ProjectSignals.shareByExtension` replaces the binary `hasFileExtension` for the keyword-matching path, with a default 5% threshold (`SCOPE_THRESHOLD_DEFAULT`, overridable via `PEAKS_SCOPE_THRESHOLD` env or `--threshold` flag); (2) `--apply` defaults to `shadowFallback: true` (96.4% per-denied reduction; 69.8% overall), `--no-shadow-fallback` opt-out; (3) `peaks skill context-stats` reports runtime bytes + estimated tokens (`bytes/4` for full, `bytes*0.25` for stubs) with a NO_SCOPE branch; (4) README documents the mechanism. Key file locations: `src/services/skill-scope/types.ts` (constants), `src/services/skill-scope/detect.ts` (ScanResult + shareByExtension + threshold gate), `src/cli/commands/skill-context-stats-command.ts` (new), `src/cli/commands/skill-scope-commands.ts` (default flip at line 209). Affected skills: peaks-solo, peaks-rd. Stable for memory: yes.
