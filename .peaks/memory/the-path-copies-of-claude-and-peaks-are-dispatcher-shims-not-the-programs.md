---
name: the-path-copies-of-claude-and-peaks-are-dispatcher-shims-not-the-programs
description: The PATH copies of claude and peaks are dispatcher shims, not the programs
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-round2.md
---

**On this machine the executables on PATH are 546 KB dispatcher shims, and the real programs live
elsewhere.** Measured 2026-10-22.

- `nvm/.nodejs/peaks.exe`, `bun.exe`, `claude.exe`, `npm.exe`, `pnpm.exe`, `yarn.exe` are all
  **byte-identical** (sha256 `fb4256ea5f2f7a3c…`, 546,088 bytes) — one generic shim that looks up
  the real executable by name. **Their file dates are the dates the SHIMS were written, and say
  nothing about the installed program.** Reading "the global peaks is 18 days stale" from that
  date was wrong: the npm global package had been refreshed that same day.
- **The real Claude Code binary is**
  `nvm/installs/<version>/node_modules/@anthropic-ai/claude-code/bin/claude.exe` — **297 MB**, with
  its embedded JavaScript in **plain text**, so greppable for hook payload keys, schemas and
  construction sites. The 546 KB shim has **no** program strings in it, so a grep against it
  returns nothing and reads as "the behaviour is not there".
- **The real peaks is** the npm global package under `nvm/installs/<version>/node_modules/peaks-loop`;
  its `bin/peaks.js` runs the **published** build, so it is the right thing to measure a
  published version and the wrong thing to measure uncommitted source.

**How to apply:** before concluding that a tool "does not do X" because its strings are not there,
find the real payload. For a release, verify the published tarball rather than the packument.

Related: [[the-peaks-on-path-is-a-ten-day-old-binary]]
