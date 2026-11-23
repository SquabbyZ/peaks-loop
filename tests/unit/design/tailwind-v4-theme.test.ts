import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { scanExistingSystem } from '../../../src/services/scan/existing-system-service.js';

declareDimensions('tests/unit/design/tailwind-v4-theme.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeWebApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-v4-'));
  roots.push(root);
  mkdirSync(join(root, 'web', 'src', 'styles'), { recursive: true });
  writeFileSync(
    join(root, 'web', 'package.json'),
    JSON.stringify({ dependencies: { react: '19.0.0', tailwindcss: '4.3.2' } }),
    'utf8'
  );
  writeFileSync(join(root, 'web', 'src', 'main.tsx'), 'export {}', 'utf8');
  // A shipped app carries a stale lockfile; without one this one-file app is
  // archetype=greenfield and the scanner short-circuits before reading styles.
  const lockfile = join(root, 'web', 'pnpm-lock.yaml');
  writeFileSync(lockfile, 'lockfileVersion: 9.0\n', 'utf8');
  const stale = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  utimesSync(lockfile, stale, stale);
  writeFileSync(
    join(root, 'web', 'src', 'styles', 'theme.css'),
    "@import 'tailwindcss';\n@theme {\n  --color-primary: oklch(0.53 0.07 156);\n  --spacing-4: 1rem;\n  --radius-md: 0.5rem;\n  --font-sans: 'Public Sans', sans-serif;\n}\n",
    'utf8'
  );
  return root;
}

describe('Scenario: integration — Tailwind v4 @theme tokens', () => {
  it('when the scan is scoped to the app root, should capture @theme tokens and tag the source', async () => {
    // given: a Tailwind v4 app under web/
    // when: the scan runs against the app root
    // then: the tokens are present and the source is theme-file
    const root = makeWebApp();
    const report = await scanExistingSystem({ projectRoot: join(root, 'web') });
    expect(report.visualTokens.colors.map((t) => t.name)).toContain('--color-primary');
    expect(report.visualTokens.spacing.map((t) => t.name)).toContain('--spacing-4');
    expect(report.visualTokens.radii.map((t) => t.name)).toContain('--radius-md');
    expect(report.visualTokens.sources).toContainEqual({
      path: 'src/styles/theme.css',
      kind: 'theme-file'
    });
  });

  it('when the scan is scoped to the repo root, should find no web tokens', async () => {
    // given: the same mixed repo
    // when: the scan runs at the repo root
    // then: it does not silently claim the web tokens
    const root = makeWebApp();
    const report = await scanExistingSystem({ projectRoot: root });
    expect(report.visualTokens.colors.map((t) => t.name)).not.toContain('--color-primary');
  });
});
