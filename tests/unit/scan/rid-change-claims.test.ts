// tests/unit/scan/rid-change-claims.test.ts
//
// The per-rid "changed paths" claim table: the machine-readable format, the
// heading-as-switch, and the reader that walks a session's RD artifacts.
//
// The two states the table distinguishes are the whole point: an artifact that
// carries the `## Changed paths` heading HAS declared (an empty list is a
// declaration), and an artifact WITHOUT it has not — the caller then falls back
// to the whole working tree, which is stricter, not looser.
//
// Dimensions: behavior (the parse rules), integration (a real session tree on
// disk), render (the artifact the RD template emits), a11y (what a producer has
// to write, and what the lint says about an unfilled one).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  hasChangedPathsSection,
  listSessionRdArtifactIds,
  parseChangedPathLines,
  readRidChangeClaims
} from '../../../src/services/scan/rid-change-claims.js';
import { renderTemplate } from '../../../src/services/artifacts/artifact-templates.js';
import { lintRequestArtifact } from '../../../src/services/artifacts/artifact-lint-service.js';

declareDimensions('tests/unit/scan/rid-change-claims.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const SESSION_ID = '2026-10-24-rid-claims';
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-rid-claims-'));
  roots.push(root);
  return root;
}

/** Write an RD artifact into the session's request directory. */
function writeArtifact(root: string, fileName: string, body: string): string {
  const path = join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', fileName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
  return path;
}

/** An RD artifact body, with or without the `## Changed paths` section. */
function artifactBody(options: { declared?: readonly string[]; section?: boolean }): string {
  const head = `# RD Request rid-a\n\n- session: ${SESSION_ID}\n- type: docs\n`;
  if (options.section === false) return `${head}\n## Status\n\n- state: spec-locked\n`;
  const lines = (options.declared ?? []).map((path) => `changedPath: ${path}`).join('\n');
  return `${head}\n## Changed paths\n\n${lines}\n\n## Status\n\n- state: spec-locked\n`;
}

describe('Scenario: behavior — the format is one key per line', () => {
  it('when a body declares three paths, should read them back in order', () => {
    // given: a body in the documented format
    // when: the lines are parsed
    // then: every declared path is read, in the order it was written
    const body = [
      '## Changed paths',
      '',
      'changedPath: src/a.ts',
      'changedPath: src/deep/b.ts',
      'changedPath: docs/c.md'
    ].join('\n');

    const paths = parseChangedPathLines(body);

    expect(paths).toEqual(['src/a.ts', 'src/deep/b.ts', 'docs/c.md']);
  });

  it('when a line has trailing spaces, should read the path without them', () => {
    // given: a declaration with padding
    // when: the lines are parsed
    // then: the value is the path, not the padding
    const body = 'changedPath: src/a.ts   \n';

    const paths = parseChangedPathLines(body);

    expect(paths).toEqual(['src/a.ts']);
  });

  it('when a line carries no path, should not declare an empty one', () => {
    // given: a bare key and a key with only whitespace
    // when: the lines are parsed
    // then: only the real declaration counts
    const body = 'changedPath:\nchangedPath:    \nchangedPath: src/a.ts\n';

    const paths = parseChangedPathLines(body);

    expect(paths).toEqual(['src/a.ts']);
  });

  it('when a body has no heading, should report no declaration', () => {
    // given: a body without the heading
    // when: the heading is looked for
    // then: the artifact has NOT declared
    const body = '# RD Request rid-a\n\n- state: draft\n';

    const present = hasChangedPathsSection(body);

    expect(present).toBe(false);
  });

  it('when a body has the heading and an empty list, should report a declaration', () => {
    // given: the heading with nothing under it
    // when: the heading is looked for
    // then: an empty list is a declaration ("this slice touched nothing")
    const body = '## Changed paths\n\n## Status\n';

    const present = hasChangedPathsSection(body);

    expect(present).toBe(true);
  });
});

