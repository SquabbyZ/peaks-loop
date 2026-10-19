// tests/unit/services/artifacts/qa-initiated-marker.test.ts
//
// Guards the in-order path for `qa/.initiated` (backlog §10.4). Before this
// verb, `createRequestArtifact` wrote the marker only as a side effect of
// `peaks request init --role qa`, and init refuses as soon as
// `qa/requests/<rid>.md` exists. A QA role that wrote its artifact first was
// therefore stuck between deleting a real artifact and hand-creating the
// marker; `rd:qa-handoff` refuses without it.
//
// The assertions are behavioral: the marker exists AND the real
// `checkPrerequisites` clears (seeded complete except for the marker), a
// second call leaves existing bytes alone, and the artifact is byte-identical
// before and after every arm.
//
// Dimensions:
//   - render:      the CLI envelope's `created` field
//   - behavior:    marker created / refusal when the artifact is absent
//   - integration: the real `.peaks/_runtime/<sid>/` tree, existing marker bytes
//   - a11y:        refusal code, message, and exit code

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { parseCliEnvelope } from '~/src/cli/cli-envelope';
import { registerRequestMarkQaInitiatedCommand } from '~/src/cli/commands/request-mark-qa-initiated-command';
import { createRequestArtifact } from '~/src/services/artifacts/request-artifact-service';
import {
  makeProjectRoot,
  missingPaths,
  RID_A,
  seedCompleteSlice,
  SESSION_ID,
  sessionRootOf,
  tempRoots,
  writeArtifact
} from './_audit-artifact-rid-fixtures.js';

declareDimensions('tests/unit/services/artifacts/qa-initiated-marker.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** Seed the complete rd:qa-handoff set, add the QA request artifact, drop the marker. */
function seedStuckSession(): string {
  const projectRoot = makeProjectRoot();
  seedCompleteSlice(projectRoot, RID_A);
  writeArtifact(
    projectRoot,
    `qa/requests/${RID_A}.md`,
    '# QA request\n\n- state: draft\n\n## Goal\n\nVerify the marker path.\n'
  );
  rmSync(markerPath(projectRoot), { force: true });
  return projectRoot;
}

function markerPath(projectRoot: string): string {
  return join(sessionRootOf(projectRoot), 'qa', '.initiated');
}

function artifactPath(projectRoot: string): string {
  return join(sessionRootOf(projectRoot), 'qa', 'requests', `${RID_A}.md`);
}

async function runMark(
  projectRoot: string,
  args: string[] = []
): Promise<ReturnType<typeof makeCapturedIo>['captured']> {
  const program = new Command();
  const { io, captured } = makeCapturedIo();
  registerRequestMarkQaInitiatedCommand(program, io);
  await program.parseAsync(
    ['mark-qa-initiated', RID_A, '--project', projectRoot, '--json', ...args],
    { from: 'user' }
  );
  return captured;
}

afterEach(() => {
  process.exitCode = undefined;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('(behavior) mark-qa-initiated', () => {
  it('when the QA artifact exists and the marker is absent, should create the marker and clear the rd:qa-handoff prerequisite', async () => {
    // given: a complete slice whose only missing prerequisite is the marker
    const projectRoot = seedStuckSession();
    const artifactBefore = readFileSync(artifactPath(projectRoot), 'utf8');

    const captured = await runMark(projectRoot);

    // then: the marker exists, is empty, and the real gate now passes
    expect(existsSync(markerPath(projectRoot))).toBe(true);
    expect(readFileSync(markerPath(projectRoot), 'utf8')).toBe('');
    expect((await missingPaths(projectRoot, RID_A)).ok).toBe(true);
    // and: the request artifact is byte-identical — this verb never rewrites it
    expect(readFileSync(artifactPath(projectRoot), 'utf8')).toBe(artifactBefore);
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
    expect(parseCliEnvelope(captured.text().trim()).ok).toBe(true);
  });

  it('when the QA artifact is absent, should refuse rather than write a marker that asserts QA ran', async () => {
    // given: a session with no qa/requests/<rid>.md
    const projectRoot = makeProjectRoot();

    const captured = await runMark(projectRoot);

    const envelope = parseCliEnvelope(captured.text().trim());
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('QA_ARTIFACT_MISSING');
    expect(existsSync(markerPath(projectRoot))).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

describe('(render) mark-qa-initiated', () => {
  it('when called twice, should report created=true first and created=false on the repeat', async () => {
    const projectRoot = seedStuckSession();

    const first = parseCliEnvelope((await runMark(projectRoot)).text().trim());
    const second = parseCliEnvelope((await runMark(projectRoot)).text().trim());

    expect(first.data.created).toBe(true);
    expect(second.data.created).toBe(false);
    expect(second.data.requestId).toBe(RID_A);
    expect(second.data.sessionId).toBe(SESSION_ID);
  });
});

describe('(integration) mark-qa-initiated', () => {
  it('when the marker already carries bytes, should leave them untouched — idempotence keeps the bytes it found', async () => {
    const projectRoot = seedStuckSession();
    writeFileSync(markerPath(projectRoot), 'sentinel\n', 'utf8');

    const captured = await runMark(projectRoot);

    expect(parseCliEnvelope(captured.text().trim()).ok).toBe(true);
    expect(readFileSync(markerPath(projectRoot), 'utf8')).toBe('sentinel\n');
  });

  it('when the artifact is absent, should leave request init unchanged: it creates the artifact and the marker together', async () => {
    const projectRoot = makeProjectRoot();

    await createRequestArtifact({
      role: 'qa',
      requestId: RID_A,
      projectRoot,
      sessionId: SESSION_ID,
      apply: true
    });

    // `request init` writes the numbered filename; the reader strips the prefix.
    const written = readdirSync(join(sessionRootOf(projectRoot), 'qa', 'requests'));
    expect(written.some((file) => file.endsWith(`${RID_A}.md`))).toBe(true);
    expect(existsSync(markerPath(projectRoot))).toBe(true);
  });
});

describe('(a11y) mark-qa-initiated', () => {
  it('when the artifact is missing, should name the artifact and the init command that creates it', async () => {
    const projectRoot = makeProjectRoot();

    const envelope = parseCliEnvelope((await runMark(projectRoot)).text().trim());

    expect(process.exitCode).toBe(1);
    expect(String(envelope.message)).toContain(RID_A);
    expect((envelope.nextActions ?? []).join('\n')).toContain('peaks request init --role qa');
  });
});
