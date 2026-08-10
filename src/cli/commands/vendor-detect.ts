/**
 * Phase B Task 20: peaks vendor-detect CLI.
 * Reports which vendor CLIs are installed on PATH + recommends default.
 * Spec: docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md §3.3
 */
import { defaultRegistry } from 'peaks-loop-internal-runtime';

export async function vendorDetect(opts: { json: boolean }) {
  const reg = defaultRegistry();
  const list = reg.list();
  const installed: string[] = [];
  for (const a of list) if (await a.detectInstalled()) installed.push(a.id);
  const recommended = installed[0] ?? null;
  return { ok: true, command: 'vendor-detect', data: { installed, recommended } };
}