describe('Scenario: integration — the reader walks a session of artifacts', () => {
  it('when a session holds a declaring and a non-declaring rid, should table only the declaring one', () => {
    // given: one artifact with the section and one without
    // when: the session's claim table is read
    // then: the declaring rid is in the table with its paths
    //   The non-declaring rid is NOT in the table — the caller reads its
    //   absence as "no declaration" and falls back to the whole worktree
    const root = makeRoot();
    writeArtifact(root, '001-rid-a.md', artifactBody({ declared: ['docs/a.md', 'src/a.ts'] }));
    writeArtifact(root, '002-rid-b.md', artifactBody({ section: false }));

    const claims = readRidChangeClaims(root, SESSION_ID);

    expect(claims.get('rid-a')).toEqual(['docs/a.md', 'src/a.ts']);
    expect(claims.has('rid-b')).toBe(false);
  });

  it('when a session is listed, should name every rid that has an artifact', () => {
    // given: the same two artifacts
    // when: the session's rid list is read
    // then: both are named — that is what decides whether the table is complete
    const root = makeRoot();
    writeArtifact(root, '001-rid-a.md', artifactBody({ declared: ['docs/a.md'] }));
    writeArtifact(root, '002-rid-b.md', artifactBody({ section: false }));

    const ids = listSessionRdArtifactIds(root, SESSION_ID);

    expect([...ids].sort()).toEqual(['rid-a', 'rid-b']);
  });

  it('when a session has no artifact directory, should return an empty table', () => {
    // given: a project with no runtime tree at all
    // when: the table is read
    // then: nothing is claimed, and the caller falls back
    const root = makeRoot();

    const claims = readRidChangeClaims(root, SESSION_ID);

    expect(claims.size).toBe(0);
    expect(listSessionRdArtifactIds(root, SESSION_ID)).toEqual([]);
  });

  it('when a session id is unusable, should return an empty table rather than escape the root', () => {
    // given: a session id that is not a single path segment
    // when: the table is read
    // then: nothing is read, and nothing outside the root is touched
    const root = makeRoot();

    const claims = readRidChangeClaims(root, '../escape');

    expect(claims.size).toBe(0);
    expect(listSessionRdArtifactIds(root, '../escape')).toEqual([]);
  });
});

describe('Scenario: render — the RD template asks for the declaration', () => {
  it('when the RD template is rendered, should carry the Changed paths section', () => {
    // given: the RD template's own inputs
    // when: the template is rendered
    // then: the section is there, with one placeholder line under it
    const root = makeRoot();

    const body = renderTemplate('rd', 'rid-a', SESSION_ID, SESSION_ID, '2026-10-24T00:00:00.000Z', {
      requestType: 'docs',
      projectRoot: root
    });

    expect(body).toContain('## Changed paths');
    expect(body).toContain('changedPath: <path>');
  });

  it('when the PRD template is rendered, should not carry the section', () => {
    // given: the PRD template's own inputs
    // when: the template is rendered
    // then: only the RD declaration is the rule's input
    const root = makeRoot();

    const body = renderTemplate(
      'prd',
      'rid-a',
      SESSION_ID,
      SESSION_ID,
      '2026-10-24T00:00:00.000Z',
      { requestType: 'docs', projectRoot: root }
    );

    expect(body).not.toContain('## Changed paths');
  });
});

describe('Scenario: a11y — an unfilled declaration is refused by the lint', () => {
  it('when the rendered RD still carries the placeholder, should the lint refuse it', async () => {
    // given: a pristine RD artifact, exactly as the template emitted it
    // when: the artifact is linted
    // then: the unfilled placeholder is named, so an RD cannot leave draft
    //       without declaring what it changed
    const root = makeRoot();
    const body = renderTemplate('rd', 'rid-a', SESSION_ID, SESSION_ID, '2026-10-24T00:00:00.000Z', {
      requestType: 'docs',
      projectRoot: root
    });
    writeArtifact(root, '001-rid-a.md', body);

    const report = await lintRequestArtifact({
      projectRoot: root,
      role: 'rd',
      requestId: 'rid-a',
      sessionId: SESSION_ID
    });

    expect(report).not.toBeNull();
    const findings = report?.findings ?? [];
    expect(findings.some((finding) => finding.text.startsWith('changedPath:'))).toBe(true);
    expect(report?.ok).toBe(false);
  });

  it('when the declaration is filled, should the lint accept the artifact', async () => {
    // given: the same artifact with the section filled in
    // when: the artifact is linted
    // then: no placeholder finding stands in the way
    const root = makeRoot();
    const body = artifactBody({ declared: ['src/services/scan/rid-change-claims.ts'] });
    writeArtifact(root, '001-rid-a.md', body);

    const report = await lintRequestArtifact({
      projectRoot: root,
      role: 'rd',
      requestId: 'rid-a',
      sessionId: SESSION_ID
    });

    expect(report?.ok).toBe(true);
  });
});
