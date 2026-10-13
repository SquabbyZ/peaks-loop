// tests/unit/services/artifacts/_judged-declaration-fixture.ts
//
// The one file and the one hash the security-audit fixtures declare, so that a
// fixture tree satisfies the security artifact's declaration contract.
//
// A scan/fixture library, not a test file: no `.test.ts` suffix, so the unit
// config does not collect it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const JUDGED_FIXTURE_PATH = 'src/fixture-source.ts';
export const JUDGED_FIXTURE_BODY = 'export const fixture = 1;\n';
/** sha256 of JUDGED_FIXTURE_BODY, the bytes above. */
export const JUDGED_FIXTURE_SHA256 =
  '18fd5eff3fed9c8e3094fd0746f17ce3aafd22a9ac33f225ba961332066f98f2';

/** Lay the declared file down in a fixture project root. */
export function writeJudgedFixtureSource(projectRoot: string): void {
  const path = join(projectRoot, ...JUDGED_FIXTURE_PATH.split('/'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JUDGED_FIXTURE_BODY, 'utf8');
}

/** The declaration section every security-audit fixture body carries. */
export function judgedDeclarationSection(): string {
  const payload = {
    schemaVersion: 1,
    judgedAt: '2026-09-13T00:00:00.000Z',
    handoffHash: 'deadbeef',
    files: [{ path: JUDGED_FIXTURE_PATH, sha256: JUDGED_FIXTURE_SHA256 }],
    roots: []
  };
  return `\n## Judged content\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`;
}
