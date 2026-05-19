export type Platform = 'win32' | 'darwin' | 'linux';

export function detectPlatform(currentPlatform: NodeJS.Platform = process.platform): Platform {
  if (currentPlatform === 'win32') return 'win32';
  if (currentPlatform === 'darwin') return 'darwin';
  return 'linux';
}

export const platform: Platform = detectPlatform();
export const isWindows = platform === 'win32';
export const isMac = platform === 'darwin';
export const isLinux = platform === 'linux';