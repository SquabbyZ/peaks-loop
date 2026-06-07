# Headroom Integration — G7.7 opt-in compression channel

> Slice #010 (G7.7 headroom-ai integration route).
> Source: https://github.com/chopratejas/headroom
> Package: `headroom-ai@0.22.4` (Apache-2.0, MIT-compatible).
> See: `THIRD_PARTY_LICENSES.md` for the license record.

## Why headroom-ai is justified (R-14)

The dev-preference red line "非必要不添加新的 dep" is preserved:
headroom-ai is the only opt-in mechanism for G7.7 + G9 to compress
sub-agent prompts that exceed the 75% / 80% threshold. Without
headroom-ai, `--use-headroom` is a no-op and the only fallback is
`--force` override at CLI.

The user's explicit reference (https://github.com/chopratejas/headroom)
is the basis for the dev-preference override.

## API shape (real SDK, not the PRD's spec)

```ts
import { compress } from 'headroom-ai';

const result = await compress(messages, {
  model: 'claude-sonnet-4-5-20250929',
  baseUrl: 'http://localhost:8787',  // local proxy; not used in slice #010
  apiKey: 'hr_...',                   // Headroom Cloud; not used in slice #010
  timeout: 30_000,
  fallback: true,                     // CRITICAL: return original messages if proxy is dead
  retries: 1,
  tokenBudget: 4000,                  // compress to fit this limit
  hooks: new MyHooks(),               // pre/post compression hooks
});

result.messages          // compressed messages
result.tokensBefore      // original token count
result.tokensAfter       // compressed token count
result.tokensSaved       // tokens removed
result.compressionRatio  // tokensAfter / tokensBefore
result.transformsApplied // e.g. ['router:smart_crusher:0.35']
result.compressed        // false if fallback kicked in
```

`fallback: true` is the key option: if the proxy is unavailable, the SDK
returns the original messages + `result.compressed: false` instead of
throwing. This makes the failure mode non-blocking (RL-22d / RL-32).

## Mode table (peaks wrapper)

The peaks wrapper maps the user-facing `HeadroomMode` to the SDK's
`tokenBudget` option. Slice #010 does not consume the SDK's internal
"audit" / "optimize" / "simulate" modes (those are SDK-internal);

| Mode | tokenBudget | Use case |
|---|---|---|
| `balanced` (default) | promptSize * 0.40 / 4 | General sub-agent dispatch |
| `aggressive` | promptSize * 0.20 / 4 | Last-resort large prompt |
| `conservative` | promptSize * 0.70 / 4 | Sensitive code analysis, accuracy-critical |

The `0.40 / 4` factor approximates 60% byte reduction (1 token ≈ 4 bytes
for English text). The SDK does its own tokenization internally; the
`tokenBudget` is a hint, not a hard cap.

## Failure semantics (RL-22d / RL-32)

- `result.compressed === false` → `code: "HEADROOM_UNAVAILABLE"` warning
- `compress()` throws (network error, JSON parse error) → caught and treated as `HEADROOM_UNAVAILABLE`
- Import failure (headroom-ai not installed) → caught and treated as `HEADROOM_UNAVAILABLE`
- **NOT blocking** — peak falls back to G7 metadata-only and continues dispatch

## CCR reversible hydration (slice #011+ TODO)

The PRD mentions "CCR (Cross-Context Reversible)" as a benefit of
headroom. In the SDK, this is implemented via the `hooks` option on
`compress()`. A pre/post hook can persist the `ccrHashes` to disk,
and a later `rehydrate()` call can re-hydrate the compressed prompt
to the original. Slice #010 does NOT consume CCR — it only uses
compression. R-17 (CCR for aggressive / conservative modes) is
deferred to slice #011+.

## Cross-platform behavior (R-19)

- In-process compression (the SDK's library mode) is platform-agnostic.
- The long-running `headroom proxy` daemon is platform-specific
  (Unix socket on Linux/macOS, named pipe on Windows). Slice #010
  does NOT consume the proxy daemon.
- All headroom-ai calls in slice #010 go through the in-process SDK
  with `fallback: true`. The peak wrapper at
  `src/services/context/headroom-client.ts` catches all errors and
  treats them as fallback.

## What slice #010 does NOT do

- Does NOT install the `headroom proxy` daemon (N-7).
- Does NOT consume headroom's `SharedContext` directly (G7.7.3 in the
  PRD); the peak-internal `SharedChannel` (G8) is the cross-sub-agent
  state store. `buildSharedContextBridge()` is a stub that returns
  the peak-internal channel ID + a placeholder headroom context ID.
- Does NOT use the SDK's `audit` / `optimize` / `simulate` modes
  (those are SDK-internal; the peak wrapper exposes
  `balanced` / `aggressive` / `conservative` to the user).

## Security + license

- License: Apache-2.0 (MIT-compatible) — see `THIRD_PARTY_LICENSES.md`.
- Pinned version: exact `0.22.4` (no `^` / `~` range) per dev-preference.
- `pnpm audit` ran on install; no new high-severity vulnerabilities.
