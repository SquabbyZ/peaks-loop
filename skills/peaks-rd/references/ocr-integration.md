# OCR (Open Code Review) integration

> Soft-optional second-opinion code review for peaks-rd Gate B3.
> Mirrors the ECC 64-agents pattern (spec §7.2): peaks-cli ships
> `@alibaba-group/open-code-review` as an `optionalDependency`;
> when present + configured, the wrapper turns its output into
> structured `code-review.md` evidence.

## What ocr is

[Open Code Review](https://github.com/alibaba/open-code-review) is
an AI-powered code review CLI from Alibaba. It reads git diffs,
sends the changed files to a **user-configured LLM endpoint**
(OpenAI- or Anthropic-compatible), and emits structured
line-precise review comments. It is NOT a hosted service —
all LLM traffic goes to the user's own configured endpoint.

Distribution: npm `@alibaba-group/open-code-review` (Go binary
inside; the npm postinstall downloads the platform-specific
binary from GitHub Releases).

## Why peaks-rd uses it (soft-optional)

The default peaks-rd code-review evidence is produced by the
main RD LLM (or the `code-reviewer` sub-agent in the parallel
fan-out). That's one pair of eyes. When ocr is available, the
wrapper adds a **second pair** — an independent LLM tuned for
code review — and the two reviews are merged into the same
`code-review.md` file. Soft-optional: if ocr isn't installed or
configured, RD proceeds with the LLM-only review and the slice
ships without the second opinion.

## Install

ocr ships with peaks-cli as an `optionalDependency`. `npm i -g peaks-cli@2.0`
should pull it automatically and download the platform binary in
the postinstall step. Verify with:

```bash
peaks code-review detect-ocr --json
```

Five possible states:

| state | Meaning | Recovery |
|---|---|---|
| `ready` | Installed + binary downloaded + LLM config valid | Nothing — `run-ocr` will work. |
| `package-missing` | npm dep not installed (pnpm/yarn user who skipped optional deps) | `npm i -g @alibaba-group/open-code-review` |
| `binary-missing` | npm dep present but Go binary did not download | `pnpm approve-builds @alibaba-group/open-code-review`, OR run `node node_modules/@alibaba-group/open-code-review/scripts/install.js`, OR manually fetch from https://github.com/alibaba/open-code-review/releases and place the binary at the path shown in `nextActions[2]`. |
| `config-missing` | binary present but LLM endpoint not configured | See "Configure" below. |
| `detection-failed` | Unexpected error during detection | Inspect stderr; re-run probe. |

## Configure (one-time, per user)

ocr needs a user-owned LLM endpoint:

```bash
ocr config set llm.url https://api.anthropic.com/v1/messages
ocr config set llm.auth_token <your-api-key>
ocr config set llm.model claude-opus-4-6
ocr config set llm.use_anthropic true
```

Or use the documented OCR_* env vars. peaks-cli does NOT touch
this config — your LLM endpoint and credentials are yours.

Verify connectivity once:

```bash
ocr llm test
```

## Use from peaks-rd (LLM workflow)

In Gate B3 (code review evidence), before writing
`.peaks/_runtime/<sid>/rd/code-review.md`, the code-reviewer
sub-agent runs:

```bash
# 1. Detect
peaks code-review detect-ocr --json
# 2. If state == "ready", run the review
peaks code-review run-ocr --json --project . --from origin/main --to HEAD
```

The `run-ocr` envelope is:

```jsonc
{
  "ok": true,
  "command": "code-review.run-ocr",
  "data": {
    "spawned": true,
    "state": "ready",
    "exitCode": 0,
    "stdout": "...",
    "stderr": "",
    "durationMs": 12345,
    "parsed": {
      "findings": [
        { "file": "src/foo.ts", "line": 42, "severity": "minor", "message": "..." }
      ]
    },
    "warnings": [],
    "nextActions": []
  },
  ...
}
```

Merge `data.parsed.findings` into `code-review.md` under
`## Second opinion (ocr)`. Cite each finding by file + line.
Reconcile disagreements with the LLM-only review explicitly
(don't silently drop one source).

## Soft-fail policy

`peaks code-review run-ocr` **never** sets a non-zero exit code,
even when ocr is not ready or the subprocess fails. The envelope
`ok` field carries the success signal; the caller (peaks-rd) is
expected to pattern-match on `data.state` and proceed without the
second opinion if needed. This matches the ECC 64-agents
soft-fail policy and the peaks-cli "minimal user operation"
tenet — missing ocr should never block a slice.

## Security

- ocr sends your changed files to whatever LLM endpoint you
  configure. Treat this the same as any external code-review
  tool you opt into: don't point it at a free public endpoint
  for proprietary code; use a vendor / self-hosted endpoint with
  appropriate data controls.
- peaks-cli does NOT auto-configure ocr. Your `llm.auth_token`
  is yours. Rotate as needed.
- peaks-cli's wrapper records ocr's `stdout` verbatim in the
  envelope (and in `code-review.md` when peaks-rd merges
  findings). Don't put secrets in your code being reviewed.

## Failure modes (real)

These are the actual failure modes the wrapper has been
dogfooded against:

1. **Network blocked from GitHub Releases** during postinstall →
   `binary-missing`. peaks-cli still installs cleanly because
   ocr is an `optionalDependency`; user manually fetches the
   binary and places it at `nextActions[2]`'s path.
2. **pnpm-installed peaks-cli** → ocr postinstall blocked by
   pnpm's safe-by-default policy → `binary-missing`. Recover
   with `pnpm approve-builds @alibaba-group/open-code-review`.
3. **No LLM config** → `config-missing`. Recover with the
   `ocr config set` commands above.
4. **Wrong key / wrong endpoint** → ocr subprocess exits non-zero;
   wrapper soft-fails (`ok: false`, `warnings[0]` includes the
   exit code, `stderr` carries ocr's own error message).

## See also

- ocr upstream: https://github.com/alibaba/open-code-review
- peaks-cli source: `src/services/code-review/ocr-service.ts`,
  `src/cli/commands/code-review-commands.ts`
- ECC 64-agents soft-optional pattern (mirrored):
  `src/services/agent/ecc-agent-service.ts`
