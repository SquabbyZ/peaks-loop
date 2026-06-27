/**
 * v2.13.1 Group A — micro-cycle.md verdict reasoning section pins.
 *
 * Parses `skills/peaks-solo/references/micro-cycle.md` as text and
 * asserts the new "## Verdict reasoning" section carries the three
 * required pieces (per AC-3):
 *
 *   1. A re-run output example showing a multi-signal failure case.
 *   2. A `return-to-rd` vs `block` decision table.
 *   3. Runbook guidance on when/how to print `reasons` before a re-run.
 *
 * The test does NOT execute micro-cycle — it pins the document so a
 * refactor that drops the section fails the suite.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const microCyclePath = resolve(__dirname, '..', '..', '..', '..', 'skills', 'peaks-solo', 'references', 'micro-cycle.md');

function extractSection(body: string, heading: string): string {
  const start = body.indexOf(heading);
  if (start < 0) return '';
  const afterHeading = start + heading.length;
  const lineEnd = body.indexOf('\n', afterHeading);
  if (lineEnd < 0) return '';
  const rest = body.slice(lineEnd + 1);
  const nextHeading = rest.search(/^## /m);
  return nextHeading < 0 ? rest : rest.slice(0, nextHeading);
}

const body = readFileSync(microCyclePath, 'utf8');

describe('v2.13.1 micro-cycle.md ## Verdict reasoning section', () => {
  test('section exists and is reachable from the document', () => {
    const section = extractSection(body, '## Verdict reasoning');
    expect(section.length).toBeGreaterThan(0);
    // Marker phrase that uniquely identifies v2.13.1 reasoning layer.
    expect(section).toContain('依据');
  });

  test('single-signal failure case: re-run output example with security-audit CRITICAL', () => {
    const section = extractSection(body, '## Verdict reasoning');
    // The example must show a multi-signal failure payload (the PRD
    // pins "1 个 re-run 输出示例（mock 的多 signal 失败 case）").
    expect(section).toMatch(/re-run reason/i);
    // The example JSON should show a security-audit CRITICAL block.
    expect(section).toContain('"source": "security-audit"');
    expect(section).toContain('"severity": "CRITICAL"');
    // The example should aggregate to a top-level block verdict.
    expect(section).toContain('"verdict": "block"');
  });

  test('multi-signal failure case: re-run reasons include peaks-mut + peaks-qa alongside security-audit', () => {
    const section = extractSection(body, '## Verdict reasoning');
    // Multi-signal coverage: at least peaks-mut + peaks-qa must be
    // represented in the example reasons array.
    expect(section).toContain('"source": "peaks-mut"');
    expect(section).toContain('"source": "peaks-qa"');
    // The mut reason should carry the kind/actual/threshold trio.
    expect(section).toContain('"kind": "mutationKillRateMin"');
    expect(section).toContain('"actual": 0.62');
    expect(section).toContain('"threshold": 0.8');
    // The qa reason should carry return-to-rd signal.
    expect(section).toContain('"signal": "return-to-rd"');
  });

  test('priority ordering case: decision table maps return-to-rd → repair loop, block → blocked TXT', () => {
    const section = extractSection(body, '## Verdict reasoning');
    // The decision table must contain the two key rows.
    expect(section).toMatch(/return-to-rd.*repair loop|repair loop.*return-to-rd/si);
    expect(section).toMatch(/block.*blocked TXT handoff|blocked TXT handoff.*block/si);
    // The precedence ladder must be reproduced verbatim.
    expect(section).toContain('block > return-to-rd > warn > pass');
    // The decision table must enumerate all 4 verdict outcomes.
    expect(section).toContain('`pass`');
    expect(section).toContain('`warn`');
    expect(section).toContain('`return-to-rd`');
    expect(section).toContain('`block`');
  });
});