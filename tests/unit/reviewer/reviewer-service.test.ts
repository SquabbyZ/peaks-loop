import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  distinctFromKarpathy,
  extractFirstJsonObject,
  REVIEWER_ID,
  runReviewer,
  validateReviewerEnvelope
} from '../../../src/services/reviewer/reviewer-service.js';

const ORIGINAL_HOME = process.env['HOME'];
const ORIGINAL_USERPROFILE = process.env['USERPROFILE'];
const ORIGINAL_ANT = process.env['ANTHROPIC_API_KEY'];
const ORIGINAL_OAI = process.env['OPENAI_API_KEY'];

let tmpHome: string;
let configPath: string;

function writeConfig(payload: object): void {
  writeFileSync(configPath, JSON.stringify(payload, null, 2));
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'peaks-reviewer-'));
  process.env['HOME'] = tmpHome;
  process.env['USERPROFILE'] = tmpHome;
  configPath = join(tmpHome, '.peaks', 'config.json');
  // Pre-create the directory so the loader finds it.
  const { mkdirSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(join(tmpHome, '.peaks'), { recursive: true });
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['OPENAI_API_KEY'];
});

afterEach(() => {
  if (ORIGINAL_HOME !== undefined) process.env['HOME'] = ORIGINAL_HOME; else delete process.env['HOME'];
  if (ORIGINAL_USERPROFILE !== undefined) process.env['USERPROFILE'] = ORIGINAL_USERPROFILE; else delete process.env['USERPROFILE'];
  if (ORIGINAL_ANT !== undefined) process.env['ANTHROPIC_API_KEY'] = ORIGINAL_ANT;
  if (ORIGINAL_OAI !== undefined) process.env['OPENAI_API_KEY'] = ORIGINAL_OAI;
  rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('reviewer-service.ts', () => {
  it('returns skipped envelope when ~/.peaks/config.json is absent (no-reviewer-config)', async () => {
    // No file written — loader returns ok:false.
    const result = await runReviewer({ rid: 'slice-1', context: 'ctx' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-reviewer-config');
    expect(result.envelope.reviewerId).toBe(REVIEWER_ID);
    expect(result.envelope.modelId).toBe('skipped');
    expect(result.envelope.modelFamily).toBe('skipped');
    expect(result.envelope.passed).toBe(true);
    expect(result.envelope.gateAction).toBe('allow');
    expect(result.envelope.reason).toMatch(/no-reviewer-config/);
  });

  it('returns skipped envelope when reviewer.providers has fewer than 2 entries', async () => {
    writeConfig({
      version: '2.14.0',
      reviewer: {
        providers: [{ name: 'ollama', model: 'llama3.2:8b' }]
      }
    });
    const result = await runReviewer({ rid: 'slice-1', context: 'ctx' });
    expect(result.ok).toBe(false);
  });

  it('calls ollama when ollama is selected and parses a fence-wrapped envelope', async () => {
    writeConfig({
      version: '2.14.0',
      reviewer: {
        providers: [
          { name: 'ollama', model: 'llama3.2:8b', endpoint: 'http://x:11434' },
          { name: 'anthropic', model: 'claude-haiku-4-5' }
        ],
        selection: 'round-robin',
        fallbackOnError: 'skip'
      }
    });
    const envelope = {
      reviewerId: 'third-party-reviewer-v2.14.0',
      modelId: 'llama3.2:8b',
      modelFamily: 'llama',
      passed: true,
      violations: [],
      gateAction: 'allow',
      reason: 'all good'
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: '```json\n' + JSON.stringify(envelope) + '\n```' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await runReviewer({ rid: 'slice-ollama', context: 'ctx', fetchImpl: fetchMock as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.modelFamily).toBe('llama');
    expect(result.envelope.gateAction).toBe('allow');
    expect(result.envelope.passed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('anthropic: missing API key surfaces as warn envelope with fallbackOnError=skip', async () => {
    writeConfig({
      version: '2.14.0',
      reviewer: {
        providers: [
          { name: 'anthropic', model: 'claude-haiku-4-5' },
          { name: 'ollama', model: 'llama3.2:8b' }
        ],
        selection: 'hash',
        fallbackOnError: 'skip'
      }
    });
    const result = await runReviewer({ rid: 'slice-ant', context: 'ctx' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.gateAction).toBe('warn');
    expect(result.envelope.reason).toMatch(/missing env ANTHROPIC_API_KEY/);
  });

  it('openai: HTTP 401 downgrades to warn envelope (fallbackOnError=skip)', async () => {
    writeConfig({
      version: '2.14.0',
      reviewer: {
        providers: [
          { name: 'openai', model: 'gpt-4o-mini' },
          { name: 'anthropic', model: 'claude-haiku-4-5' }
        ],
        selection: 'hash',
        fallbackOnError: 'skip'
      }
    });
    process.env['OPENAI_API_KEY'] = 'sk-test-fake';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const result = await runReviewer({ rid: 'slice-oai', context: 'ctx', fetchImpl: fetchMock as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.gateAction).toBe('warn');
    expect(result.envelope.reason).toMatch(/openai http 401/);
  });

  it('openai: throw + transition blocked when fallbackOnError=error', async () => {
    writeConfig({
      version: '2.14.0',
      reviewer: {
        providers: [
          { name: 'openai', model: 'gpt-4o-mini' },
          { name: 'anthropic', model: 'claude-haiku-4-5' }
        ],
        selection: 'hash',
        fallbackOnError: 'error'
      }
    });
    process.env['OPENAI_API_KEY'] = 'sk-test-fake';
    const fetchMock = vi.fn(async () => { throw new Error('network down'); });
    await expect(runReviewer({ rid: 'slice-oai-err', context: 'ctx', fetchImpl: fetchMock as unknown as typeof fetch })).rejects.toThrow(/openai/);
  });

  it('stamps modelFamily from modelId — LLM cannot lie about its family (AC-4.4)', async () => {
    writeConfig({
      version: '2.14.0',
      reviewer: {
        providers: [
          { name: 'ollama', model: 'llama3.2:8b', endpoint: 'http://x:11434' },
          { name: 'anthropic', model: 'claude-haiku-4-5' }
        ],
        selection: 'round-robin',
        fallbackOnError: 'skip'
      }
    });
    // LLM tries to claim it is "claude" — service overwrites.
    const envelope = {
      reviewerId: 'third-party-reviewer-v2.14.0',
      modelId: 'llama3.2:8b',
      modelFamily: 'claude',
      passed: true,
      violations: [],
      gateAction: 'allow',
      reason: 'trust me'
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: JSON.stringify(envelope) } }), { status: 200 }));
    const result = await runReviewer({ rid: 'slice-llama', context: 'ctx', fetchImpl: fetchMock as unknown as typeof fetch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.modelFamily).toBe('llama');
  });

  it('hash mode is deterministic across runs (AC-4.6)', async () => {
    writeConfig({
      version: '2.14.0',
      reviewer: {
        providers: [
          { name: 'ollama', model: 'llama3.2:8b', endpoint: 'http://x:11434' },
          { name: 'anthropic', model: 'claude-haiku-4-5' }
        ],
        selection: 'hash',
        fallbackOnError: 'skip'
      }
    });
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { model: string };
      calls.push(body.model);
      const envelope = {
        reviewerId: 'third-party-reviewer-v2.14.0',
        modelId: body.model,
        modelFamily: 'x',
        passed: true,
        violations: [],
        gateAction: 'allow',
        reason: 'ok'
      };
      return new Response(JSON.stringify({ message: { content: JSON.stringify(envelope) } }), { status: 200 });
    });
    const a = await runReviewer({ rid: 'rid-stable', context: 'ctx', fetchImpl: fetchMock as unknown as typeof fetch });
    const b = await runReviewer({ rid: 'rid-stable', context: 'ctx', fetchImpl: fetchMock as unknown as typeof fetch });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.envelope.modelId).toBe(b.envelope.modelId);
  });

  it('round-robin cycles across providers across slices (AC-4.6)', async () => {
    writeConfig({
      version: '2.14.0',
      reviewer: {
        providers: [
          { name: 'ollama', model: 'llama3.2:8b', endpoint: 'http://x:11434' },
          { name: 'anthropic', model: 'claude-haiku-4-5' },
          { name: 'openai', model: 'gpt-4o-mini' }
        ],
        selection: 'round-robin',
        fallbackOnError: 'skip'
      }
    });
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-fake';
    process.env['OPENAI_API_KEY'] = 'sk-oai-fake';
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown, init: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      const body = JSON.parse(init.body as string) as { model: string };
      calls.push(body.model);
      const envelope = {
        reviewerId: 'third-party-reviewer-v2.14.0',
        modelId: body.model,
        modelFamily: 'x',
        passed: true,
        violations: [],
        gateAction: 'allow',
        reason: 'ok'
      };
      // Route response by url pattern.
      if (url.includes('11434')) {
        return new Response(JSON.stringify({ message: { content: JSON.stringify(envelope) } }), { status: 200 });
      }
      if (url.includes('anthropic')) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(envelope) }] }), { status: 200 });
      }
      // openai
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(envelope) } }] }), { status: 200 });
    });
    // Thread state across slices — the swarm owns the cursor; this is
    // how a real cross-slice round-robin is implemented.
    let state: { mode: 'round-robin'; cursor: number } = { mode: 'round-robin', cursor: 0 };
    const r1 = await runReviewer({ rid: 'rr-1', context: 'ctx', fetchImpl: fetchMock as unknown as typeof fetch, state });
    const r2 = await runReviewer({ rid: 'rr-2', context: 'ctx', fetchImpl: fetchMock as unknown as typeof fetch, state: r1.ok ? r1.nextState : state });
    const r3 = await runReviewer({ rid: 'rr-3', context: 'ctx', fetchImpl: fetchMock as unknown as typeof fetch, state: r2.ok ? r2.nextState : state });
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    expect(calls).toEqual(['llama3.2:8b', 'claude-haiku-4-5', 'gpt-4o-mini']);
  });

  it('validates ReviewerEnvelope shape (mustContain all required fields)', () => {
    const good = {
      reviewerId: 'r', modelId: 'm', modelFamily: 'f', passed: true,
      violations: [{ kind: 'code-smell', file: 'src/a.ts', line: 1, hint: 'h' }],
      gateAction: 'allow', reason: 'r'
    };
    expect(validateReviewerEnvelope(good)).not.toBeNull();
    expect(validateReviewerEnvelope(null)).toBeNull();
    expect(validateReviewerEnvelope({ ...good, gateAction: 'nope' })).toBeNull();
    expect(validateReviewerEnvelope({ ...good, passed: 'yes' as unknown as boolean })).toBeNull();
    expect(validateReviewerEnvelope({ ...good, violations: [{ kind: 'unknown', file: 'a', line: 0, hint: 'h' }] })).toBeNull();
    expect(validateReviewerEnvelope({ ...good, violations: [{ kind: 'code-smell', file: '', line: 0, hint: '' }] })).toBeNull();
    expect(validateReviewerEnvelope({ ...good, violations: [{ kind: 'code-smell', file: 'a', line: -1, hint: 'h' }] })).toBeNull();
    expect(validateReviewerEnvelope('not-an-object')).toBeNull();
  });

  it('extractFirstJsonObject handles fenced + brace-balanced JSON', () => {
    expect(extractFirstJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractFirstJsonObject('preamble {"a":2} trailing')).toEqual({ a: 2 });
    expect(extractFirstJsonObject('no json here')).toBeNull();
    expect(extractFirstJsonObject('{not valid')).toBeNull();
    expect(extractFirstJsonObject('```\n{"x":[1,2,3]}\n```')).toEqual({ x: [1, 2, 3] });
  });

  it('distinctFromKarpathy: same family => false; skipped => true; different => true', () => {
    expect(distinctFromKarpathy('claude', 'claude')).toBe(false);
    expect(distinctFromKarpathy('skipped', 'claude')).toBe(true);
    expect(distinctFromKarpathy('claude', 'gpt-4o')).toBe(true);
    expect(distinctFromKarpathy('llama', 'claude')).toBe(true);
  });

  it('skipped envelope never blocks (A4.3): gateAction=allow, passed=true', () => {
    writeConfig({ version: '2.14.0' });
    return runReviewer({ rid: 'rid', context: 'ctx' }).then((result) => {
      if (result.ok) throw new Error('expected ok:false for no-reviewer-config');
      expect(result.envelope.gateAction).toBe('allow');
      expect(result.envelope.passed).toBe(true);
      expect(result.envelope.violations).toEqual([]);
    });
  });
});
