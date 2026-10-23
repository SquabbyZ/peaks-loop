---
name: on-this-host-bash-is-the-wsl-launcher-and-a-host-limit-measured-once-is-not-a-permanent-limit
description: On this host bash is the WSL launcher, and a host limit measured once is not a permanent limit
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured on the Windows dev host for `D:\projects\peaks-loop`.

**What still holds (re-measured 2026-10-24).**

- `bash` on PATH is `C:\WINDOWS\system32\bash.exe`, the **WSL launcher**, and it cannot run at
  all (`bash -c 'echo hi'` exits 1). A test that asserts a shell hook spawns therefore fails
  with `expected -1 to be 2` — that is the host, not the code under test. 15 arms in
  `tests/unit/services/hooks/` are in this shape, and 20 shell-spawning gate tests failed on
  2026-10-24 for the same reason while their non-shell siblings passed.
- `peaks mut run` (Stryker) **cannot complete** on this host: the installed binary lacks
  `@stryker-mutator/core`, and a working-tree run hits `EPERM` inside Stryker's sandbox copy.

**What was FALSIFIED on 2026-10-24 — the earlier "the full suite cannot pass here" claim.**

This file was written on 2026-10-23 with the claim that the full unit suite cannot pass on this
host because 7 web test files fail on a broken loopback TCP. On 2026-10-24 that claim was
measured again and it did not hold: three separate tree-wide runs measured **597 test files,
6515 passed | 3 skipped (6518)**, green, at 890.86 s / 947.74 s / 926.17 s. The web daemon
tests bound and listened on 127.0.0.1 normally in all three.

The earlier claim was not fabricated — it was a real measurement on 2026-10-23 — but a host
limitation measured ONCE is not a permanent property of the host. The loopback failure was
transient, and a note that says "this host cannot run the full suite" outlives the condition
that produced it. The file's own title carried that claim, so the title changed with the
claim; the falsified half is kept here as a dated record rather than deleted, because the
failure mode it describes — a standing note that stops being true — is the lesson.

**How to apply.** Attribute a red to the host only after re-running it ALONE, and re-measure a
host limitation before you rely on it — especially one that is standing in the way of running
the full suite. Concurrency alone produces transient reds on this host (a 30 s timeout under
load, `ENAMETOOLONG` from an inflated argv), so a red measured under parallel load is not yet
a verdict. Report the attribution with the command that produced it, and date it.
