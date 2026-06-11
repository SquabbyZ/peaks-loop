---
name: jsdoc-breaks-on-glob-literals-in-tsc
description: JSDoc breaks on `**` glob literals in tsc
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-06-11-session-f0312d/txt/handoff.md
---

JSDoc comments (within `/** ... */`) that contain markdown glob patterns like `**/*.md` or `**/*.foo` are mis-parsed by tsc as bold/italic. Use prose descriptions ("every markdown file under X (recursive)") instead of literal globs in JSDoc. Hit 3 times in L2.1 (scanner file headers).
