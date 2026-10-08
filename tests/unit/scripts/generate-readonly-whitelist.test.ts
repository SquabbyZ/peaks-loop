// tests/unit/scripts/generate-readonly-whitelist.test.ts
//
// The build-time generator (PRD rid-035 AC-2) and its refusal to describe a CLI
// that does not exist.
//
// AC-2 is a determinism claim, and a determinism claim is only worth what its
// control is worth: "two runs agree" passes trivially for a generator that reads
// nothing. So the same file asserts the DRIFT controls - the generator must go
// red when the surface names a flag the registry does not have, a command path
// that is not registered, or a positional the command does not declare. The
// committed artifact is compared against a fresh generation as well, which is the
// no-drift leg of the test matrix.
//
// Dimensions covered: render, behavior, integration, a11y.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { createProgram } from '~/src/cli/program';
import {
  generateReadOnlyWhitelist,
  loadReadOnlySurface,
  readonlyWhitelistPath,
  serializeReadOnlyWhitelist,
  type ReadOnlySurface
} from '~/src/services/readonly-surface/whitelist-generator';

declareDimensions('tests/unit/scripts/generate-readonly-whitelist.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** A deep-enough copy that mutations below cannot touch the loaded surface. */
function surfaceCopy(): ReadOnlySurface {
  return JSON.parse(JSON.stringify(loadReadOnlySurface())) as ReadOnlySurface;
}

describe('Scenario: render - the artifact is byte-stable pretty JSON', () => {
  it('when the whitelist is serialized, should end with exactly one newline', () => {
    // given: a generated whitelist
    // when:  it is serialized
    // then:  the text is pretty-printed, newline-terminated and re-parses to the same object
    const whitelist = generateReadOnlyWhitelist(surfaceCopy(), createProgram());
    const text = serializeReadOnlyWhitelist(whitelist);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "entries": [');
    expect(JSON.parse(text)).toEqual(whitelist);
  });
});

describe('Scenario: behavior - two runs agree, and the committed artifact is one of them', () => {
  it('when the generator runs twice on the same input, should produce identical bytes', () => {
    // given: the real surface and the real registry
    // when:  two independent generations are serialized
    // then:  the bytes match, so no timestamp or unordered iteration leaks in
    const surface = surfaceCopy();
    const first = serializeReadOnlyWhitelist(generateReadOnlyWhitelist(surface, createProgram()));
    const second = serializeReadOnlyWhitelist(generateReadOnlyWhitelist(surface, createProgram()));
    expect(first).toBe(second);
  });

  it('when the committed artifact is compared to a fresh generation, should be unchanged', () => {
    // given: the artifact committed in `contracts/`
    // when:  it is compared against a fresh generation from the same surface
    // then:  they are byte-identical - a hand edit cannot survive, and `git diff` after a build stays empty
    const committed = readFileSync(readonlyWhitelistPath(), 'utf8');
    const fresh = serializeReadOnlyWhitelist(
      generateReadOnlyWhitelist(surfaceCopy(), createProgram())
    );
    expect(committed).toBe(fresh);
  });

  it('when the registry answers, should record what it said rather than what the surface claimed', () => {
    // given: the request-show entry, whose `--role` and `--project` flags are mandatory
    // when:  the entry is generated
    // then:  required-ness comes from the registry, and the hand-written constraints are marked as such
    const whitelist = generateReadOnlyWhitelist(surfaceCopy(), createProgram());
    const request = whitelist.entries.find((entry) => entry.id === 'request-show');
    expect(request).toBeDefined();
    if (request === undefined) return;
    expect(request.params['role']?.binding).toEqual({
      kind: 'option',
      token: '--role',
      required: true
    });
    expect(request.params['rid']?.binding).toEqual({
      kind: 'positional',
      token: 'request-id',
      required: true
    });
    // `--limit` is NOT mandatory on the command; the surface still pins it in the
    // template, so the introspected fact and the template's demand are different
    // fields on purpose.
    const search = whitelist.entries.find((entry) => entry.id === 'memory-search');
    expect(search?.params['limit']?.binding.required).toBe(false);
    expect(request.params['role']?.constraintSource).toBe('handwritten');
    expect(request.introspection.optionTokens).toContain('--project');
  });

  it('when the surface declares a flag the registry does not have, should refuse to generate', () => {
    // given: a surface whose session-list template names an invented flag
    const surface = surfaceCopy();
    const entry = surface.tools[0]?.entries.find((candidate) => candidate.id === 'session-list');
    expect(entry).toBeDefined();
    entry?.argv.push('--nope');
    // when:  generation runs
    // then:  it throws, so a renamed or deleted flag fails the build instead of shipping
    expect(() => generateReadOnlyWhitelist(surface, createProgram())).toThrow(/--nope/);
  });

  it('when the surface names a command that is not registered, should refuse to generate', () => {
    // given: a surface pointing at a command path that does not exist
    const surface = surfaceCopy();
    const entry = surface.tools[0]?.entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    entry.commandPath = ['skill', 'presence-not-a-command'];
    entry.argv = ['skill', 'presence-not-a-command', '--json'];
    // when:  generation runs
    // then:  it throws naming the missing path
    expect(() => generateReadOnlyWhitelist(surface, createProgram())).toThrow(/presence-not-a-command/);
  });

  it('when a template omits a positional the command declares, should refuse to generate', () => {
    // given: the request-show template with its positional dropped
    const surface = surfaceCopy();
    const entry = surface.tools[0]?.entries.find((candidate) => candidate.id === 'request-show');
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    entry.argv = entry.argv.filter((token) => token !== '<rid>');
    delete entry.params['rid'];
    // when:  generation runs
    // then:  it throws, because a surface that cannot drive the command is not a surface
    expect(() => generateReadOnlyWhitelist(surface, createProgram())).toThrow(/positional/i);
  });
});

describe('Scenario: integration - the generator reads the real registry and the real surface', () => {
  it('when the surface is loaded from disk, should carry the measured deviations, not just the templates', () => {
    // given: the committed hand-authored surface
    // when:  it is loaded
    // then:  it holds the entries the proof admits and records BOTH measurements that changed it:
    //        the mandatory `--project` the PRD omitted, and the argv the proof excluded
    const surface = loadReadOnlySurface();
    expect(surface.tools.flatMap((group) => group.entries)).toHaveLength(4);
    const note = surface.note.join('\n');
    expect(note).toContain('MISSING_REQUIRED_OPTION');
    expect(note).toContain('EXCLUDED AFTER MEASUREMENT');
    expect(note).toContain('project dashboard');
  });
});

describe('Scenario: a11y - a drift refusal names the entry that broke', () => {
  it('when generation refuses, should name the offending entry in the message', () => {
    // given: a surface whose memory-search template names an invented flag
    const surface = surfaceCopy();
    const entry = surface.tools[1]?.entries[0];
    expect(entry).toBeDefined();
    entry?.argv.push('--bogus');
    // when:  generation runs and throws
    // then:  the message carries both the entry id and the offending token
    let message = '';
    try {
      generateReadOnlyWhitelist(surface, createProgram());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('memory-search');
    expect(message).toContain('--bogus');
  });
});
