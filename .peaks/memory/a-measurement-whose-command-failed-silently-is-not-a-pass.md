---
name: a-measurement-whose-command-failed-silently-is-not-a-pass
description: A measurement whose command failed silently is not a pass
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff.md
---

During acceptance I reported "0 orphan daemon processes, 0 chrome" as evidence AC6 passed. The check
was `wmic process where … | grep -c 'daemon-entry'`, and **`wmic` does not exist in this shell** — the
command failed, `grep -c` counted empty input as 0, and an `|| echo 0` fallback hid the failure. The
true counts were 2 daemons and 8 chrome. Worse, the moment being measured was wrong too: the daemons
were *supposed* to be alive (Q7 has no idle-exit).

**Why:** a silent failure and a genuine zero are indistinguishable in the output. An acceptance
"evidence" that cannot distinguish them is worse than no evidence, because it converts an unknown
into a recorded pass.

**How to apply:** for any process/state count, (1) use an instrument known to exist in this shell
(`powershell -NoProfile -Command "Get-CimInstance …"`, verified before relying on it), (2) include a
control that must be non-zero to prove the command produced output, and (3) never wrap a measurement
in a failure-masking fallback like `|| echo 0`. State the instrument in the report.
