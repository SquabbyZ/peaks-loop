---
name: a-gate-that-reads-the-wrong-identifier-blames-a-sibling-slice
description: A gate that looks up a table with a different identifier blames a sibling slice
metadata:
  type: rule
  sourceArtifact: .peaks/docs/backlog.md#23
---

The RD transition gate's **anti-lie fallback** refused a legitimate `chore` slice with
`TYPE_CORROBORATION_VIOLATION`, naming **three `src/**` files that belonged to two sibling
slices**. The cause was an **identifier mismatch**, not a missing claim: the gate looked the claim
table up with the numbered rid (`002-2026-10-28-22-3-...`), but the table's keys are the
un-numbered rids (`2026-10-28-22-3-...`), because `requestIdFromFileName` strips the filename
prefix. The lookup missed, `own` came back undefined, and the gate fell back to judging **the
whole working tree** against the declared type.

The same session found the same shape in `peaks prd check-blocks`: the CLI's own help says
`<request-id>`, but `findPrdArtifact` omits the session layout from its candidates and drops the
`.md` suffix in its fallback glob — so the **documented spelling** finds nothing and the checker
reports all four mandatory blocks missing for a body that exists and is complete.

**Why:** both defects read as "the slice did not do its paperwork" and both were **the machinery
reading the wrong key**. A gate that falls back to the broadest scope when its narrow lookup
misses converts an internal mismatch into a public accusation, and it lands on **whichever slice
declares the most restrictive type** — the slice least able to carry `src/**` in the first place.
A fallback that is stricter than the scoped check is only safe if the scoped check can never miss.

**How to apply:** when a gate refuses, check **what identifier it used** before concluding the
claim is missing. Reproduce with the narrowest possible input: the same transition with the
un-numbered rid passed (exit 0) where the numbered one refused. And when a lookup can miss, make
the miss **loud and specific** — "this rid was not in the table" is a different failure from
"this rid's paths are not allowed here", and only the second is an accusation. A checker that
cannot find the artifact must not report the artifact as absent.

Related: [[an-audit-claim-can-be-falsified-by-the-qa-after-it]],
[[a-claim-written-in-three-places-and-pinned-by-no-test-will-drift]]
