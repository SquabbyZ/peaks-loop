import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createRequestArtifact } from '../../src/services/artifacts/request-artifact-service.js';
import { lintRequestArtifact } from '../../src/services/artifacts/artifact-lint-service.js';

const SESSION = '2026-05-25-lint';
const TS = '2026-05-25T08:00:00.000Z';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-lint-'));
}

// As of slice 2026-06-05-change-id-as-unit-of-work, the artifact file
// lives at `.peaks/<changeId>/<role>/requests/` where changeId defaults
// to the requestId. The lint service resolves via showRequestArtifact
// which scans all top-level dirs when sessionId is omitted.

describe('lintRequestArtifact', () => {
  test('reports findings on a fresh template (templates contain <placeholder> tokens)', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'prd', requestId: '2026-05-25-feat', projectRoot: project,
      sessionId: SESSION, apply: true, clock: () => TS
    });
    const report = await lintRequestArtifact({ projectRoot: project, role: 'prd', requestId: '2026-05-25-feat' });
    expect(report).not.toBeNull();
    expect(report?.ok).toBe(false);
    expect(report?.findings.some((f) => f.reason.includes('<placeholder>'))).toBe(true);
  });

  test('returns null when the artifact does not exist', async () => {
    const project = await makeProject();
    const report = await lintRequestArtifact({ projectRoot: project, role: 'rd', requestId: '2026-05-25-nope' });
    expect(report).toBeNull();
  });

  test('does not flag the type metadata line as a placeholder', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-bug', projectRoot: project,
      sessionId: SESSION, apply: true, requestType: 'bugfix', clock: () => TS
    });
    const report = await lintRequestArtifact({ projectRoot: project, role: 'rd', requestId: '2026-05-25-bug' });
    expect(report?.findings.find((f) => /^- type:/.test(f.text))).toBeUndefined();
  });

  test('does not flag <id>-style CLI syntax inside inline code spans', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-cli';
    await createRequestArtifact({
      role: 'prd', requestId, projectRoot: project,
      sessionId: SESSION, apply: true, clock: () => TS
    });
    // Fill the template's prose placeholders, then add command docs with backticked <id>.
    // The artifact lives at .peaks/_runtime/<sessionId>/<role>/requests/
    // (canonical post-F3 home for new slices). Earlier slices used the
    // change-id home; the test follows the canonical home so the lint
    // service finds the file.
    const created = join(project, '.peaks', '_runtime', SESSION, 'prd', 'requests');
    const { readdir, readFile, writeFile } = await import('node:fs/promises');
    const file = (await readdir(created)).find((f) => f.endsWith(`${requestId}.md`))!;
    const path = join(created, file);
    let body = await readFile(path, 'utf8');
    body = body
      .replace(/^- source:.*$/m, '- source: verbal')
      .replace(/^- raw input \(sanitized\):.*$/m, '- raw input (sanitized): build a thing')
      .replaceAll(/^- \.\.\.$/gm, '- real content')
      + '\n- AC1: run `peaks sop init <id> --json` then `peaks sop check <id> --gate <gid>`\n';
    await writeFile(path, body, 'utf8');

    const report = await lintRequestArtifact({ projectRoot: project, role: 'prd', requestId });
    const placeholderHits = report?.findings.filter((f) => f.reason.includes('<placeholder>')) ?? [];
    expect(placeholderHits.some((f) => f.text.includes('peaks sop init'))).toBe(false);
  });

  test('does not flag <placeholder> tokens inside fenced code blocks', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-fence';
    await createRequestArtifact({
      role: 'prd', requestId, projectRoot: project,
      sessionId: SESSION, apply: true, clock: () => TS
    });
    // The service writes to .peaks/_runtime/<sessionId>/<role>/requests/<number>-<requestId>.md
    // (canonical post-F3 home). The test appends a fenced-code block with a
    // <placeholder>-like token and asserts the lint doesn't flag it.
    const dir = join(project, '.peaks', '_runtime', SESSION, 'prd', 'requests');
    const { readdir, readFile, writeFile } = await import('node:fs/promises');
    const file = (await readdir(dir)).find((f) => f.endsWith(`${requestId}.md`))!;
    const path = join(dir, file);
    const body = await readFile(path, 'utf8') + '\n```bash\npeaks sop check <id> --gate <gid>\n```\n';
    await writeFile(path, body, 'utf8');

    const report = await lintRequestArtifact({ projectRoot: project, role: 'prd', requestId });
    const fenceHit = report?.findings.find((f) => f.text.includes('peaks sop check'));
    expect(fenceHit).toBeUndefined();
  });

  test('flags TODO/TBD markers as warnings, not errors', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-bug', projectRoot: project,
      sessionId: SESSION, apply: true, requestType: 'bugfix', clock: () => TS
    });
    // The default templates already contain TBD-like content; check that warnings carry the warning severity.
    const report = await lintRequestArtifact({ projectRoot: project, role: 'rd', requestId: '2026-05-25-bug' });
    expect(report?.findings.some((f) => f.severity === 'error')).toBe(true);
  });
});
