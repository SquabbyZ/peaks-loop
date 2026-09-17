---
name: a-guard-that-reddens-for-a-defensible-reason-gets-trained-away
description: A guard that reddens for a defensible reason gets trained away
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-e-group.md
---

The same guard deliberately does **not** assert `dist/**` has a match. The reason is not laziness: a
bare `vitest run` on a fresh checkout has no `dist/`, so such an assertion fails for everyone who
hasn't run `npm run build` — CI builds first, a developer does not. A red that a reasonable person
learns to ignore is worse than no check, because it spends the suite's credibility.

Two related choices follow the same principle. The glob entries are judged by their **literal prefix
directory** rather than "file exists", because a `**` path is not a file and asserting file-ness would
be permanently false. And "at least one match" is deliberately **not** asserted for globs either:
`skills/**` always matches while `schemas/*.json` may legitimately be empty, and nothing separates
them — a match-count assertion would have to lie about one of them.

**How to apply:** before adding an assertion, ask who it fires for and whether that person can act on
it. An assertion that fires on a legitimate, common, unactionable state teaches the reader that red
does not mean broken. Prefer asserting the property that actually decides the question, and say in a
comment which states you chose not to catch and why.
