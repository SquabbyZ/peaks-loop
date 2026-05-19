import { describe, expect, test } from 'vitest';
import { detectPlatform, platform, isWindows, isMac, isLinux } from '../../src/shared/platform.js';

describe('platform detection', () => {
  test('platform is one of supported values', () => {
    expect(['win32', 'darwin', 'linux']).toContain(platform);
  });

  test('detectPlatform maps win32 to win32', () => {
    expect(detectPlatform('win32')).toBe('win32');
  });

  test('detectPlatform maps darwin to darwin', () => {
    expect(detectPlatform('darwin')).toBe('darwin');
  });

  test('detectPlatform maps unknown platforms to linux', () => {
    expect(detectPlatform('freebsd' as NodeJS.Platform)).toBe('linux');
  });

  test('only one platform is true', () => {
    const platforms = [isWindows, isMac, isLinux];
    expect(platforms.filter(Boolean)).toHaveLength(1);
  });
});