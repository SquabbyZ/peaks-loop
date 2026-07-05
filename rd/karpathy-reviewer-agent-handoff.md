# Karpathy Reviewer — User Handoff (Slice 7/7 — auto-install)

> **Audience**: the operator who installed `peaks-loop` and ran the 6-slice karpathy-enforcement program.
> **Goal**: verify the `karpathy-reviewer` sub-agent prompt auto-installed to `~/.claude/agents/karpathy-reviewer.md` on `npm i -g peaks-loop@latest`, with content-hash drift detection (`.peaks-managed` marker + SHA-256).
> **Shipped source (canonical)**: `agents/karpathy-reviewer.md`
> **Project-internal pointer**: `skills/bee/peaks-rd/references/karpathy-reviewer-prompt.md` (2-line pointer, peaks-loop 2.0 rules convention)

## Auto-install behavior (Slice 7/7)

The Slice 6 design asked the user to `mkdir -p ~/.claude/agents && cp ...` after every `npm i -g peaks-loop@latest`. **Slice 7/7 fixes this** by extending the existing `peaks-loop` postinstall (`scripts/install-skills.mjs`) to auto-install bundled agents. The contract mirrors the existing `output-styles` install:

| Step | What happens | Where |
|---|---|---|
| 1. `npm i -g peaks-loop@latest` | npm runs the package's `postinstall` lifecycle hook | `package.json#postinstall` |
| 2. postinstall reads the tarball | `scripts/install-skills.mjs` runs | `scripts/install-skills.mjs` |
| 3. `installBundledAgentsForAllPlatforms()` is called | iterates `IDE_SKILL_INSTALL_PROFILES` entries that have `agentsDir` | `scripts/install-skills.mjs:861` |
| 4. For Claude Code (the only platform with `agentsDir` today) | reads `agents/karpathy-reviewer.md` from the package root | `scripts/install-skills.mjs:797` |
| 5. Content-hash drift detection | checks `~/.claude/agents/karpathy-reviewer.md` + `.peaks-managed` marker | `getManagedPeaksAgentIdentity` |
| 6. Atomic copy (or skip) | `writeFileExclusively` to the target + marker | `installBundledAgents` |

**The user should never have to run a per-platform install command** (peaks-loop tenet: "minimal-user-operation").

## Verify it auto-installed

After `npm i -g peaks-loop@latest` (or any future upgrade), the file should already be at `~/.claude/agents/karpathy-reviewer.md`. To verify:

```bash
ls -la ~/.claude/agents/karpathy-reviewer.md
ls -la ~/.claude/agents/karpathy-reviewer.md.peaks-managed
cat ~/.claude/agents/karpathy-reviewer.md.peaks-managed
```

Expected output:
- `~/.claude/agents/karpathy-reviewer.md` exists, size ≈ 15 KB, owned by your user, mode 0600
- `~/.claude/agents/karpathy-reviewer.md.peaks-managed` exists, contains a JSON object with `kind: 'agent'`, `agentName: 'karpathy-reviewer.md'`, `sourcePath` pointing to the peaks-loop install location, and a `contentSha256` SHA-256 of the source

The postinstall also prints a one-line confirmation:

```
Peaks agents installed across 1 platforms (1 total files)
```

(8-platform fan-out — only Claude Code has an `agentsDir` profile today. Future platforms can opt in by adding `agentsDir` to their `IDE_SKILL_INSTALL_PROFILES` entry.)

## Drift detection (the "what happens on upgrade" question)

`npm i -g peaks-loop@latest` (upgrade) re-runs the postinstall, which re-checks the content hash. Three outcomes:

