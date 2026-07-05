# Doctor check catalog (peaks-doctor skill reference)

Slice L3.2 ships 69 doctor checks. The most user-relevant ones:

## L2 audit (slice #2)

- **`L2:audit:cli-backed`** — count of red lines whose catalog match has a real enforcer
- **`L2:audit:prose-only`** — count of red lines that need a future enforcer

## L3.2 (slice #9)

- **`L3:l3-orphan-sessions`** — directories in `.peaks/_runtime/` that fail `isValidSessionId`. Recover with `peaks workspace clean`.
- **`L3:l3-memory-health`** — `.peaks/memory/index.json` must be well-formed JSON with a `schema_version` field and an array `entries`. Recovers by re-running `peaks memory extract`.

## Build / workspace

- **`build:dist-version-matches-source`** — `dist/src/shared/version.js` matches the source `package.json` version
- **`build:workspace-layout-canonical`** — `.peaks/` follows the canonical `._archive` / `_runtime` / `_sub_agents` layout
- **`build:workspace-migrate-not-needed`** — when the layout is already canonical

## Integration (third-party hooks)

- **`integration:gateguard-peaks-conflict`** — warns when `gateguard-fact-force` is installed without a `.peaks/**` skip pattern (the 3rd-party hook would block all peaks-qa .peaks/ artifact writes)

## Skills

- **`skill:<required-skill>`** — each required skill (peaks-ide, peaks-prd, peaks-rd, peaks-qa, peaks-sc, peaks-code, peaks-sop, peaks-txt, peaks-ui, peaks-doctor) must be installed in the bundled skills dir

## Doctor self

- **`doctor-self:check-id-pattern`** — all check IDs match the `doctor-report.schema.json` regex pattern (prevents typos like `L3:l3-orphan-sesions`)
