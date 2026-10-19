// `peaks reviewer config|status|run` — the CLI surface that closes backlog
// §7.10: a three-state status, a flag-driven config write, and a producer
// that refuses to write on a skip.

import { Command } from 'commander';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerReviewerCommands } from '../../../../src/cli/commands/reviewer-commands.js';
import type { ReviewerConfig } from '../../../../src/services/reviewer/reviewer-config.js';

type Capture = { stdout: string; stderr: string };

function makeIo(): { io: { stdout(s: string): void; stderr(s: string): void }; capture: Capture } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: { stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s) },
    capture: {
      get stdout() {
        return stdout.join('');
      },
      get stderr() {
        return stderr.join('');
      }
    }
  };
}

let configPath: string;
let projectRoot: string;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), 'reviewer-cli-'));
  configPath = join(home, 'config.json');
  projectRoot = mkdtempSync(join(tmpdir(), 'reviewer-project-'));
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  vi.unstubAllGlobals();
});

function writeConfig(overrides: Partial<ReviewerConfig> = {}): void {
  const config: ReviewerConfig = {
    providers: [
      { name: 'ollama', model: 'llama3.2:8b' },
      { name: 'ollama', model: 'qwen2.5:7b' }
    ],
    selection: 'round-robin',
    rdProviderName: null,
    requireDistinctModelFamily: true,
    fallbackOnError: 'skip',
    schemaPath: 'schemas/reviewer-envelope.schema.json',
    ...overrides
  };
  writeFileSync(configPath, JSON.stringify({ reviewer: config }), 'utf8');
}

async function runCli(args: string[]): Promise<Capture> {
  const { io, capture } = makeIo();
  const program = new Command();
  registerReviewerCommands(program, io);
  await program.parseAsync(args, { from: 'user' });
  return capture;
}

function parseJson(capture: Capture): Record<string, unknown> {
  return JSON.parse(capture.stdout) as Record<string, unknown>;
}

