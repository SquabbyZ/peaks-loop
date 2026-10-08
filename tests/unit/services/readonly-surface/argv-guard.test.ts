// tests/unit/services/readonly-surface/argv-guard.test.ts
//
// The parameter-injection guard (PRD rid-035 AC-5, AC-6).
//
// AC-5 asks a question with an obvious wrong answer: feed `--apply`, `--record`,
// `--pick` and whitespace/newline-bearing values into the `request show <rid>` and
// `memory search <query>` placeholders and require that ALL are refused. The
// anti-vacuity twin is asserted in the same file - a refusal-only implementation
// that rejects everything passes AC-5 and is useless, so the legal values are
// asserted to be ACCEPTED from the same entry.
//
// AC-6 asks that parameters never become a command LINE. The observable form of
// that claim is the return type: `buildArgv` yields `string[]` whose elements are
// exactly the template literals plus the validated values, so no value can
// contribute a token boundary, and the spawn options turn shell parsing off.
//
// Dimensions covered: render, behavior, a11y.
// Dimensions omitted: integration - the guard is pure; it touches no fs, no
// process and no network, so there is no boundary to exercise.
//
// Run with: pnpm vitest run tests/unit/services/readonly-surface/argv-guard.test.ts

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  buildArgv,
  readonlySpawnOptions,
  validatePlaceholderValue
} from '~/src/services/readonly-surface/argv-guard';
import {
  loadReadOnlyWhitelist,
  type PlaceholderSpec,
  type ReadOnlyWhitelistEntry
} from '~/src/services/readonly-surface/readonly-whitelist';

declareDimensions(
  'tests/unit/services/readonly-surface/argv-guard.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'the guard is pure: no fs, no child process, no network, no clock.'
    }
  ]
);

const whitelist = loadReadOnlyWhitelist();

