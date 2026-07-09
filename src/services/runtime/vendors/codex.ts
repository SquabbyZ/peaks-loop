/**
 * Codex vendor adapter — slice S2-a.
 *
 * Stub adapter (PRD out-of-scope: full implementation lands in a
 * future slice). The detect() heuristic is intentionally permissive:
 * if CODEX_HOME or ~/.codex is present we report detected=true so
 * `peaks runtime detect` exercises the codex branch. compact() uses
 * the canonical `codex --compact` invocation; missing-binary is
 * reported as exitCode=127, not a thrown error (the runtime service
 * surfaces that as a warning + no-op so a missing vendor CLI does
 * not break peaks-loop).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  VendorAdapter,
  VendorCompactArgs,
  VendorCompactResult
} from '../vendor-adapter.js';

export class CodexAdapter implements VendorAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';

  async detect(): Promise<boolean> {
    if (process.env.CODEX_HOME !== undefined && process.env.CODEX_HOME.length > 0) return true;
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return home.length > 0 && existsSync(join(home, '.codex'));
  }

  async compact(args: VendorCompactArgs = {}): Promise<VendorCompactResult> {
    const argv = ['--compact'];
    if (args.force === true) argv.push('--force');
    return new Promise<VendorCompactResult>((resolveRun) => {
      const proc = spawn('codex', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
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