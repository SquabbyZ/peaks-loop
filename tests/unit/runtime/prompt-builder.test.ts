import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../../packages/peaks-loop-internal-runtime/src/prompt-builder';

const FORBIDDEN = '@@@ORCHESTRATOR_SESSION_HISTORY_BOUNDARY@@@';

describe('PromptBuilder', () => {
  it('does not include the forbidden orchestrator-history marker', () => {
    const pb = new PromptBuilder();
    const out = pb.assemble({
      rid: 'r1',
      role: 'rd',
      vendor: 'claude',
      files: ['src/auth/x.ts'],
      refs: ['.peaks/_runtime/.../prd/requests/r1.md'],
      userTask: 'do X',
    });
    expect(out).not.toContain(FORBIDDEN);
  });

  it('contains rid / role / vendor / user task', () => {
    const pb = new PromptBuilder();
    const out = pb.assemble({
      rid: 'r1', role: 'rd', vendor: 'claude',
      files: [], refs: [], userTask: 'do X',
    });
    expect(out).toMatch(/rid:\s*r1/);
    expect(out).toMatch(/role:\s*rd/);
    expect(out).toMatch(/vendor:\s*claude/);
    expect(out).toContain('do X');
  });

  it('rejects input that already contains forbidden marker', () => {
    const pb = new PromptBuilder();
    expect(() => pb.assemble({
      rid: 'r1', role: 'rd', vendor: 'claude',
      files: [], refs: [], userTask: FORBIDDEN,
    })).toThrow(/forbidden/);
  });
});