// tests/unit/cli/dispatch-audit-plan.test.ts
//
// Slice S2.2 — `peaks sub-agent dispatch rd` publishes `data.auditPlan` beside
// S2.1's `reviewPlan`. These cases drive the real command action against four
// real project shapes, so the envelope's profile/added fields are derived from
// `peaks scan archetype` rather than asserted from a fixture that could agree
// with a wrong derivation.
//
// The plan is also written to the session's dispatch record, which is what the
// handoff gate later reads; the integration arm proves that round trip off disk.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { createRequestArtifact } from '../../../src/services/artifacts/request-artifact-service.js';
import type { AuditPlan } from '../../../src/services/rd/stack-dimensions.js';
import { registerSubAgentCommands } from '../../../src/cli/commands/sub-agent-commands.js';

declareDimensions('tests/unit/cli/dispatch-audit-plan.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

interface DispatchEnvelope {
  readonly ok: boolean;
  readonly warnings: readonly string[];
  readonly data: {
    readonly auditPlan?: AuditPlan | null;
    readonly dispatchRecordPath: string;
  };
}

const SESSION_ID = 's2-2-audit-plan';

let project: string;
let ridSeq: number;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 's2-2-audit-plan-'));
  ridSeq = 0;
});

afterEach(() => {
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the tmp dir; it is reapable either way.
  }
});

function useProjectShape(packageJson: Record<string, unknown>): void {
  writeFileSync(join(project, 'package.json'), JSON.stringify(packageJson), 'utf8');
}

async function seedRequest(): Promise<string> {
  ridSeq += 1;
  const rid = `rid-audit-profile-${ridSeq}`;
  await createRequestArtifact({
    projectRoot: project,
    role: 'rd',
    requestId: rid,
    sessionId: SESSION_ID,
    apply: true,
    requestType: 'feature'
  });
  return rid;
}

async function runDispatch(role: string, requestId: string | null): Promise<DispatchEnvelope> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerSubAgentCommands(program, io);
  const args = [
    'sub-agent',
    'dispatch',
    role,
    '--prompt',
    's2.2 probe — audit plan',
    '--session-id',
    SESSION_ID,
    '--project',
    project,
    '--graph-node',
    'n1',
    '--json'
  ];
  if (requestId !== null) args.push('--request-id', requestId);
  await program.parseAsync(args, { from: 'user' });
  return JSON.parse(captured.text()) as DispatchEnvelope;
}

describe('(behavior) one envelope per stack profile', () => {
  async function dispatchProfile(packageJson: Record<string, unknown>): Promise<DispatchEnvelope> {
    useProjectShape(packageJson);
    const rid = await seedRequest();
    const env = await runDispatch('rd', rid);
    expect(env.data.auditPlan?.removed).toEqual([]);
    return env;
  }

  it('when the project looks like a frontend repository, should publish the frontend plan', async () => {
    // given: a React dependency and no backend evidence
    // when:  `peaks sub-agent dispatch rd` derives the audit plan
    // then:  the archetype scan reads as frontend-only
    const env = await dispatchProfile({ name: 'x', dependencies: { react: '18.3.1' } });
    expect(env.data.auditPlan?.profile).toBe('frontend');
  });

  it('when the project looks like a cli repository, should publish the cli plan', async () => {
    // given: a non-empty `bin` entry and no frontend or backend evidence
    // when:  the audit plan is derived
    // then:  the archetype scan reads as cli
    const env = await dispatchProfile({ name: 'x', bin: { x: './bin/x.js' } });
    expect(env.data.auditPlan?.profile).toBe('cli');
  });

  it('when the project looks like a backend repository, should publish the backend plan', async () => {
    // given: an express dependency and no frontend evidence
    // when:  the audit plan is derived
    // then:  the archetype scan reads as full-stack
    const env = await dispatchProfile({ name: 'x', dependencies: { express: '4.19.0' } });
    expect(env.data.auditPlan?.profile).toBe('backend');
  });

  it('when the project looks like a generic repository, should publish the generic plan', async () => {
    // given: a manifest with no stack signal at all
    // when:  the audit plan is derived
    // then:  the profile is named and nothing is added
    const env = await dispatchProfile({ name: 'x' });
    expect(env.data.auditPlan).toMatchObject({ profile: 'generic', added: [] });
  });

  it('when the stack is generic, should say why in a warning', async () => {
    // given: a project with no frontend, backend, or bin signal
    // when:  the plan is derived
    // then:  the warning carries the named reason
    useProjectShape({ name: 'x' });
    const rid = await seedRequest();
    const env = await runDispatch('rd', rid);
    expect(env.warnings.some((warning) => warning.includes('generic'))).toBe(true);
  });
});

describe('(render) the envelope field shape', () => {
  it('when the profile is frontend, should publish base and added beside reviewPlan', async () => {
    // given: a React project and a feature request
    // when:  the dispatch envelope is printed
    // then:  the four fields are exactly the documented ones
    useProjectShape({ name: 'x', dependencies: { react: '18.3.1' } });
    const rid = await seedRequest();
    const env = await runDispatch('rd', rid);
    expect(Object.keys(env.data.auditPlan ?? {}).sort()).toEqual([
      'added',
      'base',
      'profile',
      'removed'
    ]);
    expect(env.data.auditPlan?.added).toEqual([
      'security:xss',
      'security:csp',
      'perf:bundle',
      'perf:cold-start'
    ]);
  });

  it('when a non-rd role is dispatched, should omit the key entirely', async () => {
    // given: a frontend project and a reviewer role
    // when:  a non-rd sub-agent is dispatched
    // then:  the envelope shape is unchanged
    useProjectShape({ name: 'x', dependencies: { react: '18.3.1' } });
    const rid = await seedRequest();
    const env = await runDispatch('code-reviewer', rid);
    expect('auditPlan' in env.data).toBe(false);
  });
});

describe('(integration) the record carries the plan the gate will read', () => {
  it('when the dispatch writes its record, should persist the same auditPlan', async () => {
    // given: a CLI-shaped project and a feature request
    // when:  the dispatch completes and its record is read back
    // then:  disk and envelope agree, so the handoff gate sees the same plan
    useProjectShape({ name: 'x', bin: { x: './bin/x.js' } });
    const rid = await seedRequest();
    const env = await runDispatch('rd', rid);
    const record = JSON.parse(readFileSync(env.data.dispatchRecordPath, 'utf8')) as {
      auditPlan?: AuditPlan | null;
    };
    expect(record.auditPlan).toEqual(env.data.auditPlan);
    expect(record.auditPlan?.profile).toBe('cli');
  });

  it('when --request-id is absent, should publish null and name the reason', async () => {
    // given: a dispatch with no request to attach the plan to
    // when:  the audit plan is derived
    // then:  the plan is null and the warning names the missing input
    const env = await runDispatch('rd', null);
    expect(env.data.auditPlan).toBeNull();
    expect(env.warnings.some((warning) => warning.includes('no request id'))).toBe(true);
  });
});

describe('(a11y) the degraded path stays visible and successful', () => {
  it('when no plan can be derived, should still dispatch and name the remedy', async () => {
    // given: a dispatch with no --request-id
    // when:  the action completes
    // then:  dispatch succeeds, the warning is actionable, and exit is clean
    const env = await runDispatch('rd', null);
    expect(env.ok).toBe(true);
    expect(env.warnings.some((warning) => warning.includes('audit plan unavailable'))).toBe(true);
    expect(env.warnings.some((warning) => warning.includes('--request-id'))).toBe(true);
    expect(process.exitCode ?? 0).toBe(0);
  });
});
