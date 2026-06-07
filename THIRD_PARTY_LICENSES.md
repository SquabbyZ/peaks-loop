# Third-party licenses

Peaks-CLI bundles or depends on the following third-party packages.
This file documents their licenses per the slice #010 R-14 mitigation:
"document license in THIRD_PARTY_LICENSES.md".

## Production dependencies

### `headroom-ai` (v0.22.4, pinned)

- Source: https://github.com/chopratejas/headroom
- License: **Apache-2.0** (compatible with peaks-cli's MIT license)
- Usage: G7.7 opt-in compression channel (`peaks sub-agent dispatch --use-headroom`).
- License check: `npm view headroom-ai license` returns `Apache-2.0`.
- Version pinning: exact version (no `^` or `~` range) per dev-preference guidance.

Per Apache-2.0 §4, redistribution of headroom-ai must preserve the
LICENSE + NOTICE files. The package's LICENSE file is included in
`node_modules/headroom-ai/LICENSE` (the published npm tarball contains
it). When peaks-cli is republished to npm, the LICENSE file from
headroom-ai should be copied to `dist/THIRD_PARTY_LICENSES/headroom-ai.LICENSE`
alongside the build output. This is a TODO for the next release cut
(slice #011+); it does not block the slice #010 dogfood gate.

## Why headroom-ai is justified (R-14)

The dev-preference red line "非必要不添加新的 dep" is preserved:
headroom-ai is the only opt-in mechanism for G7.7 + G9 to compress
sub-agent prompts that exceed the 75% / 80% threshold. Without
headroom-ai, `--use-headroom` is a no-op and the only fallback is
`--force` override at CLI (not the architectural answer the user
asked for: "是不是可以使用 headroom 库可以优化").

The user's explicit reference (https://github.com/chopratejas/headroom)
is the basis for the dev-preference override.

## Security audit

- `pnpm audit` ran on the slice #010 install; no new high-severity
  vulnerabilities introduced by headroom-ai@0.22.4.
- The SDK runs in-process only; no long-running daemon is invoked
  from peaks-cli (the long-running `headroom proxy` is N-7 deferred).
- Communication with the proxy (if used) is HTTP to a local Unix
  socket / named pipe (no network exposure).
