---
name: trae-adapter-values-hookevent-toolmatcher-envvar-are-1-x-assumptions-not-verified
description: Trae adapter values (hookEvent, toolMatcher, envVar) are 1.x assumptions, not verified
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

The Trae adapter's `hookEvent: 'beforeToolCall'`, `toolMatcher: 'terminal'`, `envVar: 'TRAE_PROJECT_DIR'`, and `settings.dirName: '.trae'` are based on 1.x assumptions, not on real Trae documentation. The adapter is the right shape (slim, fills the slice #1 table), but the string values may need adjustment during dogfood on a Trae-installed consumer. Real Trae integration is post-slice-#2 scope.
