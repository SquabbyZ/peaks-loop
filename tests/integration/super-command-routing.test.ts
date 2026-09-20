import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runCli } from './_cli-helper.js';
import { parseCliEnvelope, parseCliEnvelopeWith } from '../../src/cli/cli-envelope.js';

// The `data` payloads this file reads at depth >= 2 (S12), replacing three
// hand-written `as { … }` casts on the parse result.
const routingPayload = z.looseObject({ routedSkill: z.string(), confidence: z.number() });
const routingWithAlternativesPayload = z.looseObject({
  routedSkill: z.string(),
  confidence: z.number(),
  alternatives: z.array(z.string())
});

const cwd = process.cwd();
const cases: Array<[string, string, string]> = [
  ['make', 'implement a CLI parser', 'peaks-code'],
  ['make', 'refactor the service', 'peaks-code'],
  ['make', 'write a blog article', 'peaks-content'],
  ['make', 'run a project health audit', 'peaks-doctor'],
  ['make', 'fix issues from open issues', 'peaks-issue-fix-orchestrator'],
  ['learn', 'author an SOP checklist', 'peaks-sop'],
  ['learn', 'document a procedure', 'peaks-sop'],
  ['learn', 'save this lesson to memory', 'peaks-solo sediment'],
  ['learn', 'sediment the lesson', 'peaks-solo sediment'],
  ['learn', 'capture a runbook', 'peaks-sop'],
  ['check', 'run red-lines audit', 'peaks-audit'],
  ['check', 'check project health', 'peaks-doctor'],
  ['check', 'scan security vulnerabilities', 'peaks-security-audit'],
  ['check', 'audit repository red lines', 'peaks-audit'],
  ['check', 'find leaked secrets', 'peaks-security-audit'],
  ['run', 'execute a workflow', 'peaks-workflow'],
  ['run', 'run the pipeline flow', 'peaks-workflow'],
  ['run', 'start a job batch', 'peaks-job'],
  ['run', 'run a slice', 'peaks-job'],
  ['run', 'dispatch a sub-agent', 'peaks-dispatch']
];

describe('super-command routing (rid-009)', () => {
  for (const [command, input, skill] of cases) {
    it(`routes ${command} ${input}`, async () => {
      const result = await runCli([command, input], cwd);
      const envelope = parseCliEnvelopeWith(result.stdout, routingPayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.data.routedSkill).toBe(skill);
      expect(envelope.data.confidence).toBeGreaterThan(0.5);
    });
  }

  it('routes ask to peaks-solo', async () => {
    const result = await runCli(['ask', 'which skill fits this request'], cwd);
    expect(parseCliEnvelope(result.stdout).data.routedSkill).toBe('peaks-solo');
  });
  it('returns fixed ops envelopes', async () => {
    for (const [command, skill] of [
      ['share', 'peaks-sub-agent-share'],
      ['version', 'peaks-version'],
      ['status', 'peaks-status']
    ] as const) {
      const result = await runCli([command], cwd);
      expect(parseCliEnvelope(result.stdout).data.routedSkill).toBe(skill);
    }
  });
  it('prints the nine-entry catalog for bare peaks', async () => {
    const result = await runCli([], cwd);
    expect(result.stdout).toContain('Peaks super-command catalog');
    expect(result.stdout).toContain('make —');
    expect(result.stdout).toContain('status —');
  });

  it('routes multi-word NL input via keyword disambiguation', async () => {
    const result = await runCli(['make', 'help me ship this feature end-to-end'], cwd);
    const envelope = parseCliEnvelopeWith(result.stdout, routingPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.routedSkill).toBe('peaks-code');
    expect(envelope.data.confidence).toBeGreaterThan(0.5);
  });

  it('reports alternatives array for ambiguous goal with low confidence', async () => {
    const result = await runCli(['make', 'xyz123 random gibberish text'], cwd);
    const envelope = parseCliEnvelopeWith(result.stdout, routingWithAlternativesPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.routedSkill).toBe('peaks-code');
    expect(envelope.data.confidence).toBeLessThan(0.7);
    expect(envelope.data.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(envelope.data.alternatives).toContain('peaks-content');
    expect(envelope.data.alternatives).toContain('peaks-doctor');
  });

  it('prints every remaining catalog entry plus the dispatcher hint', async () => {
    const result = await runCli([], cwd);
    for (const entry of ['learn —', 'check —', 'run —', 'share —', 'version —', 'ask —']) {
      expect(result.stdout).toContain(entry);
    }
    expect(result.stdout).toContain('Choose a surface');
  });
});