function entry(id: string): ReadOnlyWhitelistEntry {
  const found = whitelist.entries.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no whitelist entry ${id}`);
  return found;
}

/** The declared spec for one placeholder, or a loud failure if the artifact drifted. */
function specOf(id: string, param: string): PlaceholderSpec {
  const spec = entry(id).params[param];
  if (spec === undefined) throw new Error(`no spec for ${id}.${param}`);
  return spec;
}

/** Values that must never be accepted by ANY placeholder type. */
const INJECTIONS = ['--apply', '--record', '--pick', '-h', '--', 'a b', 'a\nb', 'a\tb'];

describe('Scenario: render - a built argv is an array, never a command line', () => {
  it('when a templated entry is built, should return one array element per token', () => {
    // given: the request-show template and legal values for its three placeholders
    // when:  buildArgv renders it
    // then:  the result is an array whose elements are the literals and values, unsplit and unjoined
    const result = buildArgv(entry('request-show'), {
      rid: 'rid-035',
      role: 'rd',
      project: '/tmp/fixture-project'
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.argv)).toBe(true);
    expect(result.argv).toEqual([
      'request',
      'show',
      'rid-035',
      '--role',
      'rd',
      '--json',
      '--project',
      '/tmp/fixture-project'
    ]);
    expect(result.argv.every((token) => typeof token === 'string')).toBe(true);
    // No element carries a token boundary: a value with a space is impossible,
    // and the guard rejects one rather than letting it arrive inside an element.
    expect(result.argv.some((token) => /\s/.test(token))).toBe(false);
  });

  it('when spawn options are read, should keep shell parsing disabled', () => {
    // given: the reusable spawn options the surface is meant to be executed with
    // when:  they are read
    // then:  shell parsing is off, so the array cannot be re-tokenized
    expect(readonlySpawnOptions()).toEqual({ shell: false });
  });
});

describe('Scenario: behavior - injection attempts cannot flip a placeholder into a flag', () => {
  it('when a flag-shaped or whitespace-bearing value reaches a placeholder, should refuse it', () => {
    // given: the two AC-5 placeholders, bound to the real generated whitelist
    // when:  every injection value is fed to each of them
    // then:  every single one is refused, and each refusal names its parameter
    const subjects: ReadonlyArray<readonly [string, string]> = [
      ['request-show', 'rid'],
      ['memory-search', 'query']
    ];
    for (const [id, param] of subjects) {
      const spec = specOf(id, param);
      for (const injection of INJECTIONS) {
        const result = validatePlaceholderValue(param, spec, injection);
        expect(result.ok, `${id}.${param} accepted ${JSON.stringify(injection)}`).toBe(false);
        if (!result.ok) expect(result.param).toBe(param);
      }
    }
  });

  it('when a legal value reaches the same placeholders, should accept it', () => {
    // given: the same two placeholders
    // when:  a well-formed value is supplied to each
    // then:  both are accepted - an implementation that refuses everything is not a guard
    expect(validatePlaceholderValue('rid', specOf('request-show', 'rid'), 'rid-035')).toEqual({
      ok: true,
      value: 'rid-035'
    });
    expect(validatePlaceholderValue('query', specOf('memory-search', 'query'), 'sediment')).toEqual({
      ok: true,
      value: 'sediment'
    });
  });

  it('when a flag-shaped value reaches any type, should refuse it before the type rules run', () => {
    // given: one placeholder of every type the surface declares
    // when:  `--apply` is offered to each
    // then:  all are refused as flag-shaped, so no type can carry a flag into the argv
    const perType: ReadonlyArray<readonly [string, PlaceholderSpec]> = [
      ['rid', specOf('request-show', 'rid')],
      ['role', specOf('request-show', 'role')],
      ['project', specOf('request-show', 'project')],
      ['query', specOf('memory-search', 'query')],
      ['limit', specOf('memory-search', 'limit')]
    ];
    for (const [param, spec] of perType) {
      const result = validatePlaceholderValue(param, spec, '--apply');
      expect(result.ok, `${param} accepted --apply`).toBe(false);
      if (!result.ok) expect(result.code).toBe('FLAG_SHAPED');
    }
  });

  it('when a value violates its own type, should refuse it with a type-specific code', () => {
    // given: a slug, an enum and an integer placeholder
    // when:  each receives a value outside its declared constraint
    // then:  each refusal names the constraint that was broken
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['rid', 'Rid-035', 'PATTERN_MISMATCH'],
      ['role', 'reviewer', 'NOT_IN_ENUM'],
      ['limit', '7.5', 'NOT_AN_INTEGER']
    ];
    for (const [param, value, code] of cases) {
      const id = param === 'limit' ? 'memory-search' : 'request-show';
      const result = validatePlaceholderValue(param, specOf(id, param), value);
      expect(result.ok, `${param} accepted ${value}`).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });

  it('when a number sits outside its declared range, should refuse it', () => {
    // given: the memory-search limit placeholder, bounded 1..50 by the surface
    // when:  a value above the bound is supplied
    // then:  it is refused as out of range
    const result = validatePlaceholderValue('limit', specOf('memory-search', 'limit'), '51');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OUT_OF_RANGE');
  });

  it('when a value is not a string or is empty, should refuse it', () => {
    // given: the rid placeholder
    // when:  a non-string and an empty string are supplied
    // then:  each is refused without throwing
    const spec = specOf('request-show', 'rid');
    const nonString = validatePlaceholderValue('rid', spec, 42);
    expect(nonString.ok).toBe(false);
    if (!nonString.ok) expect(nonString.code).toBe('NOT_A_STRING');
    const empty = validatePlaceholderValue('rid', spec, '');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('EMPTY');
  });

  it('when an entry is asked for a parameter it does not declare, should refuse the call', () => {
    // given: the session-list entry, which declares no placeholders at all
    // when:  a caller supplies an unexpected parameter
    // then:  the call is refused instead of appending the extra token
    const result = buildArgv(entry('session-list'), { sneaky: '--apply' });
    expect(result.ok).toBe(false);
  });

  it('when a declared placeholder is left unsupplied, should refuse the call', () => {
    // given: the request-show entry
    // when:  the rid value is omitted
    // then:  the call is refused rather than rendering a template with a hole
    const result = buildArgv(entry('request-show'), { role: 'rd', project: '/tmp/p' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.param).toBe('rid');
  });

  it('when a placeholder-free entry is built twice, should be byte-stable', () => {
    // given: the session-list entry (no placeholders) - the shape slice ② executes verbatim
    // when:  it is built twice
    // then:  both renders agree, so nothing order- or clock-dependent leaks in
    const first = buildArgv(entry('session-list'), {});
    const second = buildArgv(entry('session-list'), {});
    expect(first).toEqual(second);
    expect(first.ok && first.argv).toEqual(['session', 'list', '--json']);
  });
});

describe('Scenario: a11y - a refusal explains itself to a human and to a machine', () => {
  it('when a value is refused, should carry a code and a message naming the parameter', () => {
    // given: the rid placeholder
    // when:  `--pick` is supplied
    // then:  the rejection carries a stable code and a message naming the parameter
    const result = validatePlaceholderValue('rid', specOf('request-show', 'rid'), '--pick');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FLAG_SHAPED');
    expect(result.message).toContain('rid');
    expect(result.message).toContain('--pick');
    expect(result.message.length).toBeGreaterThan(10);
  });
});
