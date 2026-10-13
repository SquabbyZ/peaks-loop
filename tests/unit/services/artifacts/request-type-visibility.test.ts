// tests/unit/services/artifacts/request-type-visibility.test.ts
//
// rid=request-type-is-visible-and-changeable.
//
// The defect: a request artifact that records no `- type:` line was silently
// gated by the `feature` table, and nothing on any surface said so. The input
// every red-direction case below is built from is therefore a request with NO
// recorded type — never a shorthand for one.
//
// Dimensions covered:
//   - render:      the shape `extractMetadata` and `describeRetag` produce
//   - behavior:    the table a type selects, the delta a change makes
//   - integration: a real artifact on disk, read, retagged, and re-read
//   - a11y:        the sentences a human sees when the type was a default or
//                  when a retag demands artifacts that are not on disk

import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import {
  getPrerequisitesFor,
  type RequestType
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { extractMetadata } from '../../../../src/services/artifacts/request-artifact-metadata.js';
import { demandDelta, demandRows } from '../../../../src/services/artifacts/request-type-demand.js';
import {
  appendRetagNote,
  describeRetag,
  retagRequestArtifact,
  setRequestTypeInBody
} from '../../../../src/services/artifacts/request-retag-service.js';
import {
  createRequestArtifact,
  showRequestArtifact
} from '../../../../src/services/artifacts/request-artifact-service.js';
import { typeProvenanceWarning } from '../../../../src/cli/commands/request-show-command.js';

declareDimensions('tests/unit/services/artifacts/request-type-visibility.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = 'test-session';
const RID = '2026-10-13-typeless';
const TS = '2026-10-13T00:00:00.000Z';
/** Every role whose template carries a metadata block — i.e. every role. */
const ROLES = ['prd', 'ui', 'rd', 'qa', 'sc'] as const;

/**
 * A hand-written carrier: the shape the defect was measured on, with no
 * `- state:` line and no `- type:` line. Every red-direction case starts here.
 */
function typelessCarrier(): string {
  return `# RD Request ${RID}\n\n- linked-prd: prd/requests/${RID}.md\n\n## Slice contract\n\n- one boundary\n`;
}

const FEATURE_QA_HANDOFF = 'rd:qa-handoff';

function writeCarrier(wsPath: string, body: string): string {
  const path = join(wsPath, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', `001-${RID}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
  return path;
}

describe('Scenario: render — what a reader is told about the type', () => {
  it('when the body records no type, should name the effective type AND its provenance', () => {
    const metadata = extractMetadata(typelessCarrier());
    expect(metadata.requestType).toBe('feature');
    expect(metadata.requestTypeSource).toBe('default');
  });

  it('when the body records a type, should report it as declared — the control arm', () => {
    const metadata = extractMetadata(
      `# RD Request x\n\n- session: s\n- type: chore\n- state: draft\n`
    );
    expect(metadata.requestType).toBe('chore');
    expect(metadata.requestTypeSource).toBe('declared');
  });

  it('when the recorded type is a placeholder, should fall back AND say the fallback applied', () => {
    const metadata = extractMetadata(
      '# RD Request x\n\n- type: feature | bug | refactor | clarification\n'
    );
    expect(metadata.requestType).toBe('feature');
    expect(metadata.requestTypeSource).toBe('default');
  });
});

describe('Scenario: behavior — which table a type selects', () => {
  it('when the type is a default, should still be the table that gates the request', () => {
    // The provenance label is not decoration: the type it reports is the one
    // the refusal below is built from.
    const effective: RequestType = extractMetadata(typelessCarrier()).requestType;
    expect(getPrerequisitesFor('rd', 'qa-handoff', effective).length).toBe(9);
    expect(getPrerequisitesFor('rd', 'qa-handoff', 'chore').length).toBe(0);
  });

  it('when feature gives way to chore, should report the FEATURE_TABLE artifacts as no longer demanded', () => {
    const delta = demandDelta('feature', 'chore');
    expect(delta.added).toStrictEqual([]);
    expect(delta.removed).toContain('rd/code-review-<rid>.md');
    expect(delta.removed).toContain('rd/karpathy-review-<rid>.md');
    expect(delta.removed).toContain('mut/mut-report.json');
  });

  it('when chore gives way to feature, should report the same artifacts as newly demanded', () => {
    const delta = demandDelta('chore', 'feature');
    expect(delta.removed).toStrictEqual([]);
    expect(delta.added).toContain('rd/code-review-<rid>.md');
  });

  it('when the type demands nothing past the PRD, should report only that one row', () => {
    expect(demandRows('chore').map((row) => `${row.role}:${row.state}`)).toStrictEqual([
      'prd:handed-off'
    ]);
    expect(demandRows('docs')).toStrictEqual(demandRows('chore'));
    expect(demandRows('feature').map((row) => `${row.role}:${row.state}`)).toContain(
      FEATURE_QA_HANDOFF
    );
  });

  it('when a type line exists, should rewrite the line the reader would take', () => {
    const body = `# RD Request x\n\n- session: s\n- type: docs\n- state: draft\n`;
    const updated = setRequestTypeInBody(body, 'chore');
    expect(updated).toContain('- type: chore');
    expect(updated).not.toContain('- type: docs');
    expect(updated.split(/\r?\n/).length).toBe(body.split(/\r?\n/).length);
  });

  it('when the body uses CRLF, should name the only other edit it makes instead of claiming none', () => {
    const crlf = '# RD Request x\r\n\r\n- session: s\r\n- type: docs\r\n- state: draft\r\n';
    const updated = setRequestTypeInBody(crlf, 'chore');
    expect(updated).toContain('- type: chore');
    // The docstring says "the line the reader would take"; this is the one other
    // change, and it is asserted rather than denied.
    expect(updated).not.toContain('\r');
  });

  it('when a retag note is appended, should leave every earlier note in place', () => {
    const twice = appendRetagNote(
      appendRetagNote(
        '# RD Request x\n\n- type: docs\n',
        { from: 'docs', fromSource: 'declared', to: 'config' },
        TS
      ),
      { from: 'config', fromSource: 'declared', to: 'chore' },
      '2026-10-13T01:00:00.000Z'
    );
    expect(twice).toContain(`- retag note (${TS}): docs (declared) -> config`);
    expect(twice).toContain('- retag note (2026-10-13T01:00:00.000Z): config (declared) -> chore');
    // Appending must not create a second type line the reader would have to choose between.
    expect(twice.match(/^-\s*type:/gm)).toHaveLength(1);
  });

  it('when no type line exists, should insert one into the metadata block without reflowing the rest', () => {
    const body = typelessCarrier();
    const updated = setRequestTypeInBody(body, 'chore');
    const lines = updated.split(/\r?\n/);
    expect(lines.indexOf('- type: chore')).toBe(2);
    expect(updated).toContain(`- linked-prd: prd/requests/${RID}.md`);
    expect(extractMetadata(updated).requestType).toBe('chore');
    expect(extractMetadata(updated).requestTypeSource).toBe('declared');
  });
});

describe('Scenario: integration — a real artifact, read, retagged, re-read', () => {
  const ws = withTmpWorkspacePerTest('peaks-retag-');

  async function check(requestType: RequestType): Promise<{
    ok: boolean;
    missing: string[];
    warnings: string[];
  }> {
    const { checkPrerequisites } =
      await import('../../../../src/services/artifacts/artifact-prerequisites.js');
    const result = await checkPrerequisites({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: RID,
      requestType,
      emitEvents: false
    });
    return {
      ok: result.ok,
      missing: result.missing.map((entry) => entry.path),
      warnings: result.warnings.map((entry) => entry.path)
    };
  }

  // The slice's central invariant, asserted against the writer's REAL output.
  // Reintroducing `options.requestType ?? DEFAULT_REQUEST_TYPE` in
  // `createRequestArtifact` makes every case in this block fail.
  describe('request init with no --type — the arm the central invariant needs', () => {
    for (const role of ROLES) {
      it(`when request init runs for ${role} with no --type, should write no type line at all`, async () => {
        const created = await createRequestArtifact({
          role,
          requestId: RID,
          projectRoot: ws().path,
          sessionId: SESSION_ID,
          apply: true
        });
        expect(created.content).not.toMatch(/^-\s*type:/m);
        const metadata = extractMetadata(created.content);
        expect(metadata.requestType).toBe('feature');
        expect(metadata.requestTypeSource).toBe('default');
      });
    }

    it('when request init runs with no --type, should read the default back off disk', async () => {
      await createRequestArtifact({
        role: 'rd',
        requestId: RID,
        projectRoot: ws().path,
        sessionId: SESSION_ID,
        apply: true
      });
      const shown = await showRequestArtifact({
        projectRoot: ws().path,
        role: 'rd',
        requestId: RID,
        sessionId: SESSION_ID
      });
      expect(shown?.requestTypeSource).toBe('default');
    });

    it('when request init IS given a type, should write it and read it back as declared — the control', async () => {
      const created = await createRequestArtifact({
        role: 'rd',
        requestId: RID,
        projectRoot: ws().path,
        sessionId: SESSION_ID,
        apply: true,
        requestType: 'chore'
      });
      expect(created.content).toMatch(/^-\s*type: chore$/m);
      const shown = await showRequestArtifact({
        projectRoot: ws().path,
        role: 'rd',
        requestId: RID,
        sessionId: SESSION_ID
      });
      expect(shown?.requestType).toBe('chore');
      expect(shown?.requestTypeSource).toBe('declared');
    });
  });

  it('when a retag runs twice, should leave a durable note in the artifact that the second one preserves', async () => {
    await createRequestArtifact({
      role: 'rd',
      requestId: RID,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true,
      requestType: 'feature'
    });
    const first = await retagRequestArtifact({
      projectRoot: ws().path,
      role: 'rd',
      requestId: RID,
      sessionId: SESSION_ID,
      requestType: 'chore',
      clock: () => TS
    });
    const second = await retagRequestArtifact({
      projectRoot: ws().path,
      role: 'rd',
      requestId: RID,
      sessionId: SESSION_ID,
      requestType: 'config',
      clock: () => '2026-10-13T01:00:00.000Z'
    });
    const onDisk = readFileSync(second?.path ?? '', 'utf8');
    expect(first?.note).toBe(`- retag note (${TS}): feature (declared) -> chore`);
    expect(onDisk).toContain(`- retag note (${TS}): feature (declared) -> chore`);
    expect(onDisk).toContain('- retag note (2026-10-13T01:00:00.000Z): chore (declared) -> config');
    // The notes must not become a second type line the reader has to choose between.
    expect(onDisk.match(/^-\s*type:/gm)).toHaveLength(1);
    expect(extractMetadata(onDisk).requestType).toBe('config');
  });

  it('when an artifact records no type, should read the default through the product surface', async () => {
    writeCarrier(ws().path, typelessCarrier());
    const shown = await showRequestArtifact({
      projectRoot: ws().path,
      role: 'rd',
      requestId: RID,
      sessionId: SESSION_ID
    });
    expect(shown?.requestType).toBe('feature');
    expect(shown?.requestTypeSource).toBe('default');
  });

  it('when a retag runs feature -> chore on one rid, should stop demanding the FEATURE_TABLE artifacts', async () => {
    await createRequestArtifact({
      role: 'rd',
      requestId: RID,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true,
      requestType: 'feature'
    });
    const before = await check('feature');
    expect(before.ok).toBe(false);
    // Nine entries are demanded at this row and two of them are inside a
    // back-compat window, so they warn rather than fail: 7 hard, 2 soft.
    expect(before.missing.length + before.warnings.length).toBe(9);
    expect(before.warnings).toHaveLength(2);

    const retagged = await retagRequestArtifact({
      projectRoot: ws().path,
      role: 'rd',
      requestId: RID,
      sessionId: SESSION_ID,
      requestType: 'chore'
    });

    const after = await check(retagged?.change.to ?? 'feature');
    expect(after.ok).toBe(true);
    expect(after.missing).toStrictEqual([]);
    expect(after.warnings).toStrictEqual([]);
    expect(retagged?.change.from).toBe('feature');
    expect(retagged?.change.to).toBe('chore');
    expect(retagged?.impact.removed).toContain('rd/code-review-<rid>.md'.replace('<rid>', RID));
    expect(readFileSync(retagged?.path ?? '', 'utf8')).toContain('- type: chore');
  });

  it('when the record was a default and the retag names the SAME type, should still report the unmet demands', async () => {
    // The red-direction input again, and the case a delta-only answer would miss:
    // nothing about the demand set changes, so there is no "newly demanded"
    // artifact to point at — only nine unmet ones.
    writeCarrier(ws().path, typelessCarrier());
    const retagged = await retagRequestArtifact({
      projectRoot: ws().path,
      role: 'rd',
      requestId: RID,
      sessionId: SESSION_ID,
      requestType: 'feature'
    });
    expect(retagged?.change.fromSource).toBe('default');
    expect(retagged?.impact.added).toStrictEqual([]);
    expect(retagged?.impact.missing).toContain(`rd/code-review-${RID}.md`);
    expect(retagged?.impact.missing).toContain(`rd/karpathy-review-${RID}.md`);
  });

  it('when a retag tightens the table, should name the artifacts the tree does not have', async () => {
    await createRequestArtifact({
      role: 'rd',
      requestId: RID,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true,
      requestType: 'chore'
    });
    const retagged = await retagRequestArtifact({
      projectRoot: ws().path,
      role: 'rd',
      requestId: RID,
      sessionId: SESSION_ID,
      requestType: 'feature'
    });
    expect(retagged?.change).toStrictEqual({
      from: 'chore',
      fromSource: 'declared',
      to: 'feature'
    });
    expect(retagged?.impact.added).toContain('rd/code-review-<rid>.md'.replace('<rid>', RID));
    expect(retagged?.impact.missing).toContain(`rd/code-review-${RID}.md`);
  });

  it('when the rid does not resolve, should report nothing rather than inventing a result', async () => {
    const missing = await retagRequestArtifact({
      projectRoot: ws().path,
      role: 'rd',
      requestId: 'never-written',
      sessionId: SESSION_ID,
      requestType: 'chore'
    });
    expect(missing).toBeNull();
  });
});

describe('Scenario: a11y — the sentences a human gets', () => {
  it('when the read type was a default, should say so in words', async () => {
    const [line] = typeProvenanceWarning({
      role: 'rd',
      sessionId: SESSION_ID,
      requestId: RID,
      path: 'x.md',
      state: 'draft',
      requestType: 'feature',
      requestTypeSource: 'default',
      content: ''
    });
    expect(line).toContain('DEFAULT');
    expect(line).toContain('feature');
  });

  it('when the type was declared, should say nothing extra', () => {
    const lines = typeProvenanceWarning({
      role: 'rd',
      sessionId: SESSION_ID,
      requestId: RID,
      path: 'x.md',
      state: 'draft',
      requestType: 'chore',
      requestTypeSource: 'declared',
      content: ''
    });
    expect(lines).toStrictEqual([]);
  });

  it('when a retag leaves a demand unsatisfied, should name the artifacts and the reason', () => {
    const lines = describeRetag({
      role: 'rd',
      sessionId: SESSION_ID,
      requestId: RID,
      path: 'x.md',
      content: '',
      change: { from: 'feature', fromSource: 'default', to: 'chore' },
      note: '',
      impact: {
        added: [`rd/code-review-${RID}.md`],
        removed: [],
        missing: [`rd/code-review-${RID}.md`]
      }
    });
    expect(lines[0]).toContain('was the default');
    expect(lines.join('\n')).toContain('now demanded');
    expect(lines.join('\n')).toContain('not on disk');
    expect(lines.join('\n')).toContain(`rd/code-review-${RID}.md`);
  });

  it('when a retag only removes demands, should say that too', () => {
    const lines = describeRetag({
      role: 'rd',
      sessionId: SESSION_ID,
      requestId: RID,
      path: 'x.md',
      content: '',
      change: { from: 'feature', fromSource: 'declared', to: 'chore' },
      note: '',
      impact: { added: [], removed: ['rd/code-review-<rid>.md'], missing: [] }
    });
    expect(lines.join('\n')).toContain('no longer demanded');
  });
});
