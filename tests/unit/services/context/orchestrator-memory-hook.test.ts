import { describe, expect, test } from 'vitest';
import { buildDispatchSystemPrompt } from '../../../../src/services/context/build-dispatch-system-prompt.js';

describe('buildDispatchSystemPrompt', () => {
  test('returns taskBody byte-identically when memory unavailable (silent degradation)', () => {
    const taskBody = 'explanation';
    const out = buildDispatchSystemPrompt({
      taskTitle: 'do thing',
      taskBody,
      memoryBlock: { available: false, reason: 'MEMORY_INDEX_MISSING' },
    });
    // Slice 2026-07-29-worktree-l1: the L1 worktree-governance block
    // is prepended in EVERY branch (available / unavailable) so the
    // superpowers-chain refusal reaches the sub-agent before any task
    // content. The byte-identical degradation contract (slice 022)
    // still holds for the task-body portion: the caller composes
    // `${formatTestToolDetection()}\n\n${out}` and the taskBody sits
    // immediately after the L1 block.
    expect(out).toContain(taskBody);
    expect(out).not.toContain('## Project memory relevant to this task');
    // L1 block must be present even when memory is unavailable.
    expect(out).toContain('Superpowers chain refusal');
    expect(out.indexOf('Superpowers chain refusal')).toBeLessThan(out.indexOf(taskBody));
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
