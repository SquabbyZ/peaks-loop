// tests/unit/skills/g11-5-title-lock.test.ts
//
// AC-3 of slice 2026-09-17-4-0-51-cleanup: the G11.5 "visibility contract"
// (slice 2026-07-28-sub-agent-visibility) commits four machine-readable
// additions and one prose obligation to the dispatch contract.
//
// ---------------------------------------------------------------------------
// 2026-09-18 (slice D2) — this file was HALF-CLOSED and was rewritten.
//
// Defect 1 — one assertion, counted twice. Cases 2 and 3 were the SAME
//   assertion: the same regex (`/Orchestrator prose obligation \(G11\.5\)/`)
//   against the same string (`dispatchRef`). The file comment claimed the
//   paragraph appears "in BOTH skills/peaks-code/SKILL.md (the header) AND
//   skills/peaks-code/references/sub-agent-dispatch.md (the contract)", so
//   the two cases LOOKED like the two halves of that claim — but they
//   collapsed onto one file and the `skillMd` read at the top of the file
//   was never asserted on. Merged into one case below.
//
//   Why the SKILL.md half is NOT asserted here: `skills/peaks-code/SKILL.md`
//   does not carry the `Orchestrator prose obligation (G11.5)` paragraph. It
//   carries the DETACHED-dispatch counterpart (`⏳ Spawning detached
//   sub-agent via <vendor>: rid=<rid> (ETA ~60s)`, line 40). Asserting the
//   G11.5 paragraph against SKILL.md would go red today, and making it green
//   would mean ADDING a product obligation to SKILL.md — out of scope for a
//   pin-repair slice. The dead read is deleted and the claim corrected
//   instead. Recorded in
//   `.peaks/_runtime/2026-09-17-session-607ead/rd/tech-doc-rid-d2-false-pins.md`.
//
// Defect 2 — the wrong file was pinned. The test this contract names
//   (`tests/unit/dispatch/sub-agent-visibility-envelope.test.ts`, case
//   "peaks-rd rd-sub-agent-dispatch.md has a G11.5 heading") parsed
//   `skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md`. AC-3 pinned
//   only the peaks-code SIBLING of that file, so the rd-side heading stayed
//   unpinned and `rd-sub-agent-dispatch.md` still read "Regression guard:
//   none". Case 3 below closes that gap by pinning the rd-side heading and
//   the rd-side prose form.
// ---------------------------------------------------------------------------
//
// Tests are intentionally narrow and parse-markdown; the prose obligation is
// the load-bearing one — if a future editor changes the emoji, the
// orchestrator still works but the user-visible UX breaks.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Walk up from tests/unit/skills/<file>.ts to repo root, then into the
// two dispatch-contract files the G11.5 contract lives in: the peaks-code
// orchestrator contract and the peaks-rd bee's dispatch reference.
const repoRoot = join(__dirname, '..', '..', '..');
const dispatchRef = readFileSync(
  join(repoRoot, 'skills', 'peaks-code', 'references', 'sub-agent-dispatch.md'),
  'utf8'
);
const rdDispatchRef = readFileSync(
  join(repoRoot, 'skills', 'bee', 'peaks-rd', 'references', 'rd-sub-agent-dispatch.md'),
  'utf8'
);

describe('G11.5 visibility contract — AC-3 title-lock baseline', () => {
  it('declares the G11.5 heading in sub-agent-dispatch.md', () => {
    // Behavior: the contract file has a stable heading for the rule.
    // Pinned on the EXACT title text so a complete rename breaks the
    // test (which is the point of a title-lock). The title was
    // introduced in slice 2026-07-28-sub-agent-visibility.
    expect(dispatchRef).toMatch(/^## G11\.5 — visibility contract \(slice 2026-07-28-sub-agent-visibility\)$/m);
  });

  it('declares the orchestrator prose obligation in the dispatch contract', () => {
    // Behavior: the orchestrator's required one-line obligation is
    // anchored to G11.5 in the canonical dispatch contract file. This is
    // the whole of that assertion — it was previously written twice, over
    // the same file, which inflated the case count without adding coverage.
    expect(dispatchRef).toMatch(/Orchestrator prose obligation \(G11\.5\)/);
  });

  it('declares the G11.5 heading + prose form in the RD bee dispatch reference', () => {
    // Behavior: the peaks-rd sibling carries its own G11.5 heading, and it
    // is the file the deleted `sub-agent-visibility-envelope.test.ts` case
    // actually parsed. With only the peaks-code sibling pinned, this file
    // could drop its heading while every case stayed green.
    expect(rdDispatchRef).toMatch(/^## G11\.5 visibility contract \(mandatory, slice 2026-07-28-sub-agent-visibility\)$/m);
    expect(rdDispatchRef).toMatch(/⏳\s*Spawning sub-agent via Task tool:\s*<description>/);
  });

  it('pins the verbatim one-line format the orchestrator must emit for detached dispatch', () => {
    // Behavior: the detached-dispatch substring must be present
    // verbatim. The orchestrator's "echo verbatim" obligation has
    // nothing to echo if the contract moves the text.
    expect(dispatchRef).toContain(
      '⏳ Spawning detached sub-agent via <vendor>: rid=<rid> (ETA ~60s)'
    );
  });

  it('pins the verbatim one-line format the orchestrator must emit for in-process dispatch', () => {
    // Behavior: the in-process variant uses `Task tool` not `detached
    // sub-agent`, and the substring must be present too. Both
    // branches carry a separate "echo verbatim" obligation.
    expect(dispatchRef).toContain(
      '⏳ Spawning sub-agent via Task tool: <role> for rid=<rid>, batch-id=<batchId> (ETA ~<seconds>s)'
    );
  });
});
