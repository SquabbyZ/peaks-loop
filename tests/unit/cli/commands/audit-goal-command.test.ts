// tests/unit/cli/commands/audit-goal-command.test.ts
//
// Unit test for the `peaks audit goal` binding in
// src/cli/commands/audit-commands.ts — the entry gate for every peaks-*
// workflow.
//
// These cases run the REAL modules. The only ones that could reach a network
// are the ones that fail before binding, and they are exercised by removing
// the credential from the environment, so no case here performs a network call.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerAuditCommands } from '../../../../src/cli/commands/audit-commands.js';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';

const CREDENTIAL_KEYS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'] as const;

type Capture = {
  stdout: string;
  stderr: string;
};

function makeIo(): { io: ProgramIO; capture: Capture } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) },
    capture: {
      get stdout() { return stdout.join(''); },
      get stderr() { return stderr.join(''); },
    },
  };
}

function newProgram(io: ProgramIO): Command {
  const program = new Command();
  registerAuditCommands(program, io);
  return program;
}

let projectRoot: string;
let savedCredentials: Record<string, string | undefined> = {};

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-audit-goal-'));
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

beforeEach(() => {
  savedCredentials = {};
  for (const key of CREDENTIAL_KEYS) {
    savedCredentials[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of CREDENTIAL_KEYS) {
    const value = savedCredentials[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  process.exitCode = undefined;
});

function hideCredentials(): void {
  for (const key of CREDENTIAL_KEYS) {
    delete process.env[key];
  }
}

describe('peaks audit goal', () => {
  it('when the stub provider is requested, should report a scaffold and never claim an audit', async () => {
    // given: a program with a real project root
    const { io, capture } = makeIo();

    // when: the stub provider runs the gate offline
    await newProgram(io).parseAsync(
      ['audit', 'goal', '--project', projectRoot, '--need', 'ship the gate', '--llm-provider', 'stub', '--json'],
      { from: 'user' }
    );

    // then: the envelope is labelled a stub, not an audit
    const envelope = JSON.parse(capture.stdout) as {
      ok: boolean;
      data: { status: string; providerBinding: string; result: { audit: unknown[] } };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('scaffold-only');
    expect(envelope.data.providerBinding).toBe('stub');
    expect(envelope.data.result.audit).toHaveLength(6);
    expect(process.exitCode).toBeUndefined();
  });

  it('when the credential is absent, should exit non-zero naming the missing environment variable', async () => {
    // given: an environment with no LLM credential and the default provider
    hideCredentials();
    const { io, capture } = makeIo();

    // when: the gate is invoked
    await newProgram(io).parseAsync(
      ['audit', 'goal', '--project', projectRoot, '--need', 'ship the gate', '--json'],
      { from: 'user' }
    );

    // then: it refuses loudly — no scaffold envelope, no exit 0 — and the
    // exact variable name survives on the channels `fail()` does not redact
    // (`data` / `nextActions`; `message` is stripped by the shared redactor,
    // whose catch-all pattern matches the words `token` and `api_key`).
    const envelope = JSON.parse(capture.stdout) as {
      ok: boolean;
      code: string;
      data: { status: string; missingEnv: string[] };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('LLM_CREDENTIAL_MISSING');
    expect(envelope.data.missingEnv).toEqual(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']);
    expect(capture.stdout).toContain('ANTHROPIC_AUTH_TOKEN');
    expect(capture.stdout).not.toContain('scaffold-only');
    expect(process.exitCode).toBe(1);
  });

  it('when no provider is named, should default to the real provider rather than the stub', async () => {
    // given: an environment with no credential and an explicit provider omitted
    hideCredentials();
    const { io, capture } = makeIo();

    // when: the gate is invoked without --llm-provider
    await newProgram(io).parseAsync(
      ['audit', 'goal', '--project', projectRoot, '--need', 'ship the gate', '--json'],
      { from: 'user' }
    );

    // then: the default binding is the real one — it failed to bind instead of scaffolding
    const envelope = JSON.parse(capture.stdout) as { data: { status: string } };
    expect(envelope.data.status).toBe('audit-failed');
    expect(envelope.data.status).not.toBe('scaffold-only');
  });

  it('when an unsupported provider is named, should exit non-zero listing the supported ones', async () => {
    // given: a provider name outside the whitelist
    const { io, capture } = makeIo();

    // when: the gate is invoked with it
    await newProgram(io).parseAsync(
      ['audit', 'goal', '--project', projectRoot, '--need', 'ship the gate', '--llm-provider', 'gpt', '--json'],
      { from: 'user' }
    );

    // then: the failure names the providers that do work
    const envelope = JSON.parse(capture.stdout) as { ok: boolean; code: string; message: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('LLM_PROVIDER_NOT_IMPLEMENTED');
    expect(envelope.message).toContain('anthropic');
    expect(process.exitCode).toBe(1);
  });

  it('when the project path does not exist, should exit non-zero before any LLM binding', async () => {
    // given: a path that is not a directory
    const { io, capture } = makeIo();

    // when: the gate is invoked
    await newProgram(io).parseAsync(
      ['audit', 'goal', '--project', join(projectRoot, 'missing'), '--need', 'ship the gate', '--json'],
      { from: 'user' }
    );

    // then: the project error is reported with its own code
    const envelope = JSON.parse(capture.stdout) as { ok: boolean; code: string; data: { providerBinding: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('PROJECT_NOT_FOUND');
    expect(envelope.data.providerBinding).toBe('unresolved');
    expect(process.exitCode).toBe(1);
  });
});
