import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  existsSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseJudgedDeclaration,
  renderJudgedDeclaration,
  type JudgedDeclaration
} from '../../../../src/services/audit-independent/judged-declaration.js';
import { buildJudgedDeclaration } from '../../../../src/services/audit-independent/judged-declaration-build.js';
import {
  resolveSecurityArtifact,
  verifyJudgedDeclaration
} from '../../../../src/services/audit-independent/judged-declaration-check.js';
import { runSecurityAudit } from '../../../../src/services/audit-independent/security-audit-service.js';

const SID = '2026-10-13-session-aabbcc';
const RID = 'rid-declares-what-it-touched';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'judged-decl-'));
  roots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime', SID, 'audit'), { recursive: true });
  mkdirSync(join(root, '.peaks', '_runtime', SID, 'prd'), { recursive: true });
  mkdirSync(join(root, '.peaks', 'project-scan'), { recursive: true });
  return root;
}

function write(relative: string, body: string): void {
  const root = roots[roots.length - 1]!;
  const absolute = join(root, ...relative.split('/'));
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
}

function sha(relative: string): string {
  const root = roots[roots.length - 1]!;
  return createHash('sha256')
    .update(readFileSync(join(root, ...relative.split('/'))))
    .digest('hex');
}

function artifactPath(relative = `audit/security-${RID}.md`): string {
  const root = roots[roots.length - 1]!;
  return join(root, '.peaks', '_runtime', SID, ...relative.split('/'));
}

/** The artifact body the producer renders: coverage block, then the section. */
function stamp(declaration: JudgedDeclaration): void {
  writeFileSync(
    artifactPath(),
    `## Threat model coverage\n\naudited at: t\n\n## Verdict\n\nverdict: pass\n\n${renderJudgedDeclaration(declaration)}`,
    'utf8'
  );
}

function declarationFor(
  paths: readonly string[],
  roots_: ReadonlyArray<{ path: string; why: string }> = []
): JudgedDeclaration {
  return {
    schemaVersion: 1,
    judgedAt: '2026-10-13T00:00:00.000Z',
    handoffHash: 'unknown',
    files: paths.map((p) => ({ path: p, sha256: sha(p) })),
    roots: roots_
  };
}

function check(): ReturnType<typeof verifyJudgedDeclaration> {
  return verifyJudgedDeclaration({
    projectRoot: roots[roots.length - 1]!,
    sessionId: SID,
    requestId: RID
  });
}

function initGit(): void {
  const root = roots[roots.length - 1]!;
  const git = (args: string[]): void => {
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore', windowsHide: true });
  };
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'test']);
  git(['config', 'commit.gpgsign', 'false']);
}

