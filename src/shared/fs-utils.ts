import { symlinkSync as nodeSymlinkSync, readlinkSync } from 'node:fs';
import type { Platform } from './platform.js';
import { platform } from './platform.js';

export function getDirectoryLinkType(targetPlatform: Platform = platform): 'junction' | 'dir' {
  return targetPlatform === 'win32' ? 'junction' : 'dir';
}

export function createDirectoryLinkSync(target: string, linkPath: string): void {
  nodeSymlinkSync(target, linkPath, getDirectoryLinkType());
}

export function readDirectoryLinkTarget(linkPath: string): string | null {
  try {
    return readlinkSync(linkPath);
  } catch {
    return null;
  }
}
