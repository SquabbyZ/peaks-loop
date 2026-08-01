// tests/unit/services/dispatch/e2e-fixtures.test.ts
//
// 4-dimension unit test for the pure qa/e2e fixtures reader in
// src/services/dispatch/e2e-fixtures.ts. The reader walks
// `qa/e2e/<scenario>/*.md` and emits a structured E2EPlan: empty
// when the directory is missing, disabled when a `disabled` file is
// present, fixtures otherwise.
//
// Dimensions covered:
//   - behavior:   missing dir / disabled file / parsed fixture
//   - integration: tmp dir + fs writes for the fixtures scenario
//   - render:     not applicable (returns structured data)
//   - a11y:       not applicable (no user-visible text)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

declareDimensions(
  'tests/unit/services/dispatch/e2e-fixtures.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'returns a structured E2EPlan, no text surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' },
  ],
);

import { readE2EPlan } from '~/src/services/dispatch/e2e-fixtures';

describe('behavior — plan shape', () => {
  it('returns empty for a missing directory', () => {
    const dir = join(tmpdir(), 'peaks-e2e-missing-' + Date.now());
    expect(readE2EPlan({ dir }).kind).toBe('empty');
  });

  it('returns disabled when disabled file is present', () => {
    const dir = join(tmpdir(), 'peaks-e2e-disabled-' + Date.now());
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'disabled'), '');
    expect(readE2EPlan({ dir }).kind).toBe('disabled');
  });
});

describe('integration — parsed fixtures', () => {
  it('returns fixtures with parsed url and matchers', () => {
    const dir = join(tmpdir(), 'peaks-e2e-fixtures-' + Date.now());
    mkdirSync(join(dir, 'login'), { recursive: true });
    writeFileSync(
      join(dir, 'login', 'happy.md'),
      ['# Login', 'url: http://localhost:3000/login', 'matchers:', '  - "Welcome"', '  - "[data-testid=submit]"'].join('\n'),
    );
    const plan = readE2EPlan({ dir });
    expect(plan.kind).toBe('fixtures');
    if (plan.kind === 'fixtures') {
      expect(plan.fixtures).toHaveLength(1);
      expect(plan.fixtures[0]?.url).toBe('http://localhost:3000/login');
      expect(plan.fixtures[0]?.matchers.length).toBeGreaterThan(0);
    }
  });
});