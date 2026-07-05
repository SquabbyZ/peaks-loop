import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

const mockedRunDoctor = vi.hoisted(() => vi.fn().mockResolvedValue({
  checks: [
    {
      id: 'cli-program-test-stub',
      ok: true,
      message: 'synthetic doctor report (cli-program.core test hermeticity)'
    }
  ],
  summary: { ok: true, passed: 1, failed: 0 }
}));

vi.mock('../../src/services/doctor/doctor-service.js', () => ({
  runDoctor: mockedRunDoctor
}));

describe('createProgram', () => {

  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  test('prints skill list as JSON envelope', async () => {
    const result = await runCommand(['skill', 'list', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('skill.list');
    expect(JSON.stringify(output.data)).toContain('peaks-code');
  });

  test('prints doctor as JSON envelope', async () => {
    const result = await runCommand(['doctor', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('doctor');
  });

  test('prints profile list', async () => {
    const result = await runCommand(['profile', 'list', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(JSON.stringify(output.data)).toContain('strict-refactor');
  });

  test('prints proxy validation errors', async () => {
    const result = await runCommand(['proxy', 'test', '--proxy', '127.0.0.1:58309', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_PROXY');
    expect(result.exitCode).toBe(1);
  });

  test('rejects non-dry-run proxy tests', async () => {
    const result = await runCommand(['proxy', 'test', '--proxy', 'http://127.0.0.1:58309', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
    expect(result.exitCode).toBe(1);
  });

  test('prints GitLab artifact init dry-run', async () => {
    const result = await runCommand(['artifacts', 'init', '--provider', 'gitlab', '--name', 'artifacts', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(JSON.stringify(output.data)).toContain('gitlab');
  });

  test('rejects unsupported artifact provider', async () => {
    const result = await runCommand(['artifacts', 'init', '--provider', 'gitea', '--name', 'artifacts', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_ARTIFACT_PROVIDER');
  });

  test('rejects non-dry-run artifact init', async () => {
    const result = await runCommand(['artifacts', 'init', '--provider', 'gitlab', '--name', 'artifacts', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('prints refactor hard gates', async () => {
    const result = await runCommand(['refactor', '--solo', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(JSON.stringify(output.data)).toContain('Require UT coverage >= 95%');
  });

  test('prints standards init dry-run as JSON envelope', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-standards-'));
    const result = await runCommand(['standards', 'init', '--project', projectRoot, '--language', 'typescript', '--json']);
    const output = parseJsonOutput<{ apply: boolean; language: string; skillPreflight: { appliesTo: string[] }; plannedWrites: Array<{ relativePath: string; status: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('standards.init');
    expect(output.data.apply).toBe(false);
    expect(output.data.language).toBe('typescript');
    expect(output.data.skillPreflight.appliesTo).toEqual(['peaks-rd', 'peaks-qa', 'peaks-code']);
    expect(output.data.plannedWrites.map((write) => write.relativePath)).toContain('.claude/rules/common/security.md');
  });

  test('applies standards init with detected language when language is omitted', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-standards-apply-'));
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');

    const result = await runCommand(['standards', 'init', '--project', projectRoot, '--apply', '--json']);
    const output = parseJsonOutput<{ apply: boolean; language: string; writtenFiles: string[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('standards.init');
    expect(output.data.apply).toBe(true);
    expect(output.data.language).toBe('typescript');
    expect(output.data.writtenFiles).toContain('CLAUDE.md');
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
  });

  test('rejects conflicting standards init dry-run and apply flags', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-standards-conflict-'));
    const result = await runCommand(['standards', 'init', '--project', projectRoot, '--dry-run', '--apply', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_STANDARDS_INIT_FLAGS');
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
  });

  test('rejects invalid standards language', async () => {
    const result = await runCommand(['standards', 'init', '--project', process.cwd(), '--language', 'type/script', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('STANDARDS_INIT_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('prints non-json profile output', async () => {
    const result = await runCommand(['profile', 'list']);

    expect(result.stdout.join('\n')).toContain('strict-refactor');
  });

  test('prints non-json proxy errors to stderr', async () => {
    const result = await runCommand(['proxy', 'test', '--proxy', 'bad']);

    expect(result.stderr.join('\n')).toContain('INVALID_PROXY');
  });

  test('prints skill doctor checks', async () => {
    const result = await runCommand(['skill', 'doctor', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.command).toBe('skill.doctor');
  });

  test('prints skill runbook inspection as JSON envelope', async () => {
    const result = await runCommand(['skill', 'runbook', 'peaks-code', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('skill.runbook');
    expect(output.data).toMatchObject({
      name: 'peaks-code',
      hasRunbook: true,
      ok: true
    });
    expect((output.data as { peaksCommandCount: number }).peaksCommandCount).toBeGreaterThanOrEqual(20);
  });

  test('skill runbook reports SKILL_NOT_FOUND for an unknown skill', async () => {
    const result = await runCommand(['skill', 'runbook', 'this-skill-does-not-exist', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('SKILL_NOT_FOUND');
  });

  test('rejects conflicting refactor modes', async () => {
    const result = await runCommand(['refactor', '--solo', '--rd', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('CONFLICTING_REFACTOR_MODE');
  });

  test('rejects non-dry-run refactor', async () => {
    const result = await runCommand(['refactor', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('prints recommendation plan as JSON envelope', async () => {
    const result = await runCommand(['recommend', '--workflow', 'code-refactor', '--language', 'zh-CN', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('recommend');
    expect(JSON.stringify(output.data)).toContain('code-refactor');
    expect(JSON.stringify(output.data)).toContain('zh-CN');
  });

  test('uses stored config language for recommendation reports when omitted', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-project-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ language: 'zh-CN' }), 'utf8');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    try {
      const result = await runCommand(['recommend', '--workflow', 'code-refactor', '--json']);
      const output = parseJsonOutput<{ presentation: { language: string; summary: string } }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.presentation.language).toBe('zh-CN');
      expect(output.data.presentation.summary).toContain('代码重构');
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('rejects unsupported recommendation workflow', async () => {
    const result = await runCommand(['recommend', '--workflow', 'unknown', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_RECOMMENDATION_WORKFLOW');
  });

  test('prints capability status as JSON envelope', async () => {
    const result = await runCommand(['capability', 'status', '--json']);
    const output = parseJsonOutput(result.stdout);
    const serializedData = JSON.stringify(output.data);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('capability.status');
    expect(serializedData).toContain('everything-claude-code.code-review-agent');
    expect(serializedData).toContain('"sources":[{"sourceId":"ruflo-access-repo"');
  });

  test('prints capability map through top-level and compatibility commands', async () => {
    const result = await runCommand(['capabilities', '--json']);
    const output = parseJsonOutput<{ proxyPolicy?: { httpProxy: string }; sources: Array<{ sourceGroup: string }>; constraints: string[]; availability: Array<{ capabilityId: string; status: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('capabilities.map');
    expect(output.data.proxyPolicy).toBeUndefined();
    expect(output.data.constraints.join('\n')).not.toContain('HTTP proxy');
    expect(output.data.sources.some((source) => source.sourceGroup === 'access-repo')).toBe(true);
    expect(output.data.sources.some((source) => source.sourceGroup === 'mcp-server')).toBe(true);
    expect(output.data.availability.find((item) => item.capabilityId === 'context7.docs-lookup')?.status).toBe('unknown');

    writeUserConfig({ proxy: { httpProxy: 'https://proxy.example:8443' } });
    const configuredResult = await runCommand(['capabilities', '--json']);
    const configuredOutput = parseJsonOutput<{ proxyPolicy?: { httpProxy: string } }>(configuredResult.stdout);
    expect(configuredOutput.data.proxyPolicy?.httpProxy).toBe('https://proxy.example:8443');

    const nestedResult = await runCommand(['capability', 'map', '--source', 'mcp-server', '--json']);
    const nestedOutput = parseJsonOutput<{ proxyPolicy?: { httpProxy: string }; sources: Array<{ sourceGroup: string }> }>(nestedResult.stdout);
    expect(nestedOutput.command).toBe('capabilities.map');
    expect(nestedOutput.data.proxyPolicy?.httpProxy).toBe('https://proxy.example:8443');
    expect(nestedOutput.data.sources.every((source) => source.sourceGroup === 'mcp-server')).toBe(true);

    const plainResult = await runCommand(['capability', 'map', '--source', 'access-repo']);
    expect(plainResult.stdout.join('\n')).not.toContain('http://127.0.0.1:58309');
    expect(plainResult.stdout.join('\n')).toContain('https://proxy.example:8443');
  });

  test('rejects unsupported capability map source', async () => {
    const result = await runCommand(['capabilities', '--source', 'unknown', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_CAPABILITY_SOURCE');
    expect(result.exitCode).toBe(1);
  });

  test('prints config get as JSON envelope', async () => {
    const result = await runCommand(['config', 'get', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('config.get');
  });

  test('prints config get with specific key', async () => {
    const result = await runCommand(['config', 'get', '--key', 'language', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('config.get');

    const layeredResult = await runCommand(['config', 'get', '--key', 'language', '--layer', 'user', '--json']);
    const layeredOutput = parseJsonOutput(layeredResult.stdout);
    expect(layeredOutput.ok).toBe(true);
  });

  test('prints config set validation failures as JSON envelopes', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-config-set-'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      const invalidJsonResult = await runCommand(['config', 'set', '--key', 'language', '--value', '{bad', '--json']);
      expect(parseJsonOutput(invalidJsonResult.stdout).code).toBe('INVALID_JSON');
      expect(invalidJsonResult.exitCode).toBe(1);

      const sensitiveLayerResult = await runCommand(['config', 'set', '--key', 'providers.minimax.apiKey', '--value', '"secret"', '--layer', 'project', '--json']);
      expect(parseJsonOutput(sensitiveLayerResult.stdout).code).toBe('SECRET_CONFIG_REQUIRES_USER_LAYER');
      expect(sensitiveLayerResult.exitCode).toBe(1);

      const invalidLayerResult = await runCommand(['config', 'set', '--key', 'language', '--value', '"zh"', '--layer', 'workspace', '--json']);
      expect(parseJsonOutput(invalidLayerResult.stdout).code).toBe('INVALID_CONFIG_LAYER');
      expect(invalidLayerResult.exitCode).toBe(1);

      const invalidMiniMaxResult = await runCommand(['config', 'set', '--key', 'providers.minimax.baseUrl', '--value', '"http://example.com"', '--json']);
      expect(parseJsonOutput(invalidMiniMaxResult.stdout).code).toBe('INVALID_MINIMAX_BASE_URL');
      expect(invalidMiniMaxResult.exitCode).toBe(1);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('prints artifact status and accepts valid setup steps', async () => {
    const statusResult = await runCommand(['artifacts', 'status', '--json']);
    const statusOutput = parseJsonOutput(statusResult.stdout);
    expect(statusOutput.ok).toBe(true);
    expect(statusOutput.command).toBe('artifacts.status');

    const setupResult = await runCommand(['artifacts', 'setup', '--step', 'configure', '--json']);
    const setupOutput = parseJsonOutput<{ step: string }>(setupResult.stdout);
    expect(setupOutput.ok).toBe(true);
    expect(setupOutput.data.step).toBe('configure');
  });

  test('peaks memory extract --apply persists embedded blocks and regenerates index.json', async () => {
    // This is the CLI surface that peaks-code / peaks-txt legitimately
    // delegate to: destructive side effect with --apply, JSON envelope
    // the skill reads back to confirm persistence. The skill prompt does
    // the scan / decision work; the CLI does the atomic write.
    const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-mem-extract-cli-'));
    const artifactPath = join(projectRoot, 'handoff.md');
    try {
      // Embed a stable fact block the way peaks-txt is expected to.
      writeFileSync(artifactPath, [
        '# Handoff capsule',
        '',
        '<!-- peaks-memory:start -->',
        'title: Click-to-edit uses mousedown on the row, not click',
        'kind: convention',
        '---',
        'Single-click on a tree row opens the editor; the existing click handler collides with drag-to-reorder. Use mousedown for selection, click is reserved for the editor activation.',
        '<!-- peaks-memory:end -->',
        ''
      ].join('\n'), 'utf8');

      // --dry-run first (the path peaks-code / peaks-txt uses to preview).
      const preview = await runCommand(['memory', 'extract', '--project', projectRoot, '--artifact', artifactPath, '--dry-run', '--json']);
      const previewOutput = parseJsonOutput<{
        ok: boolean;
        extractedCount: number;
        writtenFiles: string[];
      }>(preview.stdout);
      expect(previewOutput.ok).toBe(true);
      expect(previewOutput.data.extractedCount).toBe(1);
      expect(previewOutput.data.writtenFiles).toEqual([]);
      // dry-run must NOT create .peaks/memory
      expect(existsSync(join(projectRoot, '.peaks', 'memory'))).toBe(false);

      // --apply writes the markdown + regenerates index.json
      const applied = await runCommand(['memory', 'extract', '--project', projectRoot, '--artifact', artifactPath, '--apply', '--json']);
      const appliedOutput = parseJsonOutput<{
        ok: boolean;
        extractedCount: number;
        writtenFiles: string[];
      }>(applied.stdout);
      expect(appliedOutput.ok).toBe(true);
      expect(appliedOutput.data.extractedCount).toBe(1);
      expect(appliedOutput.data.writtenFiles).toHaveLength(1);

      // .peaks/memory/ now has the markdown + a full-shape index
      const memoryDir = join(projectRoot, '.peaks', 'memory');
      expect(existsSync(memoryDir)).toBe(true);
      const indexPath = join(memoryDir, 'index.json');
      expect(existsSync(indexPath)).toBe(true);
      const indexRaw = JSON.parse(readFileSync(indexPath, 'utf8'));
      expect(indexRaw.version).toBe(1);
      // The new block is `kind: convention` → lands in hot.convention
      expect(indexRaw.hot.convention).toHaveLength(1);
      expect(indexRaw.hot.convention[0].name).toBe('click-to-edit-uses-mousedown-on-the-row-not-click');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('peaks project memories:extract --apply persists embedded blocks (slice #015 regression)', async () => {
    // Pre-#015: `peaks project memories:extract --apply` ALWAYS returned
    // `code: INVALID_MEMORY_EXTRACT_FLAGS` with "Use either --dry-run or
    // --apply, not both". Root cause: the `--dry-run` option was defined
    // with a `true` default (`.option('--dry-run', '...', true)`), so
    // `options.dryRun === true && options.apply === true` fired on every
    // `--apply` call. The fix drops the `true` default. `--dry-run` is
    // now opt-in; passing only `--apply` must succeed.
    const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-proj-mem-extract-'));
    const sessionId = '2026-06-07-session-deadbe';
    const sessionDir = join(projectRoot, '.peaks', '_runtime', sessionId);
    try {
      // Build a fake session artifact with one stable fact.
      const artifactPath = join(sessionDir, 'txt', 'handoff.md');
      require('node:fs').mkdirSync(join(sessionDir, 'txt'), { recursive: true });
      writeFileSync(artifactPath, [
        '# Handoff',
        '',
        '<!-- peaks-memory:start -->',
        'title: Slice #015 extracted',
        'kind: project',
        '---',
        'The fix for the memories:extract --apply bug landed.',
        '<!-- peaks-memory:end -->',
        ''
      ].join('\n'), 'utf8');

      // --apply directly (no --dry-run) must succeed.
      const applied = await runCommand([
        'project', 'memories:extract',
        '--session-id', sessionId,
        '--project', projectRoot,
        '--apply',
        '--json'
      ]);
      const appliedOutput = parseJsonOutput<{
        ok: boolean;
        extractedCount: number;
        writtenFiles: string[];
      }>(applied.stdout);
      expect(appliedOutput.ok).toBe(true);
      expect(appliedOutput.code).not.toBe('INVALID_MEMORY_EXTRACT_FLAGS');
      expect(appliedOutput.data.extractedCount).toBe(1);
      expect(appliedOutput.data.writtenFiles).toHaveLength(1);

      // .peaks/memory/ is populated.
      const memoryDir = join(projectRoot, '.peaks', 'memory');
      expect(existsSync(memoryDir)).toBe(true);
      const indexPath = join(memoryDir, 'index.json');
      expect(existsSync(indexPath)).toBe(true);
      const indexRaw = JSON.parse(readFileSync(indexPath, 'utf8'));
      expect(indexRaw.version).toBe(1);
      // `kind: project` lives in the WARM tier (hot is reserved for
      // feedback/decision/rule/convention/module/lesson). See
      // src/services/memory/project-memory-service.ts:474.
      expect(indexRaw.warm.project).toHaveLength(1);
      expect(indexRaw.warm.project[0].name).toBe('slice-015-extracted');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('peaks project memories:extract with both --dry-run and --apply still rejects (mutual exclusion intact)', async () => {
    // The mutual-exclusion check (`dryRun === true && apply === true`)
    // must STILL fire when the user explicitly passes BOTH flags. The
    // fix is "drop the `true` default", not "delete the check".
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-proj-mem-both-'));
    const sessionId = '2026-06-07-session-feedfa';
    const sessionDir = join(projectRoot, '.peaks', '_runtime', sessionId);
    try {
      const artifactPath = join(sessionDir, 'txt', 'handoff.md');
      require('node:fs').mkdirSync(join(sessionDir, 'txt'), { recursive: true });
      writeFileSync(artifactPath, '<!-- peaks-memory:start -->\ntitle: t\nkind: project\n---\nbody\n<!-- peaks-memory:end -->', 'utf8');

      const both = await runCommand([
        'project', 'memories:extract',
        '--session-id', sessionId,
        '--project', projectRoot,
        '--dry-run', '--apply',
        '--json'
      ]);
      const bothOutput = parseJsonOutput<{ ok: boolean }>(both.stdout);
      expect(bothOutput.ok).toBe(false);
      expect(bothOutput.code).toBe('INVALID_MEMORY_EXTRACT_FLAGS');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('plans project memory extraction and backup as JSON envelopes', async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-memory-project-'));
    const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-loop-memory-artifacts-'));
    mkdirSync(join(projectRoot, '.peaks', 'changes'), { recursive: true });
    const artifactPath = join(projectRoot, '.peaks', 'changes', 'rd.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Skill lifecycle rule',
      'kind: project',
      '---',
      'Skill must go personal -> team -> marketplace.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const extractResult = await runCommand(['memory', 'extract', '--project', projectRoot, '--artifact', artifactPath, '--json']);
    const extractOutput = parseJsonOutput<{ primaryMemoryDir: string; extractedCount: number; plannedWrites: Array<{ filePath: string; title: string }> }>(extractResult.stdout);
    expect(extractOutput.ok).toBe(true);
    expect(extractOutput.command).toBe('memory.extract');
    expect(extractOutput.data.primaryMemoryDir).toBe(join(projectRoot, '.peaks', 'memory'));
    expect(extractOutput.data.extractedCount).toBe(1);
    expect(extractOutput.data.plannedWrites[0]?.filePath).toBe(join(projectRoot, '.peaks', 'memory', 'skill-lifecycle-rule.md'));
    expect(extractResult.stdout.join('\n')).not.toContain('Skill must go personal -> team -> marketplace.');

    const backupResult = await runCommand(['memory', 'sync', '--project', projectRoot, '--workspace', artifactWorkspace, '--json']);
    const backupOutput = parseJsonOutput<{ backupMemoryDir: string }>(backupResult.stdout);
    expect(backupOutput.ok).toBe(true);
    expect(backupOutput.command).toBe('memory.sync');
    expect(backupOutput.data.backupMemoryDir).toBe(join(artifactWorkspace, '.peaks', 'memory-backups', 'project-memory-primary'));
  });

  test('prints project memory command failures as JSON envelopes', async () => {
    const { mkdirSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-memory-fail-project-'));
    const missingArtifact = join(projectRoot, 'missing.md');

    const extractResult = await runCommand(['memory', 'extract', '--project', projectRoot, '--artifact', missingArtifact, '--json']);
    const extractOutput = parseJsonOutput(extractResult.stdout);
    expect(extractOutput.ok).toBe(false);
    expect(extractOutput.command).toBe('memory.extract');
    expect(extractOutput.code).toBe('MEMORY_EXTRACT_FAILED');
    expect(extractResult.exitCode).toBe(1);

    const artifactWorkspace = join(projectRoot, '.peaks-artifacts');
    mkdirSync(artifactWorkspace, { recursive: true });
    const syncResult = await runCommand(['memory', 'sync', '--project', projectRoot, '--workspace', artifactWorkspace, '--json']);
    const syncOutput = parseJsonOutput(syncResult.stdout);
    expect(syncOutput.ok).toBe(false);
    expect(syncOutput.command).toBe('memory.sync');
    expect(syncOutput.code).toBe('MEMORY_SYNC_FAILED');
    expect(syncResult.exitCode).toBe(1);
  });

  test('rejects invalid tech workflow and swarm inputs', async () => {
    // Slice 2026-06-29-change-id-root-removal: the change-id axis is
    // gone. The "invalid change-id" path no longer applies; the
    // remaining input-validation contract is empty `--goal ''`.
    const techPlanResult = await runCommand(['tech', 'plan', '--goal', '', '--json']);
    expect(parseJsonOutput(techPlanResult.stdout).code).toBe('INVALID_GOAL');

    const routeResult = await runCommand(['workflow', 'route', '--mode', 'solo', '--goal', '', '--json']);
    expect(parseJsonOutput(routeResult.stdout).code).toBe('INVALID_GOAL');

    const autonomousResult = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--goal', '', '--json']);
    expect(parseJsonOutput(autonomousResult.stdout).code).toBe('INVALID_GOAL');

    const swarmDryRunResult = await runCommand(['swarm', 'plan', '--skill', 'rd', '--goal', 'Fix checkout retry typo', '--no-dry-run', '--json']);
    expect(parseJsonOutput(swarmDryRunResult.stdout).code).toBe('UNSUPPORTED_NON_DRY_RUN');

    const swarmInvalidResult = await runCommand(['swarm', 'plan', '--skill', 'rd', '--goal', '', '--json']);
    expect(parseJsonOutput(swarmInvalidResult.stdout).code).toBe('INVALID_GOAL');
  });

  test('prints sc command envelopes', async () => {
    const statusResult = await runCommand(['sc', 'status', '--json']);
    expect(parseJsonOutput(statusResult.stdout).command).toBe('sc.status');

    const helpJsonResult = await runCommand(['sc', 'help', '--json']);
    expect(parseJsonOutput(helpJsonResult.stdout).command).toBe('sc.help');

    const helpResult = await runCommand(['sc', 'help']);
    expect(helpResult.stdout.join('\n')).toContain('Change traceability workflow integration');

    const plainImpactResult = await runCommand(['sc', 'impact', '--json']);
    expect(parseJsonOutput(plainImpactResult.stdout).command).toBe('sc.impact');

    const impactResult = await runCommand(['sc', 'impact', '--module', 'client', '--file', 'src/app.ts', '--json']);
    expect(parseJsonOutput(impactResult.stdout).command).toBe('sc.impact');

    const plainRetentionResult = await runCommand(['sc', 'retention', '--slice-id', 'slice-1', '--json']);
    expect(parseJsonOutput(plainRetentionResult.stdout).command).toBe('sc.retention');

    const retentionResult = await runCommand(['sc', 'retention', '--slice-id', 'slice-1', '--prd', 'prd.md', '--rd', 'rd.md', '--qa', 'qa.md', '--coverage', 'coverage.json', '--review', 'review.md', '--code', 'src/app.ts', '--json']);
    expect(parseJsonOutput(retentionResult.stdout).command).toBe('sc.retention');

    const validateResult = await runCommand(['sc', 'validate', '--slice-id', 'slice-1', '--json']);
    expect(parseJsonOutput(validateResult.stdout).command).toBe('sc.validate');

    const plainBoundaryResult = await runCommand(['sc', 'boundary', '--slice-id', 'slice-1', '--json']);
    expect(parseJsonOutput(plainBoundaryResult.stdout).command).toBe('sc.boundary');

    const boundaryResult = await runCommand(['sc', 'boundary', '--slice-id', 'slice-1', '--artifact', 'artifact.md', '--code', 'src/app.ts', '--json']);
    expect(parseJsonOutput(boundaryResult.stdout).command).toBe('sc.boundary');
  });
});
