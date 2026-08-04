# Coding Standards (2.0 canonical)

- Prefer simple, readable code over clever abstractions.
- Keep functions focused and files cohesive.
- Use immutable updates unless a language-specific convention explicitly favors mutation.
- Validate user input, external data, file paths, and configuration at system boundaries.
- Preserve existing project conventions when they are stricter than this baseline.

## Cross-platform path handling (locked 2026-08-04, effective immediately — no exceptions)

When a slice touches filesystem paths (`projectRoot`, binding file `projectRoot`, artifact path, dispatch record path, lease path, etc.) and the comparison is **not** "exactly this byte-for-byte string I just produced", the slice MUST use the canonical utilities in `src/shared/path-utils.ts`. Specifically:

| Need | Use this (NOT hand-rolled) |
|---|---|
| Compare two project-root strings for "same physical project" | `projectRootsMatch(stored, caller)` — exported from `src/shared/path-utils.ts` since rid-002 (2026-08-04) |
| Convert a user-supplied path to a stable real path | `stableRealPath(p)` |
| Compare or display two paths ignoring the `\` vs `/` separator | `normalizePath(p)` / `pathsEqual(a, b)` |
| Detect platform | `isWindows` / `isMac` / `isLinux` from `src/shared/platform.ts` |
| Check a child path is inside a parent | `isInsidePath(child, parent)` (already platform-agnostic via `path.relative`) |

### Forbidden patterns (slice will be blocked at code-review if found)

- `data.projectRoot === projectRoot` or any other string equality on a filesystem path coming from a binding file, JSON config, user input, or `process.cwd()` cross-process boundary.
- `realpathSync(p)` ad-hoc in a non-path-utils module — the slice must call `stableRealPath` instead, so the platform-aware `resolveInputPath` (Windows-absolute path normalization) is in one place.
- `path.replace(/\\/g, '/')` in any new code — import `normalizePath` from `src/shared/path-utils.ts`. The only acceptable inline is in the utility itself.
- Hand-rolled lowercase comparison on a path — `projectRootsMatch` already does `isWindows ? .toLowerCase() : raw`. POSIX file systems are case-sensitive; folding on POSIX breaks distinct `/tmp/Foo` vs `/tmp/foo`.
- `--caller-id <id>` in any user-facing error hint — the CLI does not accept a `--caller-id` flag. Use `set PEAKS_CALLER_ID=<id> in the environment` (locked 2026-08-04 rid-001).

### Why this rule exists

`peaks-loop@4.0.9` shipped with a statusline that always rendered `peaks empty` on Windows Git Bash, even when `peaks-code` was active. Root cause: the binding-file reader used string `===` to compare `projectRoot`; the binding had been written with backslashes (`C:\Users\...`), but `peaks skill presence:set --project C:/Users/...` arrived with forward slashes, and Node treats them as distinct strings. The fail-closed `PEAKS_SESSION_NOT_BOUND` gate then blocked the presence marker write, and the statusline never had a real skill to display. The `4.0.8 caller projection` gate that re-introduced this fail-closed is not the problem; the path comparison beneath it is.

This class of bug is silent: the code does not crash, but Windows Git Bash users see `peaks empty` while macOS / Linux users see the correct skill. The only safe default is to centralize the comparison.

### Where the canonical implementation lives

- `src/shared/path-utils.ts` — `projectRootsMatch`, `projectRootCompareKey`, `stableRealPath`, `normalizePath`, `pathsEqual`, `isInsidePath`, `resolveInputPath`, `stablePath`.
- `src/shared/platform.ts` — `isWindows`, `isMac`, `isLinux`, `platform`.
- `src/shared/path-safety.ts:14-17` — duplicate `normalizeForwardSlashes`; folded into `path-utils.normalizePath` (rid-003 TODO).

### Reference: prior slices that landed this rule

- `2026-08-04-rid-001-path-canonicalize` (session-manager.ts read/write) — commit `5ae2fa6d`.
- `2026-08-04-rid-002-bridge-canonicalize` (session-binding-bridge.ts read/write + `projectRootsMatch` lift to `path-utils.ts`) — commit `e8b467d8`.
