// tests/unit/services/readonly-surface/readonly-whitelist.test.ts
//
// The whitelist as data (PRD rid-035 AC-1) and the one reader of it.
//
// AC-1's second half is a PROHIBITION - no module may `import` the artifact - and
// it lives in `tests/unit/standards/no-mcp-source-import.test.ts`, next to the
// other boundary guards. What is asserted here is the positive half: the artifact
// is reachable ONLY through the loader, it is shaped as a schema-validated data
// file, and the matcher is the full-argv match the surface design requires.
//
// Dimensions covered: render, behavior, integration, a11y.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  READONLY_WHITELIST_RELATIVE_PATH,
  loadReadOnlyWhitelist,
  matchReadOnlyEntry,
  paramNamesOf,
  parseReadOnlyWhitelist,
  resolveReadOnlyWhitelistPath
} from '~/src/services/readonly-surface/readonly-whitelist';

declareDimensions('tests/unit/services/readonly-surface/readonly-whitelist.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

describe('Scenario: render - the artifact is data with one entry per proven argv', () => {
  it('when the artifact is loaded, should expose only the argv the proof admits', () => {
    // given: the committed artifact
    // when:  the loader reads it
    // then:  it carries exactly the argv this slice proves, each bound to its tool
    const whitelist = loadReadOnlyWhitelist();
    expect(whitelist.schemaVersion).toBe(1);
    expect(whitelist.entries.map((entry) => entry.id)).toEqual([
      'skill-presence',
      'session-list',
      'request-show',
      'memory-search'
    ]);
    expect(whitelist.entries.map((entry) => entry.tool)).toEqual([
      'peaks_status',
      'peaks_status',
      'peaks_status',
      'peaks_memory_search'
    ]);
    expect(whitelist.readOnlyDefinition).toContain('no network');
  });

  it('when an entry carries placeholders, should name them in argv order', () => {
    // given: the request-show entry
    // when:  its placeholders are listed
    // then:  they follow the template, so a caller can render it without re-reading the template
    const whitelist = loadReadOnlyWhitelist();
    const request = whitelist.entries.find((entry) => entry.id === 'request-show');
    expect(request).toBeDefined();
    expect(request === undefined ? [] : paramNamesOf(request)).toEqual(['rid', 'role', 'project']);
  });
});

describe('Scenario: behavior - the key is the full argv, flags included', () => {
  it('when a concrete argv matches a template exactly, should find that entry', () => {
    // given: a concrete session-list invocation
    // when:  it is matched
    // then:  the entry is found - and the same argv without the flag is not, which is
    //        the whole reason the key is not the top-level verb
    const whitelist = loadReadOnlyWhitelist();
    expect(matchReadOnlyEntry(whitelist, ['session', 'list', '--json'])?.id).toBe('session-list');
    expect(matchReadOnlyEntry(whitelist, ['session', 'list'])).toBeUndefined();
    expect(matchReadOnlyEntry(whitelist, ['session', 'list', '--json', '--project', '.'])).toBeUndefined();
  });

  it('when a value sits in a placeholder slot, should match it and leave refusal to the guard', () => {
    // given: the memory-search template, whose second token is a placeholder
    // when:  a flag-shaped value occupies that slot
    // then:  it still MATCHES here - the matcher counts tokens, the guard judges values,
    //        and folding the two together would let a rejected value re-route to another entry
    const whitelist = loadReadOnlyWhitelist();
    const matched = matchReadOnlyEntry(whitelist, ['memory', 'search', '--apply', '--limit', '6']);
    expect(matched?.id).toBe('memory-search');
  });
});

describe('Scenario: integration - the loader is the only door to the artifact', () => {
  it('when the artifact is read, should resolve under the package root contracts directory', () => {
    // given: the package root
    // when:  the artifact path is resolved
    // then:  it is the shipped contracts path and the file is really there
    const path = resolveReadOnlyWhitelistPath();
    expect(path.split(/[\\/]/).slice(-2).join('/')).toBe(READONLY_WHITELIST_RELATIVE_PATH);
    expect(() => readFileSync(path, 'utf8')).not.toThrow();
  });

  it('when the loader and the raw file are compared, should agree — so parsing adds no silent rewrite', () => {
    // given: the raw artifact text
    // when:  it is parsed directly and through the loader
    // then:  both produce the same entries
    const raw = readFileSync(resolveReadOnlyWhitelistPath(), 'utf8');
    expect(parseReadOnlyWhitelist(raw).entries).toEqual(loadReadOnlyWhitelist().entries);
  });
});

describe('Scenario: a11y - a malformed artifact reports what is wrong', () => {
  it('when the artifact is not schema-valid, should refuse it with a diagnostic naming the field', () => {
    // given: an artifact missing its entries array
    // when:  it is parsed
    // then:  parsing throws and the message names the missing field
    let message = '';
    try {
      parseReadOnlyWhitelist(JSON.stringify({ schemaVersion: 1 }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe('');
    expect(message).toContain('entries');
  });
});
