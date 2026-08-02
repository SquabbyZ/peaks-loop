// tests/unit/commands/sub-agent-exec.test.ts
//
// Slice 4.0.7-PR-meta-6: verify `readDispatchRecordForExec` (the
// pure helper that backs the sub-agent exec CLI). The full
// command flow is exercised end-to-end in tests/integration.
//
// Run with: pnpm vitest run tests/unit/commands/sub-agent-exec.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDispatchRecordForExec } from '../../../src/cli/commands/sub-agent-exec-command.js';

describe('readDispatchRecordForExec (PR-meta-6)', () => {
  let root: string;
  let recordPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-exec-'));
    recordPath = join(root, 'dispatch-rid-foo.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the parsed record for a valid dispatch record', () => {
    writeFileSync(recordPath, JSON.stringify({
      toolCall: {
        name: 'Task',
        args: {
          subagent_type: 'general-purpose',
          description: 'rd for rid=foo',
          prompt: '## Test Tool Detection (mandatory)\n...'
        }
      },
      promptSize: 4748,
      originalPromptSize: 100,
      batchId: 'batch-xyz',
      rid: 'foo',
      role: 'rd',
      sessionId: 'sid-1'
    }));
    const record = readDispatchRecordForExec(recordPath);
    expect(record.toolCall?.name).toBe('Task');
    expect(record.promptSize).toBe(4748);
    expect(record.rid).toBe('foo');
    expect(record.role).toBe('rd');
  });

  it('throws DISPATCH_RECORD_MISSING when the file does not exist', () => {
    expect(() => readDispatchRecordForExec(join(root, 'missing.json')))
      .toThrow(/DISPATCH_RECORD_MISSING/);
  });

  it('returns the record even when toolCall is undefined (caller decides)', () => {
    writeFileSync(recordPath, JSON.stringify({ promptSize: 100 }));
    const record = readDispatchRecordForExec(recordPath);
    expect(record.toolCall).toBeUndefined();
    expect(record.promptSize).toBe(100);
  });
});
