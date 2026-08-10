/**
 * Phase D Task 24: peaks doctor invoke --from-code CLI.
 * Contract surface for peaks-code Step 11 → peaks-doctor bridge.
 * Writes proposal stub to .peaks/_runtime/<sid>/doctor/proposal.md.
 * Real LLM call is delegated to peaks-doctor (Phase D Task 24 detail).
 * Spec: docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md §3.6
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function doctorInvokeFromCode(opts: { sid: string; json: boolean }) {
  const dir = join('.peaks', '_runtime', opts.sid, 'doctor');
  mkdirSync(dir, { recursive: true });
  const proposalPath = join(dir, 'proposal.md');
  // Stub: real implementation invokes peaks-doctor sub-skill
  // (LLM-driven analysis of .peaks/_runtime/<sid>/txt/handoff.md
  // + dispatch records + autoCompactEvents; emits OpenSpec proposals).
  writeFileSync(proposalPath, [
    '# doctor proposal (stub)',
    '',
    '## capability: <TBD>',
    '## kind: <TBD>',
    '',
    'Real implementation: peaks-doctor LLM-driven analysis of',
    '.peaks/_runtime/<sid>/txt/handoff.md + dispatch records.',
  ].join('\n'));
  // Normalize to POSIX-style separators so callers (and tests) can rely
  // on a forward-slash contract regardless of host OS.
  const normalizedPath = proposalPath.replaceAll('\\', '/');
  return { ok: true, command: 'doctor.invoke.from-code', data: { proposalPath: normalizedPath } };
}