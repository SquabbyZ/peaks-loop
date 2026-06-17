/**
 * Regression test for AC1 (peaks --version creates log file).
 *
 * QA #6 RETURN-TO-RD: Commander 12's built-in `.version()` handler
 * short-circuits the program BEFORE the `preAction` hook fires, so
 * `peaks --version` did NOT create a log entry. The fix replaces
 * the built-in `.version()` with a custom action that runs the
 * bootstrap log entry first, then prints the version and exits.
 *
 * This test asserts the contract: a `peaks --version` invocation
 * MUST create `<homedir>/.peaks/logs/peaks-cli-<UTC-date>.log`
 * containing a `peaks-cli start` JSONL entry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CommanderError } from 'commander';

const homeDirMock = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homeDirMock.value
  };
});

import { createProgram, __resetBootstrapForTests } from '../../../src/cli/program.js';

describe('peaks --version log bootstrap (AC1 regression)', () => {
  let tempHome: string;
  let stdout: string[];
  let stderr: string[];
  let program: ReturnType<typeof createProgram>;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'peaks-version-log-'));
    homeDirMock.value = tempHome;
    stdout = [];
    stderr = [];
    program = createProgram({
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text)
    });
    __resetBootstrapForTests();
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    delete process.env.PEAKS_LOG_DATE_OVERRIDE;
  });

  it('creates a log file when invoked with --version', async () => {
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    try {
      await program.parseAsync(['node', 'peaks', '--version'], { from: 'node' });
    } catch (error: unknown) {
      // Commander may still throw a version-exit error; swallow.
      if (!(error instanceof CommanderError && error.code === 'commander.version')) {
        throw error;
      }
    } finally {
      process.exitCode = previousExit;
    }

    const logDir = join(tempHome, '.peaks', 'logs');
    expect(existsSync(logDir)).toBe(true);

    const files = readdirSync(logDir).filter((name) => name.startsWith('peaks-cli-') && name.endsWith('.log'));
    expect(files.length).toBe(1);
    const todayFile = join(logDir, files[0]!);
    const body = readFileSync(todayFile, 'utf8');
    const lines = body.trim().split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!) as { msg: string; level: string; command: string };
    expect(parsed.msg).toBe('peaks-cli start');
    expect(parsed.level).toBe('info');
    expect(parsed.command).toBe('main');
  });

  it('creates a log file when invoked with -v short flag', async () => {
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    try {
      await program.parseAsync(['node', 'peaks', '-v'], { from: 'node' });
    } catch (error: unknown) {
      if (!(error instanceof CommanderError && error.code === 'commander.version')) {
        throw error;
      }
    } finally {
      process.exitCode = previousExit;
    }

    const logDir = join(tempHome, '.peaks', 'logs');
    expect(existsSync(logDir)).toBe(true);
    const files = readdirSync(logDir).filter((name) => name.startsWith('peaks-cli-') && name.endsWith('.log'));
    expect(files.length).toBe(1);
  });

  /**
   * Repair cycle 2 regression: the `bootstrapRan` flag is process-scoped
   * and must be set by EVERY code path that invokes `bootstrapLogger`,
   * not only the `preAction` hook. When a single `createProgram`
   * instance parses `--version` twice in the same process, the second
   * call must NOT write a duplicate `peaks-cli start` JSONL entry.
   */
  it('writes exactly one peaks-cli start entry across two same-process --version invocations', async () => {
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    try {
      // Intentionally do NOT call __resetBootstrapForTests() between
      // invocations — the dedup contract is a same-process property.
      for (let i = 0; i < 2; i += 1) {
        try {
          await program.parseAsync(['node', 'peaks', '--version'], { from: 'node' });
        } catch (error: unknown) {
          if (!(error instanceof CommanderError && error.code === 'commander.version')) {
            throw error;
          }
        }
      }
    } finally {
      process.exitCode = previousExit;
    }

    const logDir = join(tempHome, '.peaks', 'logs');
    expect(existsSync(logDir)).toBe(true);
    const files = readdirSync(logDir).filter((name) => name.startsWith('peaks-cli-') && name.endsWith('.log'));
    expect(files.length).toBe(1);
    const body = readFileSync(join(logDir, files[0]!), 'utf8');
    const lines = body.trim().split('\n').filter((line) => line.length > 0);
    const startLines = lines.filter((line) => {
      try {
        return (JSON.parse(line) as { msg?: string }).msg === 'peaks-cli start';
      } catch {
        return false;
      }
    });
    expect(startLines.length).toBe(1);
  });
});
