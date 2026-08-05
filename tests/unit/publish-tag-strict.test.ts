// tests/unit/publish-tag-strict.test.ts
//
// Drift guard for the strict vX.Y.Z tag-format gate added to
// `.github/workflows/publish.yml` on 2026-08-05 (slice 1 of
// `.peaks/_runtime/2026-08-04-session-3fe1be/prd/requests/
// 2026-08-05-four-optimizations.md`).
//
// Why this test file exists:
//   The `on.push.tags: ['v*.*.*']` matcher uses GLOB semantics and lets
//   `v4.0.11-rc1` / `v4.0.11+sha` / future 4-segment tags through. The
//   fail-closed point is the `gate-strict-tag-format` step right after
//   `Checkout`, which runs a bash regex check (`^v[0-9]+\.[0-9]+\.[0-9]+$`)
//   against the exact HEAD tag via `git describe --tags --exact-match HEAD`.
//   This test asserts the regex literal is present in the workflow yaml AND
//   the step is positioned BEFORE the `Publish to npm` step so the gate runs
//   before any publish work.
//
// Dimensions covered:
//   - render:    workflow yaml string contains the regex literal
//   - behavior:  step order (gate precedes the npm publish step)
//   - integration: n/a (file-system read of a checked-in asset)
//   - a11y:      n/a (yaml drift guard)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKFLOW_PATH = resolve(
  __dirname,
  '../../.github/workflows/publish.yml',
);

describe('publish.yml strict vX.Y.Z tag gate (slice 2026-08-05-publish-tag-strict)', () => {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf8');

  it('contains the strict vX.Y.Z regex literal', () => {
    expect(yaml).toContain('^v[0-9]+\\.[0-9]+\\.[0-9]+$');
  });

  it('emits the strict-tag-format ::error title on mismatch', () => {
    expect(yaml).toContain('::error title=strict-tag-format::');
  });

  it('positions the strict-tag gate BEFORE the Publish to npm step', () => {
    const gateIndex = yaml.indexOf('Strict vX.Y.Z tag format gate');
    const publishIndex = yaml.indexOf('Publish to npm (OIDC + scripts/release-pack.mjs)');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(publishIndex);
  });

  it('uses git describe --tags --exact-match HEAD to fetch the tag', () => {
    expect(yaml).toContain('git describe --tags --exact-match HEAD');
  });
});