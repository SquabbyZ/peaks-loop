import { describe, it, expect } from 'vitest';
import { CodexAdapter } from '../../../../packages/peaks-loop-internal-runtime/src/vendor/codex-adapter';

describe('CodexAdapter', () => {
  const a = new CodexAdapter();
  it('uses exec subcommand with --json', () => {
    const args = a.headlessArgs('do X');
    expect(args).toContain('exec');
    expect(args).toContain('--json');
    expect(args).toContain('do X');
  });
  it('parses JSON status', () => {
    const out = a.parseStatusLine(JSON.stringify({ progress: 10, state: 'running', note: 'n', ts: 1 }));
    expect(out).toMatchObject({ progress: 10, state: 'running', vendor: 'codex' });
  });
  it('returns null on garbage', () => { expect(a.parseStatusLine('xx')).toBeNull(); });
  it('detectInstalled returns boolean', async () => {
    expect(typeof await a.detectInstalled()).toBe('boolean');
  });
});