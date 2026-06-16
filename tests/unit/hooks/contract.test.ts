/**
 * Slice 003-2026-06-16-hook-governance — cross-platform contract test.
 *
 * AC3 requires that `process.platform` be mocked to `darwin`, `linux`, and
 * `win32` and that each helper produce the SAME stdout/stderr/exit-code
 * contract on all three. The contract is platform-independent by design
 * (we only write to process.stdout / process.stderr via ProgramIO, and the
 * hook payload is always Claude-Code-shaped JSON). This test pins that
 * guarantee so a future cross-platform regression (e.g. a win32-specific
 * line ending or a path-separator leak) cannot break the contract silently.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { emitBlock, emitDecision, emitHint } from '../../../src/services/hooks/output.js';

type Platform = NodeJS.Platform;

function mockPlatform(platform: Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_EXIT_CODE = process.exitCode;

const STDOUT: string[] = [];
const STDERR: string[] = [];
const IO = {
  stdout: (text: string) => STDOUT.push(text),
  stderr: (text: string) => STDERR.push(text)
};

function clearBuffers(): void {
  STDOUT.length = 0;
  STDERR.length = 0;
}

beforeEach(() => {
  clearBuffers();
  process.exitCode = undefined;
});

afterEach(() => {
  mockPlatform(ORIGINAL_PLATFORM);
  process.exitCode = ORIGINAL_EXIT_CODE;
  vi.restoreAllMocks();
});

const PLATFORMS: Platform[] = ['darwin', 'linux', 'win32'];

describe('emitHint contract (cross-platform)', () => {
  for (const platform of PLATFORMS) {
    test(`platform=${platform}: writes to stderr only, exit code unchanged`, () => {
      mockPlatform(platform);
      emitHint(IO, `hint on ${platform}`);
      expect(STDOUT.join('')).toBe('');
      expect(STDERR.join('')).toContain(`hint on ${platform}`);
      expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
    });
  }
});

describe('emitBlock contract (cross-platform)', () => {
  for (const platform of PLATFORMS) {
    test(`platform=${platform}: writes deny JSON to stdout, sets exit=2, surfaces reason on stderr`, () => {
      mockPlatform(platform);
      const reason = `reason on ${platform}`;
      const result = emitBlock(IO, reason);
      expect(result.stdout).toContain('"hookEventName":"PreToolUse"');
      expect(result.stdout).toContain('"permissionDecision":"deny"');
      const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: { permissionDecisionReason: string; permissionDecision: string; hookEventName: string } };
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(reason);
      expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
      expect(process.exitCode).toBe(2);
      expect(STDERR.join('')).toContain(reason);
    });
  }
});

describe('emitDecision contract (cross-platform)', () => {
  for (const platform of PLATFORMS) {
    test(`platform=${platform}: writes decision JSON to stdout, exit=0, preserves IDE-specific hookEventName`, () => {
      mockPlatform(platform);
      const decision = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `d on ${platform}`
        }
      };
      const result = emitDecision(IO, decision);
      expect(result).toBe(JSON.stringify(decision));
      expect(STDOUT.join('')).toBe(result + '\n');
      expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
    });
  }
});

describe('platform-independence invariant', () => {
  test('the deny JSON bytes are byte-for-byte identical across darwin/linux/win32 for the same reason', () => {
    const reason = 'invariant reason: same bytes everywhere';
    const snapshots: string[] = [];
    for (const platform of PLATFORMS) {
      mockPlatform(platform);
      clearBuffers();
      const result = emitBlock(IO, reason);
      snapshots.push(result.stdout);
    }
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(snapshots[1]).toBe(snapshots[2]);
  });

  test('emitHint output is byte-for-byte identical across darwin/linux/win32 for the same hint', () => {
    const hint = 'invariant hint: same bytes everywhere';
    const snapshots: string[] = [];
    for (const platform of PLATFORMS) {
      mockPlatform(platform);
      clearBuffers();
      emitHint(IO, hint);
      snapshots.push(STDERR.join(''));
    }
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(snapshots[1]).toBe(snapshots[2]);
  });
});
