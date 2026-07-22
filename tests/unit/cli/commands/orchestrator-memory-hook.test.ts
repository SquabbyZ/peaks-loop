import { describe, expect, test } from 'vitest';
import { buildDispatchSystemPrompt } from '../../../../src/services/context/build-dispatch-system-prompt.js';

describe('buildDispatchSystemPrompt', () => {
  test('returns original prompt when memory unavailable', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 'do thing',
      taskBody: 'explanation',
      memoryBlock: { available: false, reason: 'MEMORY_INDEX_MISSING' },
    });
    expect(out).toContain('explanation');
    expect(out).not.toContain('## Project memory relevant to this task');
  });

  test('prepends memory block when available', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 'do thing',
      taskBody: 'explanation',
      memoryBlock: { available: true, block: '## Project memory relevant to this task\n- foo' },
    });
    expect(out.indexOf('## Project memory relevant to this task'))
      .toBeLessThan(out.indexOf('explanation'));
  });

  test('memory block never pushed below the task brief', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 't',
      taskBody: 'TASK_BODY_MARKER',
      memoryBlock: { available: true, block: '## Project memory relevant to this task\n- x' },
    });
    expect(out).toContain('TASK_BODY_MARKER');
    expect(out.indexOf('## Project memory relevant to this task'))
      .toBeLessThan(out.indexOf('TASK_BODY_MARKER'));
  });
});
