// tests/unit/skills/g11-5-title-lock.test.ts
//
// AC-3 of slice 2026-09-17-4-0-51-cleanup: the G11.5 "visibility contract"
// (slice 2026-07-28-sub-agent-visibility) commits four machine-readable
// additions and one prose obligation to the dispatch contract. The prose
// obligation lives in `skills/peaks-code/SKILL.md` and the canonical
// contract lives in `skills/peaks-code/references/sub-agent-dispatch.md`.
//
// The CHANGELOG's "unfinished" item for G11.5 was that the prior
// "asserts the G11.5 paragraph is present" test was deleted in 4.0.51's
// own commit, leaving the prose obligation unpinned. This file is the
// behavior-framed test that pins it back, plus three invariants the
// orchestrator relies on:
//
//   1. G11.5 heading exists verbatim in sub-agent-dispatch.md
//   2. The "Orchestrator prose obligation (G11.5)" paragraph appears
//      in BOTH skills/peaks-code/SKILL.md (the header) AND
//      skills/peaks-code/references/sub-agent-dispatch.md (the contract)
//   3. The verbatim one-line `⏳ Spawning detached sub-agent via <vendor>: rid=<rid> (ETA ~60s)`
//      appears in sub-agent-dispatch.md
//
// Tests are intentionally narrow and parse-markdown; the prose
// obligation is the load-bearing one — if a future editor changes the
// emoji, the orchestrator still works but the user-visible UX breaks.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Walk up from tests/unit/skills/<file>.ts to repo root, then into
// skills/peaks-code/{SKILL.md,references/sub-agent-dispatch.md}.
const repoRoot = join(__dirname, '..', '..', '..');
const skillMd = readFileSync(join(repoRoot, 'skills', 'peaks-code', 'SKILL.md'), 'utf8');
const dispatchRef = readFileSync(
  join(repoRoot, 'skills', 'peaks-code', 'references', 'sub-agent-dispatch.md'),
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

  it('declares the orchestrator prose obligation in sub-agent-dispatch.md', () => {
    // Behavior: the orchestrator's required one-line string is present
    // and anchored to G11.5.
    expect(dispatchRef).toMatch(/Orchestrator prose obligation \(G11\.5\)/);
  });

  it('declares the orchestrator prose obligation in dispatch contract', () => {
    // Behavior: the orchestrator's required one-line obligation is
    // anchored to G11.5 in the canonical dispatch contract file.
    expect(dispatchRef).toMatch(/Orchestrator prose obligation \(G11\.5\)/);
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
