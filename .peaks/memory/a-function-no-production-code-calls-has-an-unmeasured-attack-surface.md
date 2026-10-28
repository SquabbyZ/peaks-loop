---
name: a-function-no-production-code-calls-has-an-unmeasured-attack-surface
description: A function that no production code calls has an attack surface nobody has measured
metadata:
  type: rule
  sourceArtifact: .peaks/docs/backlog.md#23
---

Implementing backlog §22.1 gave `judgeSessionCompliance` its **first production caller** — and the
first thing that became reachable was a **path traversal**. The slice id comes from the event stream
and was substituted into the compliance spec's declared artifact paths before the filesystem was
probed; a slice id of `a/../../../outside/code-review-evil` made the reader credit a file planted
**outside** the session directory, and the compliance rate read 0.833.

The same slice (§22.10) found the same shape in the pre-push gate: a tag name is
repository-controlled, and git reads an argv element starting with `--` as an option, so
`git diff --name-only '--output=pwned.txt...HEAD'` **wrote a file**. That gate had never been
handed a tag name before, because it had never handled a tag push.

**Why:** both defects lived in code that every existing test exercised only in isolation. "No
production caller" reads as safe; it actually means **nobody has ever pushed an attacker-shaped
value through it**. The vulnerability was there the whole time and the test suite was silent
because the tests never held a hostile value. Both defects became live the moment a real caller
existed — and in the first case, the caller is what §22.1 was built to add.

**How to apply:** when a slice gives a previously-unreachable function a caller, treat the
callable as **new surface**, not as proven code. Ask what an attacker controls in the new path, and
probe it with a hostile value before shipping the caller. Two rules that held up:
- **Filter where the value becomes a thing that matters, not where it enters.** The slice-id fix
  partitions at the boundary where the id becomes a **path**, so every future caller is covered by
  one check; filtering at the input would have been one place to forget.
- **Resolve to an inert form before it reaches a tool's argv.** SHA instead of a tag name: hex
  cannot be an option. The name is the dangerous form, not the thing.

The same reasoning explains a third finding in §23: the pre-push gate's comment claimed git skips
pre-push for a tag push, so the tag case had never been exercised at all — the surface was open for
exactly as long as the feature was new. **A gate that gains a new kind of input has a new attack
surface, and the gap between "the feature shipped" and "the feature was probed" is where defects
live.**

Related: [[a-feature-can-be-fully-tested-and-still-be-unreachable-from-production]],
[[a-claim-stronger-than-the-code-is-a-defect-even-when-the-content-claim-underneath-it-holds]]
