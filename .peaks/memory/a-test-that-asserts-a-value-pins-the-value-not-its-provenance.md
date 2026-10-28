---
name: a-test-that-asserts-a-value-pins-the-value-not-its-provenance
description: Asserting the output values cannot distinguish "read it from there" from "hold a copy"
metadata:
  type: rule
  sourceArtifact: .peaks/docs/backlog.md#23
---

The §22.4 slice added a seam so the path census would read the judged-declaration tiers **from their
defining module** rather than from a copied list. The slice's test asserted the census's **output**:
```ts
expect(paths).toContain('audit/security-<rid>.md');
expect(paths).toContain('audit/security.md');
```
QA ran the mutation that replaces the import with an inline copy of the same four values. **The suite
passed (2/2)** — a mutation that had to redden it did not.

**Why:** a test that asserts a value pins **the value, not its provenance**. The requirement was not
"the census names these four tiers"; it was "the census **reads** them from there". Those are different
claims, and the test only made the first one. So the exact drift the slice existed to prevent — the census
holding a copy that goes stale when the defining module gains a fifth tier — would keep every test
**green**.

Asserting the live value from the defining module does **not** fix it either: a copy of today's values
equals today's values, so that test passes under both implementations. What closes the hole is making
the **source observable to the test**: mock the defining module with a *different* list and assert the
**default** path follows the mock. Under a copy that assertion is red; under the import it is green.

**How to apply:** when a requirement says "read X from Y" rather than "the output contains X", the test
must fail when X is right but Y is bypassed. Two techniques that work:
- **Mock the source** (`vi.mock`) with a different value and assert the default path follows it.
- **Mutate the source** to a copy, run the suite, and see it go red — then restore. A mutation arm that
  was never seen failing is not evidence.

This is the same shape as [[a-claim-stronger-than-the-code-is-a-defect-even-when-the-content-claim-underneath-it-holds]]
and [[an-injection-battery-that-swaps-the-call-site-has-never-tested-the-callee]]: a suite that exercises
the **wiring** through one path proves the path, not the wiring. The mutation that swaps the source for
an equivalent copy is the arm that tells the two apart.

Related: [[a-feature-can-be-fully-tested-and-still-be-unreachable-from-production]]