describe('peaks reviewer status — three states', () => {
  it('when no reviewer section exists, should report no-section with a fix command in nextActions', async () => {
    // given: a config path with no file
    // when:  status runs
    // then:  the state is named and nextActions carries the fix
    const envelope = parseJson(
      await runCli(['reviewer', 'status', '--config', configPath, '--json'])
    );
    const data = envelope['data'] as Record<string, unknown>;
    expect(data['configured']).toBe(false);
    expect(data['state']).toBe('no-section');
    expect(data['providerCount']).toBe(0);
    expect(data['requiredProviders']).toBe(2);
    expect((envelope['nextActions'] as string[]).join(' ')).toContain('peaks reviewer config');
  });

  it('when only one provider is configured, should report insufficient-providers with the count', async () => {
    // given: a section with one provider
    // when:  status runs
    // then:  the output names the count and the >=2 requirement
    writeConfig({ providers: [{ name: 'ollama', model: 'llama3.2:8b' }] });
    const envelope = parseJson(
      await runCli(['reviewer', 'status', '--config', configPath, '--json'])
    );
    const data = envelope['data'] as Record<string, unknown>;
    expect(data['state']).toBe('insufficient-providers');
    expect(data['providerCount']).toBe(1);
    expect((envelope['nextActions'] as string[]).join(' ')).toContain('at least 2');
  });

  it('when two providers are configured, should report configured with their families', async () => {
    // given: a usable section
    // when:  status runs
    // then:  the state is configured and the families are listed
    writeConfig();
    const envelope = parseJson(
      await runCli(['reviewer', 'status', '--config', configPath, '--json'])
    );
    const data = envelope['data'] as Record<string, unknown>;
    expect(data['configured']).toBe(true);
    expect(data['state']).toBe('configured');
    expect(data['providerCount']).toBe(2);
    expect((data['providers'] as Array<Record<string, unknown>>)[0]?.['modelFamily']).toBe('llama');
  });

  it('when the configured schema path resolves nowhere, should report schemaPathExists false', async () => {
    // given: a configured reviewer whose schemaPath exists in neither the project nor the package
    // when:  status runs
    // then:  the dead path is visible instead of merely echoed
    writeConfig({ schemaPath: 'schemas/absent-reviewer-envelope.schema.json' });
    const envelope = parseJson(
      await runCli([
        'reviewer',
        'status',
        '--config',
        configPath,
        '--project',
        projectRoot,
        '--json'
      ])
    );
    const data = envelope['data'] as Record<string, unknown>;
    expect(data['schemaPath']).toBe('schemas/absent-reviewer-envelope.schema.json');
    expect(data['schemaPathExists']).toBe(false);
    expect(data['schemaPathSource']).toBeNull();
    expect(data['schemaPathResolved']).toBeNull();
  });

  it('when a consumer project ships no schema, should report the packaged copy as the source', async () => {
    // given: a project root with no schemas/ directory (the consumer shape)
    // when:  status runs
    // then:  the fall-through to the packaged copy is named, not hidden
    writeConfig();
    const envelope = parseJson(
      await runCli([
        'reviewer',
        'status',
        '--config',
        configPath,
        '--project',
        projectRoot,
        '--json'
      ])
    );
    const data = envelope['data'] as Record<string, unknown>;
    expect(data['schemaPathExists']).toBe(true);
    expect(data['schemaPathSource']).toBe('package');
    const resolved = String(data['schemaPathResolved']);
    expect(resolved.endsWith(join('schemas', 'reviewer-envelope.schema.json'))).toBe(true);
    expect(resolved.startsWith(projectRoot)).toBe(false);
  });

  it('when run from a subdirectory, should promote to the repo root like run does', async () => {
    // given: a temp repo root carrying the schema and a nested subdirectory as cwd
    // when:  status runs with NO --project flag
    // then:  it resolves the project copy, agreeing with the run path's promotion
    const repoRoot = mkdtempSync(join(tmpdir(), 'reviewer-repo-'));
    mkdirSync(join(repoRoot, '.peaks'), { recursive: true });
    writeFileSync(join(repoRoot, '.peaks', 'config.json'), '{}', 'utf8');
    mkdirSync(join(repoRoot, 'schemas'), { recursive: true });
    writeFileSync(join(repoRoot, 'schemas', 'reviewer-envelope.schema.json'), '{}', 'utf8');
    const nested = join(repoRoot, 'nested', 'deeper');
    mkdirSync(nested, { recursive: true });
    const previousCwd = process.cwd();
    process.chdir(nested);
    try {
      writeConfig();
      const envelope = parseJson(
        await runCli(['reviewer', 'status', '--config', configPath, '--json'])
      );
      const data = envelope['data'] as Record<string, unknown>;
      expect(data['schemaPathExists']).toBe(true);
      expect(data['schemaPathSource']).toBe('project');
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('peaks reviewer config — flag-driven write', () => {
  it('when two providers are supplied, should write the section without hand-authored JSON', async () => {
    // given: an empty config path and two provider flags
    // when:  config runs
    // then:  the file holds a usable section and nothing else was lost
    await runCli([
      'reviewer',
      'config',
      '--provider',
      'ollama:llama3.2:8b',
      '--provider',
      'anthropic:claude-haiku-4-5',
      '--selection',
      'hash',
      '--config',
      configPath,
      '--json'
    ]);
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as {
      reviewer: ReviewerConfig;
    };
    expect(raw.reviewer.providers).toHaveLength(2);
    expect(raw.reviewer.selection).toBe('hash');
    expect(raw.reviewer.requireDistinctModelFamily).toBe(true);
    expect(raw.reviewer.fallbackOnError).toBe('skip');
    expect(process.exitCode).toBeUndefined();
  });

  it('when only one provider is supplied, should refuse with the >=2 requirement', async () => {
    // given: one provider flag
    // when:  config runs
    // then:  it fails and writes nothing
    const capture = await runCli([
      'reviewer',
      'config',
      '--provider',
      'ollama:llama3.2:8b',
      '--config',
      configPath,
      '--json'
    ]);
    const envelope = parseJson(capture);
    expect(envelope['ok']).toBe(false);
    expect(envelope['code']).toBe('REVIEWER_CONFIG_INVALID');
    expect(existsSync(configPath)).toBe(false);
    expect(process.exitCode).toBe(2);
  });

  it('when a provider spec is malformed, should name the accepted form', async () => {
    // given: a provider flag without a colon
    // when:  config runs
    // then:  it fails on the spec, not on the provider count
    const envelope = parseJson(
      await runCli(['reviewer', 'config', '--provider', 'ollama', '--config', configPath, '--json'])
    );
    expect(envelope['code']).toBe('INVALID_PROVIDER_SPEC');
  });

  it('when providers already exist and only selection is supplied, should preserve the providers', async () => {
    // given: a valid section on disk
    // when:  config runs with only --selection
    // then:  the providers survive the merge
    writeConfig();
    await runCli(['reviewer', 'config', '--selection', 'random', '--config', configPath, '--json']);
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as { reviewer: ReviewerConfig };
    expect(raw.reviewer.providers).toHaveLength(2);
    expect(raw.reviewer.selection).toBe('random');
  });
});

describe('peaks reviewer run — skip is not a pass, and the producer', () => {
  it('when no reviewer is configured, should report the skip envelope with passed false', async () => {
    // given: a config path with no file
    // when:  run executes
    // then:  consumers reading passed/gateAction see a skip, not a pass
    const envelope = parseJson(
      await runCli(['reviewer', 'run', '--rid', 'r1', '--config', configPath, '--json'])
    );
    const data = envelope['data'] as Record<string, unknown>;
    const skip = data['envelope'] as Record<string, unknown>;
    expect(skip['passed']).toBe(false);
    expect(skip['gateAction']).toBe('warn');
    expect(data['reason']).toBe('no-reviewer-config');
    expect((envelope['nextActions'] as string[]).join(' ')).toContain('peaks reviewer config');
  });

  it('when --write is set on a skip, should write nothing and report why', async () => {
    // given: no reviewer config and --write
    // when:  run executes
    // then:  no artifact exists and written is false
    const envelope = parseJson(
      await runCli([
        'reviewer',
        'run',
        '--rid',
        'r1',
        '--write',
        '--project',
        projectRoot,
        '--session-id',
        's1',
        '--config',
        configPath,
        '--json'
      ])
    );
    const data = envelope['data'] as Record<string, unknown>;
    expect(data['written']).toBe(false);
    expect(data['writeSkippedReason']).toContain('skipped');
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', 's1'))).toBe(false);
  });

  it('when a real verdict is produced with --write, should write both producer artifacts', async () => {
    // given: a configured reviewer whose provider returns a valid envelope
    // when:  run executes with --write
    // then:  the markdown and JSON siblings carry the envelope and the markers
    writeConfig();
    const verdict = {
      reviewerId: 'third-party-reviewer-v2.14.0',
      modelId: 'llama3.2:8b',
      modelFamily: 'llama',
      passed: true,
      violations: [],
      gateAction: 'allow',
      reason: 'no findings'
    };
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: JSON.stringify(verdict) } })
    }));
    const envelope = parseJson(
      await runCli([
        'reviewer',
        'run',
        '--rid',
        'r1',
        '--write',
        '--project',
        projectRoot,
        '--session-id',
        's1',
        '--config',
        configPath,
        '--json'
      ])
    );
    const data = envelope['data'] as Record<string, unknown>;
    expect(data['written']).toBe(true);
    const rd = join(projectRoot, '.peaks', '_runtime', 's1', 'rd');
    const markdown = readFileSync(join(rd, 'third-party-review-r1.md'), 'utf8');
    const json = JSON.parse(readFileSync(join(rd, 'third-party-review-r1.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(markdown).toContain('third-party-review');
    expect(markdown).toContain('modelFamily');
    expect(json['modelFamily']).toBe('llama');
    expect(json['passed']).toBe(true);
  });

  it('when the configured schemaPath does not resolve, should refuse before the provider call', async () => {
    // given: a configured reviewer whose schemaPath names a missing file
    // when:  run executes
    // then:  it fails with SCHEMA_MISSING and fetch is never called
    writeConfig({ schemaPath: 'schemas/absent-reviewer-envelope.schema.json' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const envelope = parseJson(
      await runCli([
        'reviewer',
        'run',
        '--rid',
        'r1',
        '--project',
        projectRoot,
        '--config',
        configPath,
        '--json'
      ])
    );
    expect(envelope['code']).toBe('SCHEMA_MISSING');
    const message = String(envelope['message']);
    expect(message).toContain('searched:');
    // Both candidates — project root and packaged copy — are named.
    expect(message.split('absent-reviewer-envelope.schema.json')).toHaveLength(3);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('when --write is absent, should not write any artifact', async () => {
    // given: a configured reviewer whose provider returns a valid envelope
    // when:  run executes without --write
    // then:  stdout is unchanged and no runtime directory is created
    writeConfig();
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          content: JSON.stringify({
            reviewerId: 'third-party-reviewer-v2.14.0',
            modelId: 'llama3.2:8b',
            modelFamily: 'llama',
            passed: true,
            violations: [],
            gateAction: 'allow',
            reason: 'no findings'
          })
        }
      })
    }));
    const envelope = parseJson(
      await runCli([
        'reviewer',
        'run',
        '--rid',
        'r1',
        '--project',
        projectRoot,
        '--session-id',
        's1',
        '--config',
        configPath,
        '--json'
      ])
    );
    const data = envelope['data'] as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(['envelope']);
    expect(existsSync(join(projectRoot, '.peaks'))).toBe(false);
  });

  it('when the session id is a traversal token, should refuse to write outside the runtime', async () => {
    // given: a configured reviewer and a session id of ".."
    // when:  run executes with --write
    // then:  the write is refused and no file lands above the project root
    writeConfig();
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          content: JSON.stringify({
            reviewerId: 'third-party-reviewer-v2.14.0',
            modelId: 'llama3.2:8b',
            modelFamily: 'llama',
            passed: true,
            violations: [],
            gateAction: 'allow',
            reason: 'no findings'
          })
        }
      })
    }));
    const envelope = parseJson(
      await runCli([
        'reviewer',
        'run',
        '--rid',
        'r1',
        '--write',
        '--project',
        projectRoot,
        '--session-id',
        '..',
        '--config',
        configPath,
        '--json'
      ])
    );
    expect(envelope['code']).toBe('ARTIFACT_WRITE_FAILED');
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(projectRoot, '.peaks', 'rd'))).toBe(false);
  });
});
