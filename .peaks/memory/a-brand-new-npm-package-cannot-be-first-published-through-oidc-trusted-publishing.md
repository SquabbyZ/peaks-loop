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
