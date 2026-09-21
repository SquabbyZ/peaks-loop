// tests/integration/adapter-dispatch-capability-e2e.test.ts
//
// P2-B.4 adapter/distribution e2e — the `peaks dispatch`, `peaks share`,
// `peaks capability` and `peaks adapter` surfaces.
//
// Split out of the single 848-line `adapter-commands-e2e.test.ts` by slice
// rid-b1 (that file crossed the 800-line cap `peaks request transition`
// enforces). Its siblings are `adapter-skill-commands-e2e.test.ts` and
// `adapter-hooks-statusline-e2e.test.ts`; the shared spawn helper, payload
// schemas and tmp-project lifecycle live in `_adapter-commands-harness.ts`.
// No assertion was moved or removed by the split.

import { existsSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import {
  BIN_TIMEOUT_MS,
  REPO,
  REQUEST_ID,
  adapterListPayload,
  cleanupProjects,
  expectCommandNotRegistered,
  expectRegisteredHelp,
  initWorkspace,
  makeProject,
  parseCliEnvelopeWith,
  runCli,
  subAgentDispatchPayload
} from './_adapter-commands-harness.js';

afterEach(cleanupProjects);

describe('peaks dispatch top-level (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered', () => {
    expectCommandNotRegistered(['dispatch'], 'peaks [options] [command]');
  });
});

describe('peaks sub-agent dispatch <role> (P2-B.4 adapter/distribution e2e)', () => {
  test(
    'is registered and returns an IDE tool-call descriptor in a temporary session',
    () => {
      const project = makeProject('peaks-p2b4-sub-agent-dispatch-');
      const sessionId = initWorkspace(project);
      expectRegisteredHelp(
        ['sub-agent', 'dispatch', 'rd'],
        'peaks sub-agent dispatch [options] <role>',
        project
      );
      const result = runCli(
        [
          'sub-agent',
          'dispatch',
          'rd',
          '--prompt',
          'P2-B.4 adapter command integration probe',
          '--request-id',
          REQUEST_ID,
          '--session-id',
          sessionId,
          '--project',
          project,
          '--json'
        ],
        project
      );
      expect(result.code).toBe(0);
      const envelope = parseCliEnvelopeWith(result.stdout, subAgentDispatchPayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('sub-agent.dispatch');
      expect(envelope.data.role).toBe('rd');
      expect(envelope.data.toolCall.name).toBe('Task');
      expect(existsSync(envelope.data.dispatchRecordPath)).toBe(true);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks dispatch-from-dag top-level (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered; DAG dispatch is an option on sub-agent dispatch', () => {
    expectCommandNotRegistered(['dispatch-from-dag'], 'peaks [options] [command]');
    const nestedHelp = expectRegisteredHelp(
      ['sub-agent', 'dispatch', 'rd'],
      'peaks sub-agent dispatch [options] <role>'
    );
    expect(nestedHelp.stdout).toContain('--from-dag <file>');
  });
});

describe('peaks share top-level (P2-B.4 adapter/distribution e2e)', () => {
  // Slice 2026-07-30-nightshift: `peaks share` IS a registered
  // top-level command (G8.4 cross sub-agent shared channel); the
  // original test expected it to be NOT registered, but the
  // implementation has shipped `share` + `shared-read` + `await`
  // since 2.7.0. The test now asserts the real shape: the share
  // subcommand is registered and points at the share-commands
  // implementation.
  test('is registered: share subcommand is the super-command proxy for peaks-sub-agent-share', () => {
    // Slice 2026-07-30-nightshift: `peaks share` is a top-level
    // super-command that proxies to `peaks sub-agent share` (the
    // G8.4 cross-channel). The super-command body routes via
    // `peaks-sub-agent-share` from `src/cli/commands/_super.ts:111`
    // (the `registerFixed('share', 'peaks-sub-agent-share', ...)`
    // line). The actual G8.4 description lives on `peaks sub-agent
    // share --help`, not on `peaks share --help`. The test pins
    // the real shape.
    const help = runCli(['share', '--help'], REPO);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: peaks share [options]');
    expect(help.stdout).toContain('Hand off a sharing operation');
  });
});

describe('peaks capability list (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered; capability help advertises status and map instead', () => {
    const { help } = expectCommandNotRegistered(
      ['capability', 'list'],
      'peaks capability [options] [command]'
    );
    expect(help.stdout).toContain('status [options]');
    expect(help.stdout).toContain('map [options]');
  });
});

describe('peaks capability install (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered, so no destructive capability install is attempted', () => {
    expectCommandNotRegistered(['capability', 'install'], 'peaks capability [options] [command]');
  });
});

describe('peaks capability worker-config (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered', () => {
    expectCommandNotRegistered(
      ['capability', 'worker-config'],
      'peaks capability [options] [command]'
    );
  });
});

describe('peaks adapter list (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and reports an empty user adapter registry without writing it', () => {
    const project = makeProject('peaks-p2b4-adapter-list-');
    expectRegisteredHelp(['adapter', 'list'], 'peaks adapter list [options]', project);
    const result = runCli(['adapter', 'list', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseCliEnvelopeWith(result.stdout, adapterListPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('adapter.list');
    expect(envelope.data.records).toHaveLength(0);
    expect(envelope.data.count).toBe(0);
    expect(existsSync(envelope.data.file)).toBe(false);
  });
});
