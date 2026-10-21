---
name: feed-the-code-gate-payload-by-file-redirection
description: The code gate fails OPEN on a payload it cannot read, so an acceptance that pipes the payload in proves nothing — feed it by FILE REDIRECTION and look for the undecidable marker.
metadata:
  type: project
---

`peaks code-gate` reads the hook payload from **stdin**. When stdin carries
no payload it **allows** the call — deliberately (a blocked edit on every call
would be worse than an allowed one) — and says so on stderr with
`PEAKS_CODE_GATE_UNDECIDABLE`.

**A shell pipeline is not a delivery mechanism on every shell.** A PowerShell
pipeline into a native executable does not forward stdin at all, so the gate
reads an empty payload, allows EVERY case, and the run is green while it
proved nothing. This is not hypothetical: it is how the "the gate lets
`./src/x.ts` and the absolute path through" defect was found — a round of
acceptance that allowed every case it was supposed to deny.

**How to apply:**

- Deliver the payload by **file redirection**, not by a pipe:
  `cmd /c "node src/cli/index.ts code-gate --project . --json < payload.json"`
  (on bash: `node src/cli/index.ts code-gate --project . --json < payload.json`).
- **Check stderr for `PEAKS_CODE_GATE_UNDECIDABLE`.** Its absence is the
  proof the payload arrived; its presence means the case was allowed for
  want of a payload, not judged.
- A case that expects a **deny** must show the exit code 2 and
  `PEAKS_CODE_PROHIBITED_DIRECT_EDIT` on stderr. Exit 0 with no marker
  means the payload never arrived.
- The same rule applies to every hook that reads a payload from stdin in
  this repository: the gate is only as good as the delivery.

Related: `the-published-package-only-boots-with-nested-subpackages.md` (the
other half of the same acceptance round — the published package's layout).
