---
name: git-opens-the-ssh-connection-before-the-pre-push-hook-and-a-long-hook-lets-it-go-stale
description: Git opens the SSH connection before the pre-push hook, and a long hook lets that connection go stale
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured 2026-10-24 (T1 backlog campaign, pushing 8 commits to
`git@github.com:SquabbyZ/peaks-loop.git`).

The push failed twice with `Read from remote host github.com: Connection reset by peer` and
`send-pack: unexpected disconnect while reading sideband packet` (exit 128), then once with
SIGPIPE (exit 141). Every diagnostic pointed AWAY from the push: `git ls-remote origin`
succeeded, `ssh -T git@github.com` authenticated ("Hi SquabbyZ!"), no proxy was configured, and
the whole push was 97 objects of a few hundred KB. The gate legs had all passed in every
attempt — the full unit suite measured 597 files / 6515 tests green, three times.

**The cause.** `git send-pack` opens the SSH connection to `git-receive-pack` BEFORE the
pre-push hook runs, and this repository's pre-push hook runs the FULL unit suite — ~15 minutes
on this host. The connection therefore sat idle for that whole time, and by the time git tried
to send the pack the remote, or an intermediary, had already dropped it. The failure was
always at the pack-sending stage and never at authentication or ref negotiation — that is the
shape of a stale connection, not of a permission problem and not of a size problem.

**The fix.** Two independent knobs, both applied through `GIT_SSH_COMMAND`, so nothing
persistent changed:

- `-o ServerAliveInterval=30` — keepalive on the connection while the hook runs;
- `-o HostName=ssh.github.com -p 443` — the same host over port 443 instead of 22.

With both, the third attempt pushed cleanly: `c5691d56..fe5666bb  main -> main`, exit 0, and
CI came back with 10 of 10 jobs green.

**How to apply.** Before blaming a push, split the question: did the GATE pass, and did the
TRANSPORT fail? A failure that appears after the hook's own output is a transport failure, and
the gate's green verdict does not cover it — the gate says the tree is good, not that the
socket survived. When a hook is long, assume the connection opened before it went stale, and
put a keepalive on it. And `git push --dry-run` does NOT skip the pre-push hook: it buys you
the full hook cost and no push, so it is not a cheap transport probe.
