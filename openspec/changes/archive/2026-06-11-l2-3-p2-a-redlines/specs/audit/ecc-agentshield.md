# `peaks audit static` — ECC AgentShield Soft-Optional Integration

## Purpose

Per spec §5.3, the peaks-cli L2 audit framework integrates with
the ECC AgentShield ruleset (102 lint rules) on a soft-optional
basis. When ECC is installed, the audit subprocess spawns the
ECC scanner and merges its findings; when not installed, the
audit completes with peaks-cli-only findings and a one-time
install prompt.

## CLI contract

```bash
peaks audit static --project <path> [--json] [--no-color]
```

The subcommand is **separate** from `peaks audit red-lines` (the
catalog-and-classifier path) so each can be invoked independently.
A future refactor may unify them, but for Slice #6 the
`static` subcommand is the one that shells out.

## Detection

```
$ npx ecc-agentshield --version
ecc-agentshield 0.x.y
```

The CLI runs this once at session start (cached for the
subprocess). A 5s timeout applies; on timeout or non-zero exit
code, the audit treats ECC as **not installed**.

## Behavior

### ECC installed

1. Spawn `npx ecc-agentshield scan --json --project <path>` with
   a 30s timeout.
2. Parse the JSON envelope.
3. For each finding in the ECC output, push a structured
   `EnforcerFinding` into the audit report with
   `enforcerId: 'ecc-agentshield:<rule-id>'`.
4. The merged `EnforcerFinding[]` lives alongside the peaks-cli
   findings in the same audit report.

### ECC not installed

1. Skip the subprocess; the audit runs peaks-cli-only.
2. Emit the §5.3 four-option install prompt (a) install, b) skip,
   c) never, d) learn). The prompt fires **once per session**,
   not per call, and is gated by a session-scoped
   `agentShieldPrompted` flag.

### `agentShieldEnabled: false`

The preference is `false` by default. When false, the audit
**does not** spawn the subprocess regardless of whether ECC is
installed. The four-option install prompt does not fire in this
case. The CLI's `--enable-agent-shield` flag overrides the
preference for a single call.

## Failure modes

| Symptom | Behavior |
|---------|----------|
| `npx ecc-agentshield` not found | Treat as not installed; emit prompt. |
| `--version` times out (5s) | Treat as not installed; emit prompt. |
| `scan` times out (30s) | Soft-fail with a warning; emit peaks-cli findings only. |
| `scan` exits non-zero | Soft-fail with a warning; emit peaks-cli findings only. |
| `scan` output is not parseable JSON | Soft-fail with a warning; emit peaks-cli findings only. |

In all soft-fail cases the audit still completes successfully
and the report is well-formed; the ECC layer is **observability
enhancement**, not a structural gate.

## Acceptance behavior

- A3 — `peaks audit static --json` runs without ECC installed
  (returns peaks-cli-only findings) AND with ECC installed
  (returns merged findings from both engines).
- A4 — When `agentShieldEnabled: false` (default), no external
  subprocess is spawned; the audit still completes.
- A5 — The four-option UA-style install prompt fires once per
  session (not per call) when ECC is missing.
