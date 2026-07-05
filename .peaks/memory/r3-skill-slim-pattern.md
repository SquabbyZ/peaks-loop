<!-- peaks-memory:start -->
title: r3-skill-slim-pattern
kind: lesson
---
When a SKILL.md exceeds ~350 lines or ~18KB, the LLM absorbs it as a flat prefix and the Skills surface in the context-usage status bar balloons. Slim pattern: keep YAML frontmatter + non-negotiable inline sections (Two-axis callout, Code-Change Red Line, gate headings) + step TOC + per-step pointer to `references/[name].md`. Front-load a `## References` index table near the bottom (R1 discoverability). Move sub-section bodies verbatim into `references/X.md` files; byte-equivalence (after normalization: strip trailing whitespace, LF line endings) is enforced by a content-coverage test that enumerates every `##` / `###` heading from the pre-slim snapshot and asserts each appears in exactly one of: the new SKILL.md or a `references/` file (no duplicates). Slim yields ~70-75% line+byte reduction per skill. Tested on peaks-code (754→245 lines, 65.9→17.3KB, 73.7% reduction), peaks-rd (737→209, 66.7→17.7, 73.4%), peaks-qa (622→192, 48.2→14.7, 69.5%). The LLM activation cost drops ~130KB aggregated across the 3 skills; status bar reading 22.9% → projected 9-10% (target ≤12%).
<!-- peaks-memory:end -->
