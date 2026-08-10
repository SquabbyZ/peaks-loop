import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../../packages/peaks-loop-internal-runtime/src/vendor/claude-adapter';

describe('ClaudeAdapter', () => {
  const a = new ClaudeAdapter();

  it('builds headless args with -p and json output', () => {
    const args = a.headlessArgs('do X');
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('do X');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
  });

  it('parses a status JSON line', () => {
    const line = JSON.stringify({ progress: 42, state: 'running', note: 'writing', ts: 1 });
    const out = a.parseStatusLine(line);
    expect(out).toMatchObject({ progress: 42, state: 'running', note: 'writing', ts: 1 });
  });

  it('returns null on non-JSON', () => {
    expect(a.parseStatusLine('hello world')).toBeNull();
  });

  it('detects installed binary on PATH', async () => {
    const installed = await a.detectInstalled();
    expect(typeof installed).toBe('boolean');
  });
});