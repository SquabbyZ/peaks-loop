import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import {
  buildAuditReport,
  renderAuditJson
} from '../../../src/services/design/audit/audit-report.js';

declareDimensions('tests/unit/design/audit-report-json.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const TREE = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit'),
  'three-page-tree'
);
const META = { appRoot: 'three-page-tree', rid: 'r7', generatedAt: '2026-11-25T00:00:00.000Z' };

function report() {
  const result = runAuditProject({ appRoot: TREE });
  if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
  return buildAuditReport(result);
}

describe('Scenario: behavior — the JSON sibling sanitises every file field', () => {
  it('when a page path carries an ESC sequence, should strip it from the JSON sibling', () => {
    // given: a page path, a finding file and an unmeasured file poisoned with ESC
    // when: the JSON document is rendered
    // then: no raw ESC and no escaped control sequence reaches a persisted field
    const base = report();
    const poisoned = {
      ...base,
      pages: base.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              path: 'pages/e\u001b[2J.tsx',
              findings: page.findings.map((finding) => ({ ...finding, file: 'x\u001b[31m' }))
            }
          : page
      ),
      data: {
        ...base.data,
        unmeasured: base.data.unmeasured.map((item, index) =>
          index === 0 ? { ...item, file: 'gap\u001b[2J' } : item
        )
      }
    };
    const json = JSON.stringify(renderAuditJson(poisoned, META));
    expect(json).not.toContain('\u001b');
    expect(json).not.toContain('\\u001b');
  });

  it('when no capture was supplied, should render the empty render evidence', () => {
    // given: a report from a tree with no captures
    // when: the JSON document is rendered
    // then: the render block is present, empty and explicit about coverage
    const document = renderAuditJson(report(), META);
    expect(document.render).toMatchObject({
      captures: [],
      gap: null,
      pageUnits: 3,
      pagesWithoutCapture: 3
    });
  });
});
