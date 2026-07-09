/**
 * Claude Code vendor adapter — slice S2-a.
 *
 * Stubs the compact verb to `claude --compact` (the canonical vendor
 * verb for Claude Code). The actual binary is invoked via spawn so
 * the adapter does NOT block peaks-loop. When the `claude` binary is
 * not on PATH the adapter returns exitCode=127 + stderr explaining
 * the missing binary, which the runtime service surfaces as a warning
 * + no-op rather than a fatal error (vendor-neutrality: peaks-loop
 * should still work even when the host vendor CLI is absent).
 */
import { spawn } from 'node:child_process';
import type {
  VendorAdapter,
  VendorCompactArgs,
  VendorCompactResult
} from '../vendor-adapter.js';

export class ClaudeCodeAdapter implements VendorAdapter {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';

  async detect(): Promise<boolean> {
    return process.env.CLAUDE_CODE === '1'
      || process.env.CLAUDE_CODE === 'true'
      || (process.env.CLAUDE_CODE_ENTRYPOINT?.length ?? 0) > 0;
  }

  async compact(args: VendorCompactArgs = {}): Promise<VendorCompactResult> {
    const argv = ['--compact'];
    if (args.force === true) argv.push('--force');
    return new Promise<VendorCompactResult>((resolveRun) => {
      const proc = spawn('claude', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
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