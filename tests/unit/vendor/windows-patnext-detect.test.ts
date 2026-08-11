import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import { ClaudeAdapter } from '../../../packages/peaks-loop-internal-runtime/src/vendor/claude-adapter';
import { CodexAdapter } from '../../../packages/peaks-loop-internal-runtime/src/vendor/codex-adapter';
import { CopilotAdapter } from '../../../packages/peaks-loop-internal-runtime/src/vendor/copilot-adapter';

const originalPlatform = process.platform;

describe('Windows vendor detection through PATHEXT', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    execFileMock.mockImplementation((_file, args, _options, callback) => {
      callback(null, `C:\\nvm4w\\nodejs\\${args[0]}.cmd\r\n`, '');
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.clearAllMocks();
  });

  it('detects claude, codex, and copilot with where.exe without a shell', async () => {
    const adapters = [new ClaudeAdapter(), new CodexAdapter(), new CopilotAdapter()];

    await expect(Promise.all(adapters.map((adapter) => adapter.detectInstalled())))
      .resolves.toEqual([true, true, true]);
    expect(execFileMock.mock.calls).toEqual([
      ['where.exe', ['claude'], { timeout: 3000 }, expect.any(Function)],
      ['where.exe', ['codex'], { timeout: 3000 }, expect.any(Function)],
      ['where.exe', ['copilot'], { timeout: 3000 }, expect.any(Function)],
    ]);
    expect(execFileMock.mock.calls.every((call) => call[2].shell === undefined)).toBe(true);
  });
});
