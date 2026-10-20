---
name: a-count-cannot-distinguish-zero-findings-from-never-ran
description: a count cannot distinguish zero findings from never ran
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-a545d0/txt/handoff-002.md
---

The OCR bridge originally returned `{state, findings, summary}`. Once it could report "this language produced no findings", "this file's format is not reviewed", "the review was skipped for this range" and "OCR could not run", that shape collapsed four different facts into one zero. A summary carrying only counts cannot express a skip or an outage, and a reader will read whichever they expect.

The repair separates the axes: `state` (`ok` / `no-routed-language` / `ocr18-missing` / `execution-failed`), `detected` (languages actually present), `languages[]` (per-language findings), and `unsupportedFiles[]` (formats the tool does not review). The test that keeps this honest is not four names — it is an explicit **inequality assertion**: the clean-but-empty result and the unavailable result must not be equal. Naming four shapes is not the same as making them distinguishable.

The same rule applies wherever an absence can be mistaken for a pass: an audit that did not run, a reviewer that was skipped, a gate that was bypassed. Print the absence as its own outcome, and say in words that nothing was checked.

Related: [[a-feature-can-be-fully-tested-and-still-be-unreachable-from-production]], [[it-reddens-and-it-misses-nothing-are-two-different-claims-and-only-the-first-gets-tested]].
