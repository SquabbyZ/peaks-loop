import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { scanOpenSpec } from '../../src/services/openspec/openspec-scan-service.js';
import { projectOpenSpecToRdInput } from '../../src/services/openspec/openspec-bridge-service.js';
import { validateOpenSpecChange } from '../../src/services/openspec/openspec-validate-service.js';

const PROJECT_OPENSPEC = join(process.cwd(), 'openspec');

describe('dogfood: real openspec/changes/* must satisfy the Peaks OpenSpec gates', () => {
  test('scan returns at least one real change pack', async () => {
    const report = await scanOpenSpec({ openspecRoot: PROJECT_OPENSPEC });

    expect(report.exists).toBe(true);
    expect(report.changes.length).toBeGreaterThanOrEqual(1);
  });

  test('every real change pack passes internal validation with no error-level issues', async () => {
    const report = await scanOpenSpec({ openspecRoot: PROJECT_OPENSPEC });

    for (const change of report.changes) {
      const result = await validateOpenSpecChange(change.id, { openspecRoot: PROJECT_OPENSPEC });
      const errors = result?.issues.filter((issue) => issue.level === 'error') ?? [];
      expect.soft(result?.valid, `change ${change.id} should pass validation; issues=${JSON.stringify(errors)}`).toBe(true);
    }
  });

  test('every real change pack projects to an RD input with non-empty acceptance', async () => {
    const report = await scanOpenSpec({ openspecRoot: PROJECT_OPENSPEC });

    for (const change of report.changes) {
      const projection = await projectOpenSpecToRdInput(change.id, { openspecRoot: PROJECT_OPENSPEC });

      expect.soft(projection, `change ${change.id} should project to an RD input`).not.toBeNull();
      expect.soft(projection?.acceptance.length, `change ${change.id} should have non-empty acceptance`).toBeGreaterThan(0);
    }
  });

  test('every real change pack with tasks.md exposes at least one commit boundary', async () => {
    const report = await scanOpenSpec({ openspecRoot: PROJECT_OPENSPEC });

    for (const change of report.changes) {
      if (change.paths.tasks === null) {
        continue;
      }
      const projection = await projectOpenSpecToRdInput(change.id, { openspecRoot: PROJECT_OPENSPEC });

      expect.soft(projection?.commitBoundaries.length, `change ${change.id} has tasks.md but no commit boundaries`).toBeGreaterThan(0);
    }
  });
});
