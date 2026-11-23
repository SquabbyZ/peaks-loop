import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { renderTemplate } from '../../../src/services/artifacts/artifact-templates.js';
import { allowedStatesForRole } from '../../../src/services/artifacts/request-artifact-state-helpers.js';
import { createRequestArtifact } from '../../../src/services/artifacts/request-artifact-service.js';
import { parseRole } from '../../../src/cli/commands/request-format-helpers.js';

declareDimensions('tests/unit/artifacts/design-role.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe('Scenario: behavior — the design role is a first-class request role', () => {
  it('when the role is parsed, should accept design', () => {
    // given: the CLI role parser
    // when: design is parsed
    // then: it is accepted
    expect(parseRole('design')).toBe('design');
  });

  it('when the state map is read, should allow the six design states', () => {
    // given: the state table
    // when: design states are read
    // then: the six lifecycle states are present
    expect(allowedStatesForRole('design')).toEqual([
      'draft',
      'spec-locked',
      'implemented',
      'qa-handoff',
      'handed-off',
      'blocked'
    ]);
  });

  it('when the template is rendered, should carry the five sections', () => {
    // given: a design request context
    // when: the template is rendered
    // then: every section heading is present
    const body = renderTemplate('design', 'rid-1', 'sid-1', 'slug', '2026-11-23T00:00:00.000Z', {
      requestType: 'feature',
      projectRoot: '/tmp/x'
    });
    for (const heading of [
      '## Scope',
      '## Contract status',
      '## Conformance',
      '## Changed paths',
      '## Acceptance'
    ]) {
      expect(body).toContain(heading);
    }
  });

  it('when a design artifact is created, should land under design/requests', async () => {
    // given: a bare project root
    // when: a design request is created
    // then: the artifact lands under design/requests with the contract section
    const root = mkdtempSync(join(tmpdir(), 'peaks-design-role-'));
    roots.push(root);
    const result = await createRequestArtifact({
      role: 'design',
      requestId: 'rid-1',
      projectRoot: root,
      sessionId: 'sid-1',
      apply: true
    });
    const normalized = result.path.replace(/\\/g, '/');
    expect(normalized).toContain('/design/requests/');
    expect(normalized.endsWith('rid-1.md')).toBe(true);
    expect(readFileSync(result.path, 'utf8')).toContain('## Contract status');
  });
});
