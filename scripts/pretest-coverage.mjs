import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { platform } from 'node:os';

/**
 * Kill any leftover vitest processes.
 * @param {((cmd: string, options?: Record<string, unknown>) => void)} [runner] - exec function (injectable for testing)
 * @param {boolean} [isWin] - force platform (injectable for testing)
 */
export function killVitestProcesses(runner, isWin) {
  const exec = runner ?? execSync;
  const win = isWin ?? platform() === 'win32';

  try {
    if (win) {
      exec(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*vitest*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
        { stdio: 'ignore' }
      );
    } else {
      exec('pkill -f vitest 2>/dev/null', { stdio: 'ignore' });
    }
  } catch {
    // always ignore errors
  }
}

/**
 * Remove the coverage directory.
 * @param {(path: string, options: { recursive: boolean; force: boolean }) => void} [rm] - rm function (injectable for testing)
 */
export function cleanCoverageDir(rm) {
  const remove = rm ?? rmSync;
  remove('coverage', { recursive: true, force: true });
}

const imported = import.meta.url;
const called = process.argv[1];
if (imported === `file://${called}` || imported === `file:///${called}`.replace(/^\/*/, '/')) {
  killVitestProcesses();
  cleanCoverageDir();
}
