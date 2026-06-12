# OCR (Open Code Review) integration

> Soft-optional second-opinion code review for peaks-rd Gate B3.
> Mirrors the ECC 64-agents pattern (spec §7.2): peaks-cli ships
> `@alibaba-group/open-code-review` as a **required dependency** and
> reads the LLM endpoint config from `peaksConfig.ocr.llm` in the
> user's `~/.peaks/config.json` (single source of truth, user-managed).
> When present + configured, the wrapper turns the output into
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

`@alibaba-group/open-code-review` is a **required `dependency`** of
peaks-cli 2.0.1+. `npm i -g peaks-cli` pulls it automatically and
downloads the platform binary in the postinstall step. Verify with:

```bash
peaks code-review detect-ocr --json
```

Five possible states:

| state | Meaning | Recovery |
|---|---|---|
| `ready` | Installed + binary downloaded + peaks-cli's `peaksConfig.ocr.llm` valid | Nothing — `run-ocr` will work. |
| `package-missing` | npm dep not installed (corrupt node_modules, or user removed it) | `npm i -g @alibaba-group/open-code-review` (peaks-cli 2.0.1+ does this automatically; this state is rare) |
| `binary-missing` | npm dep present but Go binary did not download | `pnpm approve-builds @alibaba-group/open-code-review`, OR run `node node_modules/@alibaba-group/open-code-review/scripts/install.js`, OR manually fetch from https://github.com/alibaba/open-code-review/releases and place the binary at the path shown in `nextActions[2]`. |
| `config-missing` | binary present but `peaksConfig.ocr.llm` is empty or partial | See "Configure" below. |
| `detection-failed` | Unexpected error during detection | Inspect stderr; re-run probe. |

## Configure (one-time, per user) — peaks-cli does NOT auto-configure

The LLM endpoint config is **user-maintained inside peaks-cli's own
config** at `~/.peaks/config.json` under the `ocr.llm` key. The user
is the only party that touches their LLM token / URL / model. peaks-cli
never auto-writes the config and never writes `~/.opencodereview/config.json`.

```bash
# 1) Print the JSON snippet to paste (read-only, no side effects):
peaks code-review config-template --json

# 2) Paste the snippet into ~/.peaks/config.json under "ocr.llm",
#    replace <your-api-key> with your real key. Alternatively,
#    set keys one at a time:
peaks config set --key ocr.llm.url --value 'https://api.example.com/v1/messages'
peaks config set --key ocr.llm.authToken --value '<your-key>'
peaks config set --key ocr.llm.model --value 'claude-3-5-sonnet-latest'
peaks config set --key ocr.llm.useAnthropic --value 'true'
peaks config set --key ocr.llm.authHeader --value 'x-api-key'

# 3) Verify readiness (peaks-rd also runs this automatically):
peaks code-review detect-ocr --json
```

### Field map: `peaksConfig.ocr.llm` ↔ ocr subprocess env vars

peaks-rd calls ocr with the `peaksConfig.ocr.llm` values **injected as
env vars** (ocr's highest-priority config path). The mapping is:

| `peaksConfig.ocr.llm.*` | Spawn env var | Notes |
|---|---|---|
| `url` | `OCR_LLM_URL` | HTTPS endpoint, no embedded credentials |
| `authToken` | `OCR_LLM_TOKEN` | Sensitive — stored only in the user-layer `~/.peaks/config.json`; `peaks config get` redacts this field |
| `model` | `OCR_LLM_MODEL` | e.g. `claude-3-5-sonnet-latest` |
| `useAnthropic` | `OCR_USE_ANTHROPIC` | Boolean; serialised as `"true"` / `"false"` |
| `authHeader` | `OCR_LLM_AUTH_HEADER` | One of `authorization` (default Bearer), `x-api-key` (for `sk-ant-*` keys), or `bearer` |

The `~/.opencodereview/config.json` file the user might have set up
for 2.0.0 is no longer consulted by peaks-cli. The user may delete it
at their discretion — the ocr subprocess ignores the file when peaks-
cli's env vars are present (and the env-var surface is highest priority).

### Required vs optional fields

The minimum for `state == "ready"` is the **url + authToken + model**
triple. `useAnthropic` and `authHeader` are optional; `authHeader`
defaults to `authorization` (Bearer) inside the ocr subprocess, but
`sk-ant-*` keys require `authHeader: "x-api-key"`.

When the user has not yet populated the config, `detect-ocr` returns
`state: "config-missing"` with `missingKeys: ["ocr.llm.url",
"ocr.llm.authToken", "ocr.llm.model"]` and a templated
`nextActions[1]` payload that includes the JSON snippet to paste.

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
- peaks-cli does NOT auto-configure ocr. Your `ocr.llm.authToken`
  is yours. Rotate as needed. The token is stored only in the
  user-layer `~/.peaks/config.json` (project layer rejects writes
  to any key matching `isSensitiveConfigPath`), and
  `peaks config get` redacts it as `***`.
- peaks-cli's wrapper records ocr's `stdout` verbatim in the
  envelope (and in `code-review.md` when peaks-rd merges
  findings). Don't put secrets in your code being reviewed.
- The `peaks code-review config-template` snippet embeds the
  placeholder string `<your-api-key>`; the user is expected to
  replace it before pasting.

## Failure modes (real)

These are the actual failure modes the wrapper has been
dogfooded against:

1. **Network blocked from GitHub Releases** during postinstall →
   `binary-missing`. peaks-cli still runs cleanly because ocr
   is detected as not-ready; user manually fetches the binary
   and places it at `nextActions[2]`'s path.
2. **pnpm-installed peaks-cli** → ocr postinstall blocked by
   pnpm's safe-by-default policy → `binary-missing`. Recover
   with `pnpm approve-builds @alibaba-group/open-code-review`.
3. **No / partial LLM config** → `config-missing` with
   `missingKeys` listing the unpopulated fields. Recover by
   pasting the `peaks code-review config-template` output into
   `~/.peaks/config.json` (or by `peaks config set` per-key).
4. **Wrong key / wrong endpoint** → ocr subprocess exits non-zero;
   wrapper soft-fails (`ok: false`, `warnings[0]` includes the
   exit code, `stderr` carries ocr's own error message).
5. **User 2.0.0 → 2.0.1 migration** — they configured
   `~/.opencodereview/config.json` for 2.0.0; peaks-cli 2.0.1
   no longer reads that file. They paste the same values into
   `~/.peaks/config.json` under `ocr.llm` (peaks-cli handles the
   camelCase conversion in the template).

## See also

- ocr upstream: https://github.com/alibaba/open-code-review
- peaks-cli source: `src/services/code-review/ocr-service.ts`,
  `src/cli/commands/code-review-commands.ts`
- peaks-cli config schema: `src/services/config/config-types.ts`
  (`OcrLlmConfig`, `OcrConfig`, `PeaksConfig.ocr?`)
- ECC 64-agents soft-optional pattern (mirrored):
  `src/services/agent/ecc-agent-service.ts`