describe('judged declaration grammar', () => {
  it('round-trips a declaration through render and parse', () => {
    const project = makeProject();
    void project;
    write('src/a.ts', 'export const a = 1;\n');
    const declaration = declarationFor(['src/a.ts']);
    const parsed = parseJudgedDeclaration(renderJudgedDeclaration(declaration));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.declaration.files[0]?.path).toBe('src/a.ts');
  });

  it('refuses a block that spells a value with a JSON escape', () => {
    const body = [
      '## Judged content',
      '',
      '```json',
      '{"schemaVersion":1,"judgedAt":"t","handoffHash":"h","files":[{"path":"src/\\u0061.ts","sha256":"' +
        'a'.repeat(64) +
        '"}],"roots":[]}',
      '```',
      ''
    ].join('\n');
    const parsed = parseJudgedDeclaration(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('declaration-escaped');
  });

  it('refuses a declaration that names no file', () => {
    const body =
      '## Judged content\n\n```json\n{"schemaVersion":1,"judgedAt":"t","handoffHash":"h","files":[]}\n```\n';
    const parsed = parseJudgedDeclaration(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('declaration-empty');
  });

  it('refuses a directory root that carries no reason', () => {
    const body =
      '## Judged content\n\n```json\n{"schemaVersion":1,"judgedAt":"t","handoffHash":"h",' +
      '"files":[{"path":"src/a.ts","sha256":"' +
      'a'.repeat(64) +
      '"}],"roots":[{"path":"src","why":"  "}]}\n```\n';
    const parsed = parseJudgedDeclaration(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('declaration-bare-root');
  });

  it('refuses a declaration that names the same path twice', () => {
    const row = `{"path":"src/a.ts","sha256":"${'a'.repeat(64)}"}`;
    const body = `## Judged content\n\n\`\`\`json\n{"schemaVersion":1,"judgedAt":"t","handoffHash":"h","files":[${row},${row}]}\n\`\`\`\n`;
    const parsed = parseJudgedDeclaration(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe('declaration-duplicate');
  });
});

describe('the check against the tree', () => {
  it('refuses when a declared path is rewritten after the audit', () => {
    makeProject();
    write('src/a.ts', 'export const a = 1;\n');
    stamp(declarationFor(['src/a.ts']));
    expect(check().refusals).toEqual([]);

    write('src/a.ts', 'export const a = 2;\n');
    const result = check();
    expect(result.refusals.map((r) => r.code)).toEqual(['declared-path-modified']);
    expect(result.refusals[0]?.path).toBe('src/a.ts');
    expect(result.refusals[0]?.artifact).toBe(`audit/security-${RID}.md`);
  });

  it('still refuses when the declaration section is deleted', () => {
    makeProject();
    write('src/a.ts', 'export const a = 1;\n');
    stamp(declarationFor(['src/a.ts']));
    expect(check().refusals).toEqual([]);

    writeFileSync(
      artifactPath(),
      '## Threat model coverage\n\naudited at: t\n\n## Verdict\n\nverdict: pass\n',
      'utf8'
    );
    const result = check();
    expect(result.refusals.map((r) => r.code)).toEqual(['declaration-missing']);
    expect(result.refusals[0]?.path).toBe(`audit/security-${RID}.md`);
  });

  it('still refuses when the coverage block is deleted and only the declaration is kept', () => {
    // The shed an earlier draft of this check left open: the requirement was
    // keyed on a line in the coverage block, so deleting that block switched the
    // whole check off while the declaration stayed behind.
    makeProject();
    write('src/a.ts', 'export const a = 1;\n');
    stamp(declarationFor(['src/a.ts']));
    const body = readFileSync(artifactPath(), 'utf8');
    const declarationOnly = body.slice(body.indexOf('## Judged content'));
    writeFileSync(artifactPath(), declarationOnly, 'utf8');
    write('src/a.ts', 'export const a = 2;\n');

    const result = check();
    expect(result.refusals.map((r) => r.code)).toEqual(['declared-path-modified']);
    expect(result.refusals[0]?.path).toBe('src/a.ts');
  });

  it('refuses an artifact that carries no declaration at all', () => {
    makeProject();
    write('src/a.ts', 'export const a = 1;\n');
    writeFileSync(artifactPath(), '## Verdict\n\nverdict: pass\n', 'utf8');
    expect(check().refusals.map((r) => r.code)).toEqual(['declaration-missing']);
  });

  it('passes on unchanged bytes across a commit, and catches a rename and a delete', () => {
    makeProject();
    initGit();
    write('src/a.ts', 'export const a = 1;\n');
    execFileSync('git', ['-C', roots[roots.length - 1]!, 'add', '-A'], { windowsHide: true });
    execFileSync('git', ['-C', roots[roots.length - 1]!, 'commit', '-q', '-m', 'first'], {
      windowsHide: true
    });
    stamp(declarationFor(['src/a.ts']));

    const beforeCommit = check();
    expect(beforeCommit.refusals).toEqual([]);

    execFileSync('git', ['-C', roots[roots.length - 1]!, 'add', '-A'], { windowsHide: true });
    execFileSync('git', ['-C', roots[roots.length - 1]!, 'commit', '-q', '-m', 'second'], {
      windowsHide: true
    });
    const afterCommit = check();
    expect(afterCommit.refusals).toEqual([]);

    renameSync(
      join(roots[roots.length - 1]!, 'src', 'a.ts'),
      join(roots[roots.length - 1]!, 'src', 'b.ts')
    );
    const afterRename = check();
    expect(afterRename.refusals.map((r) => r.code)).toEqual(['declared-path-gone']);
    expect(afterRename.refusals[0]?.path).toBe('src/a.ts');

    renameSync(
      join(roots[roots.length - 1]!, 'src', 'b.ts'),
      join(roots[roots.length - 1]!, 'src', 'a.ts')
    );
    expect(check().refusals).toEqual([]);
    rmSync(join(roots[roots.length - 1]!, 'src', 'a.ts'));
    expect(check().refusals.map((r) => r.code)).toEqual(['declared-path-gone']);
  });

  it('passes on a tree carrying a concurrent slice, declaring no path it did not touch', () => {
    makeProject();
    initGit();
    write('src/a.ts', 'export const a = 1;\n');
    write('src/other/counter-slice.ts', 'export const other = 1;\n');
    const declaration = declarationFor(['src/a.ts']);
    stamp(declaration);

    const result = check();
    expect(result.refusals).toEqual([]);
    expect(result.checked).toBe(1);
    expect(declaration.files.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(declaration.files.some((f) => f.path.includes('counter-slice'))).toBe(false);
  });

  it('refuses a path created under a declared root', () => {
    makeProject();
    initGit();
    write('src/dir/a.ts', 'export const a = 1;\n');
    stamp(declarationFor(['src/dir/a.ts'], [{ path: 'src/dir', why: 'the slice rewrote it' }]));
    expect(check().refusals).toEqual([]);

    write('src/dir/gained.ts', 'export const gained = 1;\n');
    const result = check();
    expect(result.refusals.map((r) => r.code)).toEqual(['undeclared-path-under-root']);
    expect(result.refusals[0]?.path).toBe('src/dir/gained.ts');
  });

  it('reports no declinable surface when the artifact is absent', () => {
    makeProject();
    write('src/a.ts', 'export const a = 1;\n');
    expect(resolveSecurityArtifact(roots[roots.length - 1]!, SID, RID)).toBeNull();
    expect(check()).toEqual({ refusals: [], checked: 0 });
  });
});

describe('the producer writes the declaration', () => {
  function seedHandoffAndTemplate(): string {
    const project = makeProject();
    write('.peaks/project-scan/security-template.md', '# Security template\n');
    const body = '# Handoff\n\nGoal: exercise the producer.\n';
    const hash = createHash('sha256').update(body, 'utf8').digest('hex');
    write(
      `.peaks/_runtime/${SID}/prd/handoff-${RID}.md`,
      `---\nrequestId: "${RID}"\nsessionId: "${SID}"\nschemaVersion: 2\nsha256: ${hash}\n---\n${body}`
    );
    return project;
  }

  const envelope = { verdict: 'pass', violations: [], summary: 'clean' };

  it('refuses to produce the artifact when no judged path is declared', () => {
    const project = seedHandoffAndTemplate();
    const result = runSecurityAudit({
      projectRoot: project,
      sessionId: SID,
      rid: RID,
      generatedAt: '2026-10-13T00:00:00.000Z',
      judgedPaths: [],
      envelope
    });
    expect(result.detect.state).toBe('declaration-missing');
    expect(result.artifactPath).toBeNull();
    expect(existsSync(artifactPath())).toBe(false);
  });

  it('stamps the declaration into the artifact it writes', () => {
    const project = seedHandoffAndTemplate();
    write('src/a.ts', 'export const a = 1;\n');
    const result = runSecurityAudit({
      projectRoot: project,
      sessionId: SID,
      rid: RID,
      generatedAt: '2026-10-13T00:00:00.000Z',
      judgedPaths: ['src/a.ts'],
      envelope
    });
    expect(result.detect.state).toBe('ready');
    expect(result.artifactPath).not.toBeNull();
    const written = readFileSync(artifactPath(), 'utf8');
    expect(written).toContain('## Judged content');
    expect(written).toContain(`"sha256":"${sha('src/a.ts')}"`);
    expect(check().refusals).toEqual([]);

    // The refusal is the state the empty-refusal assertion above must not be
    // satisfied for the wrong reason: the same artifact with the declaration
    // removed is refused, so the pass above came from the declaration.
    writeFileSync(artifactPath(), '## Verdict\n\nverdict: pass\n', 'utf8');
    expect(check().refusals.map((r) => r.code)).toEqual(['declaration-missing']);
  });

  it('refuses to produce the artifact when a declared path cannot be hashed', () => {
    const project = seedHandoffAndTemplate();
    const result = runSecurityAudit({
      projectRoot: project,
      sessionId: SID,
      rid: RID,
      generatedAt: '2026-10-13T00:00:00.000Z',
      judgedPaths: ['src/absent.ts'],
      envelope
    });
    expect(result.detect.state).toBe('declaration-missing');
    expect(result.artifactPath).toBeNull();
    expect(existsSync(artifactPath())).toBe(false);
  });

  it('keeps an earlier refusal, so a missing handoff is not reported as a missing declaration', () => {
    const project = makeProject();
    write('.peaks/project-scan/security-template.md', '# Security template\n');
    const result = runSecurityAudit({
      projectRoot: project,
      sessionId: SID,
      rid: RID,
      generatedAt: '2026-10-13T00:00:00.000Z',
      judgedPaths: [],
      envelope
    });
    expect(result.detect.state).toBe('handoff-missing');
  });

  it('builds a declaration only from paths that exist', () => {
    makeProject();
    write('src/a.ts', 'export const a = 1;\n');
    const built = buildJudgedDeclaration({
      projectRoot: roots[roots.length - 1]!,
      judgedAt: 't',
      handoffHash: 'unknown',
      paths: ['src/a.ts', 'src/absent.ts']
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.code).toBe('declared-path-missing');
  });
});
