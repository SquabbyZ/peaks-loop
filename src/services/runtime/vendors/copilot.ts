/**
 * Copilot vendor adapter — slice S2-a.
 *
 * Stub adapter (PRD out-of-scope: full implementation lands in a
 * future slice). Copilot's compact verb is `copilot compact`
 * (subcommand form, not `--compact` flag — different from Claude
 * Code + Codex). The adapter encapsulates that verb here so the
 * runtime service + CLI never see it.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  VendorAdapter,
  VendorCompactArgs,
  VendorCompactResult
} from '../vendor-adapter.js';

export class CopilotAdapter implements VendorAdapter {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot';

  async detect(): Promise<boolean> {
    if (process.env.GITHUB_COPILOT === '1' || process.env.GITHUB_COPILOT === 'true') return true;
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return home.length > 0 && existsSync(join(home, '.copilot'));
  }

  async compact(args: VendorCompactArgs = {}): Promise<VendorCompactResult> {
    const argv = ['compact'];
    if (args.force === true) argv.push('--force');
    return new Promise<VendorCompactResult>((resolveRun) => {
      const proc = spawn('copilot', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      proc.on('error', (err) => {
        resolveRun({ exitCode: 127, stdout, stderr: stderr + (stderr.length > 0 ? '\n' : '') + err.message });
      });
      proc.on('close', (code) => {
        resolveRun({ exitCode: code ?? 0, stdout, stderr });
      });
    });
  }
}