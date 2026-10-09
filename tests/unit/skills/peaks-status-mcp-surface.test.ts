// tests/unit/skills/peaks-status-mcp-surface.test.ts
//
// PRD rid-036 AC-9: `peaks-status`'s read paths move onto the MCP tool, and the
// Bash path stays available and unchanged when it is not.
//
// WHY THIS IS ASSERTED ON THE TEXT. A skill is instructions, so "the skill uses
// the tool" is only true if the instructions say so — and "the fallback still
// works" is only true if the commands are still there. Both are checkable in the
// artifact itself, which is what these cases do.
//
// The claims are anchored to what the SURFACE declares rather than to prose:
// every argv the tool runs must appear in the skill too, because the fallback is
// only a fallback if it reproduces the same read.
//
// Dimensions covered: render, behavior, integration, a11y.
// Omitted: none.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { skillsDir } from 'peaks-loop-shared/paths';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/skills/peaks-status-mcp-surface.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SKILL_PATH = join(skillsDir, 'peaks-status', 'SKILL.md');
const SKILL = readFileSync(SKILL_PATH, 'utf8');

/** The generated read-only whitelist, read as DATA — this file tests the skill, not the server. */
const READONLY_ARTIFACT = join(process.cwd(), 'contracts', 'readonly-argv-whitelist.json');

interface ArgvSegment {
  readonly kind: 'literal' | 'param';
  readonly value?: string;
  readonly name?: string;
}

/** Every argv of the tool that owns the status read paths, from the artifact. */
function statusToolArgv(): readonly string[] {
  const artifact = JSON.parse(readFileSync(READONLY_ARTIFACT, 'utf8')) as {
    entries: Array<{ tool: string; argv: ArgvSegment[] }>;
  };
  const owned = artifact.entries.filter((entry) => entry.tool === 'peaks_status');
  if (owned.length === 0) throw new Error('whitelist declares no peaks_status entries');
  return owned.map((entry) =>
    entry.argv
      .map((segment) => (segment.kind === 'literal' ? (segment.value ?? '') : `<${segment.name}>`))
      .join(' ')
  );
}

describe('Scenario: render - the skill names the tool it uses', () => {
  it('when the skill is read, should tell the reader to call peaks_status once', () => {
    // given: the skill text
    // when:  the MCP step is looked for
    // then:  the tool is named as the primary path, and the three keys it
    //        returns are named so the reader knows what one call bought
    expect(SKILL).toContain('peaks_status');
    for (const key of ['skill-presence', 'session-list', 'request-show']) {
      expect(SKILL, key).toContain(key);
    }
  });
});

/**
 * The Step 1b Bash fallback block: its heading through the next one.
 *
 * The case below scopes to THIS slice of the document on purpose. A substring
 * search over the whole file is also satisfied by the Step 1a prose, which spells
 * the request-show template out once as narrative — so the fallback commands
 * could be deleted and the arm would stay green, which is what QA measured
 * (repair cycle 1, F-3). Anchoring to the block is what makes "the fallback
 * reproduces the read" the thing under test.
 */
function bashFallbackBlock(): string {
  const start = SKILL.indexOf('### 1b');
  const end = SKILL.indexOf('### 1c');
  if (start < 0 || end <= start) throw new Error('SKILL.md is missing the Step 1b / 1c headings');
  return SKILL.slice(start, end);
}

describe('Scenario: behavior - the fallback reproduces the reads it replaces', () => {
  it('when the fallback is read, should carry every argv the tool runs', () => {
    // given: the argv the tool actually executes
    const argv = statusToolArgv();
    expect(argv.length).toBeGreaterThan(1);
    // when:  the FALLBACK block is read - not the whole document, which would
    //        also accept the template written once as Step 1a prose
    const fallback = bashFallbackBlock();
    // then:  each one is spelled out IN THE FALLBACK, so deleting the fallback
    //        turns this red and a reader without the tool gets the same data
    //        rather than a paraphrase of it
    for (const command of argv) {
      expect(fallback, command).toContain(command);
    }
  });

  it('when the tool cannot answer, should say so instead of rendering a partial table', () => {
    // given: the skill text
    // when:  the failure clause is looked for
    // then:  a failed call routes to the Bash commands, and the reader is told
    //        not to pass a partial read off as the whole picture
    expect(SKILL).toContain('isError');
    expect(SKILL).toMatch(/fall back|fallback/i);
    expect(SKILL).toMatch(/not an empty answer|not "nothing there"|not an absence/i);
  });
});

describe('Scenario: integration - what is NOT on the surface stays on Bash', () => {
  it('when the excluded command is read, should stay a Bash call with its reason', () => {
    // given: `peaks project dashboard`, excluded from the read-only surface
    //        because it spawns git to resolve the project root
    // when:  the skill text is read
    // then:  it is still instructed as a command, and the exclusion is stated -
    //        a reader who noticed the asymmetry would otherwise re-add it
    expect(SKILL).toContain('project dashboard');
    expect(SKILL).toMatch(/git|read-only/i);
  });
});

describe('Scenario: a11y - the instructions stay followable by a reader who has neither', () => {
  it('when the MCP step is read, should name the tool and the Bash alternative in the same place', () => {
    // given: the skill text
    // when:  the step that owns the read is read
    // then:  both paths are reachable from it, so no reader has to guess what to
    //        do when the first one is missing
    const step = SKILL.slice(SKILL.indexOf('### 1a'), SKILL.indexOf('### 1c'));
    expect(step).toContain('peaks_status');
    expect(step).toContain('peaks skill presence --json');
    expect(step).toContain('peaks session list --json');
  });
});
