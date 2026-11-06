---
name: a-brand-new-npm-package-cannot-be-first-published-through-oidc-trusted-publishing
description: A brand-new npm package cannot be first-published through OIDC trusted publishing
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-11-05-session-af31e4/txt/handoff-release.md
---

The tag-triggered release flow publishes with OIDC Trusted Publishing (no token). That works only
for packages that already exist on the registry and have the repo configured as a trusted
publisher. A NEW package name gets `404 Not Found - PUT https://registry.npmjs.org/<new-name>` and
`release-pack.mjs` aborts — and because it publishes in topological order, NOTHING else lands
either (verified: all six versions still 404 afterwards). Break the chicken-and-egg with a one-time
interactive `npm login` + `pnpm publish --access public` in the package directory, then register
the trusted publisher on npmjs.com. Do this BEFORE tagging a release that introduces a new package,
otherwise the whole release aborts after CI has already gone green.

**The recovery worked and is worth copying (measured 2026-11-06, release 4.2.0):** after the
operator published the new package once and bound the trusted publisher, `gh run rerun <id> --failed`
on the SAME failed run republished everything. Do NOT cut a new tag for the retry — the same tag
and commit are correct. `release-pack.mjs` prints `SKIP <name>@<version> (already on registry)` for
the manually published package, so nothing is published twice. Two timing facts: the release-pack
step prints `[release-pack] OK peaks-loop@<v>` and the job goes green while
`https://registry.npmjs.org/peaks-loop/<v>` still 404s — propagation took ~150 s here, so poll the
version URL until 200 before declaring failure or success. And `npx -y peaks-loop@<v> --version`
can print a DIFFERENT (older) version because it may resolve an existing install; verify by
installing the published package into an empty directory and running
`node node_modules/peaks-loop/bin/peaks.js --version`.
