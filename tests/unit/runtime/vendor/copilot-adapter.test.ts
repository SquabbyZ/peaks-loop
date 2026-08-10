import { describe, it, expect } from 'vitest';
import { CopilotAdapter } from '../../../../packages/peaks-loop-internal-runtime/src/vendor/copilot-adapter';

describe('CopilotAdapter', () => {
  const a = new CopilotAdapter();
  it('uses -p with --output-format json', () => {
    const args = a.headlessArgs('do X');
    expect(args[args.indexOf('-p') + 1]).toBe('do X');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
  });
  it('parses JSON status', () => {
    const out = a.parseStatusLine(JSON.stringify({ progress: 50, state: 'running', note: 'n', ts: 1 }));
    expect(out).toMatchObject({ progress: 50, state: 'running', vendor: 'copilot' });
  });
  it('returns null on garbage', () => { expect(a.parseStatusLine('xx')).toBeNull(); });
  it('detectInstalled returns boolean', async () => {
    expect(typeof await a.detectInstalled()).toBe('boolean');
  });
});