| Scenario | Action |
|---|---|
| File missing, marker missing | **install** (write file + marker) |
| File present, marker present, source hash = target hash = marker hash, source path = current package path | **replace** (atomic write; user-visible state is unchanged) |
| File present, marker present, ANY mismatch (different source path, drifted hash) | **skip** (preserve user's local file; do not overwrite) |
| File present, no marker | **skip** (treat as user-authored; do not overwrite) |
| File missing, marker present | **install** (replace stale marker) |

This mirrors the `output-styles` drift policy. The marker file (`*.peaks-managed`) is what makes the drift detection safe: it's a managed file with a SHA-256 + source path that the postinstall trusts.

## Escape hatch (assisted / CI mode)

To skip the agent install without skipping the skills / output-styles install:

```bash
PEAKS_SKIP_AGENT_INSTALL=1 npm i -g peaks-loop@latest
```

This is useful in CI / sandboxed environments where the user's `~/.claude/agents/` is not writable, or when the user wants to manage their own agent files outside peaks-loop's auto-install.

To override the target directory (parallel to `PEAKS_CLAUDE_SKILLS_DIR` for skills):

```bash
PEAKS_CLAUDE_AGENTS_DIR=/path/to/custom/agents npm i -g peaks-loop@latest
```

The env var is per-IDE; the universal escape hatch is `PEAKS_SKIP_AGENT_INSTALL=1`.

## End-to-end runtime smoke test (optional but recommended)

After verifying the install, dispatch a real karpathy-reviewer sub-agent against this slice's RD outputs:

```bash
peaks sub-agent dispatch karpathy-reviewer \
  --rid 2026-06-17-karpathy-5way-fanout \
  --project /Users/yuanyuan/Desktop/peaks-loop \
  --json
```

Expected outcome:

- The CLI returns a `toolCall` descriptor (a JSON envelope, dry-run by design — see `peaks sub-agent dispatch --help`).
- Execute the returned `toolCall` in your Claude Code session (the LLM reads the agent file from `~/.claude/agents/karpathy-reviewer.md` and produces the review).
- The agent writes (or overwrites) `rd/karpathy-review.md` with the 4 title-case sections.
- The agent's last line is a compact JSON envelope: `{"passed": bool, "violations": [...], "gateAction": "pass|warn|block"}`.

To verify the hard Karpathy-Gate at the transition level:

```bash
# With rd/karpathy-review.md present (clean pass):
peaks request transition --role rd --state qa-handoff \
  --rid 2026-06-17-karpathy-5way-fanout --json
# Expected: { ok: true, state: qa-handoff }

# Without rd/karpathy-review.md (hard block):
mv rd/karpathy-review.md rd/karpathy-review.md.tmp
peaks request transition --role rd --state qa-handoff \
  --rid 2026-06-17-karpathy-5way-fanout --json
# Expected: { ok: false, code: PREREQUISITES_MISSING, missing: rd/karpathy-review.md }
mv rd/karpathy-review.md.tmp rd/karpathy-review.md
```

## What the agent does (1-paragraph summary)

The `karpathy-reviewer` is a 5-way fanout sub-agent that inspects an RD slice's diff against the 4 Karpathy guidelines (Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution). It writes `rd/karpathy-review.md` with evidence per guideline and emits a compact JSON envelope `{passed, violations, gateAction}`. The `KARPATHY_REVIEW` prereq in `peaks-loop`'s transition gate enforces that this file is present and well-formed before `peaks request transition --state qa-handoff` can succeed — making the karpathy review a **hard gate** on every RD→QA handoff.

## What the agent does NOT do

- **Does not write code.** Code edits are the parent RD loop's job. The reviewer is read-mostly.
- **Does not modify the PRD or RD request artifact.** The agent's only file write is `rd/karpathy-review.md`.
- **Does not call `peaks request transition`.** Only the parent RD loop owns the transition state machine.
- **Does not install hooks, agents, MCP servers, or modify settings.** This is the global peaks-rd red line; it applies to sub-agents too.
- **Does not duplicate parallel reviewers.** Code quality, security, performance, and test-case authoring are owned by `code-reviewer` / `security-reviewer` / `perf-baseline-reviewer` / `qa-test-cases-writer` respectively.

## Rollback / uninstall

To remove the karpathy-reviewer sub-agent and its marker:

```bash
rm ~/.claude/agents/karpathy-reviewer.md \
   ~/.claude/agents/karpathy-reviewer.md.peaks-managed
```

After removal, the peaks-loop CLI gate (the `KARPATHY_REVIEW` prereq) will refuse any `peaks request transition --state qa-handoff` because `rd/karpathy-review.md` will be missing. To re-enable transitions without the agent, you can use the assisted-mode escape hatch:

```bash
peaks request transition --role rd --state qa-handoff \
  --rid <rid> --allow-incomplete --confirm --json
```

(The `--allow-incomplete --confirm` flag tells the CLI to bypass the prereq check. Use it only when you have manually reviewed the slice outside the agent.)

## If the auto-install fails

| Symptom | Likely cause | Fix |
|---|---|---|
| `~/.claude/agents/karpathy-reviewer.md` is missing | postinstall didn't run (e.g. `PEAKS_SKIP_AGENT_INSTALL=1` was set, or the install was in `--ignore-scripts` mode) | Re-run `node $(npm root -g)/peaks-loop/scripts/install-skills.mjs` (or reinstall the package) |
| `~/.claude/agents/karpathy-reviewer.md` exists but is old (pre-Slice 7 content) | the postinstall was never re-run after the peaks-loop upgrade | Re-run `node $(npm root -g)/peaks-loop/scripts/install-skills.mjs` to force a content-hash check + replace |
| The postinstall prints `Peaks user config was not installed: EACCES ...` | the user's `~/.claude/agents/` is owned by another user | `sudo chown -R $USER ~/.claude/agents` then re-run the postinstall |
| `peaks sub-agent dispatch karpathy-reviewer` returns `unknown role` | the Claude Code session loaded before the file existed | Restart the Claude Code session; the agent loader scans `~/.claude/agents/` at session start |
| `peaks request transition` returns `PREREQUISITES_MISSING` after a successful dispatch | the agent's file write failed (read-only filesystem, path collision) | Check `rd/karpathy-review.md` exists and has 4 title-case section headers; re-dispatch |
| The postinstall reported `Peaks agents skipped because local files already exist` | the target file is a user-authored file (no `.peaks-managed` marker) or has a marker with a non-matching source path | Either delete the target to allow the install to proceed, or leave it as-is and accept that the user's local file takes priority |

## Where to find the canonical source (after the install)

- **Shipped source (canonical, edit here)**: `agents/karpathy-reviewer.md` — this is the file that ships in the npm tarball and is what the postinstall copies from.
- **Project-internal pointer**: `skills/bee/peaks-rd/references/karpathy-reviewer-prompt.md` (2-line pointer, peaks-loop 2.0 rules convention).
- **Contract slot**: `skills/bee/peaks-rd/references/rd-fanout-contracts.md` §"karpathy-reviewer contract (Slice 5/6)" — the slot the 5-way fanout integration references.
- **CLI gate**: `KARPATHY_REVIEW` prereq in `src/services/artifacts/artifact-prerequisites.ts` (title-case `mustContain`).
- **Structural scanner (companion)**: `peaks scan karpathy` reads `rd/karpathy-review.md` and emits a similar markdown report.

## Status

- created: 2026-06-18 (Slice 7/7 handoff — auto-install)
- slice: 7 of 7 (karpathy-enforcement program)
- upstream: Slice 5/6 PRD `2026-06-17-karpathy-5way-fanout` §R2 + §Non-goal; Slice 6/6 design superseded by user feedback
- state: handoff-ready (auto-install verified; no user action required)
