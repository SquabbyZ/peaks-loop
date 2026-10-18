// tests/unit/services/memory/memory-metadata-sensitive-value.test.ts
//
// Backlog §2.5 — `assertSafeMemory`'s METADATA KEY check has no test coverage.
// It calls `containsSensitiveConfigValue(metadata)`, which recurses into
// values: `{ body: { token: 'x' } }` answers true because the nested `token`
// KEY is a credential key, not because any value was scanned. That recursion
// is real and `assertSafeMemory` is a public export
// (`project-memory-service/index.ts`), so the branch stays; what was missing
// was a test that pins it. Measured before this file: the refusal branch
// (`atomic-write.ts:322`) and the recursion lines of `config-validation.ts`
// were uncovered by all 188 cases under `tests/unit/services/memory/`.
//
// The three inputs the backlog item names are pinned explicitly:
//   - a nested sensitive object  -> true / refused;
//   - a plain string             -> false (the predicate's non-object branch —
//                                   value scanning belongs to the content
//                                   scanner, `findSensitiveMemoryContentRule`);
//   - a clean object             -> false / accepted.
//
// Run with:
//   node node_modules/vitest/vitest.mjs run tests/unit/services/memory/memory-metadata-sensitive-value.test.ts

import { describe, expect, it } from 'vitest';

import { containsSensitiveConfigValue } from '~/src/services/config/config-service';
import {
  assertSafeMemory,
  SENSITIVE_MEMORY_CHECKS,
  UnsafeMemoryError
} from '~/src/services/memory/project-memory-service/index';
import type { ExtractedProjectMemory } from '~/src/services/memory/project-memory-service/types';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/memory/memory-metadata-sensitive-value.test.ts',
  ['behavior', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'both exports return a boolean or throw; there is no output shape to render'
    },
    {
      dim: 'integration',
      reason: 'the predicate and the gate are in-process: no fs, process or network boundary'
    }
  ]
);

/** A memory that carries no credential: the accepted baseline. */
function cleanMemory(): ExtractedProjectMemory {
  return {
    title: 'Rotate the key quarterly',
    kind: 'lesson',
    body: 'A stable fact that carries no credential.',
    sourceArtifact: 'probe/handoff.md'
  };
}

/**
 * A memory whose `body` is an OBJECT at runtime. The type says `string`, so
 * this probe casts deliberately: the gate is the last runtime guard before a
 * write, and this is the only shape that reaches the predicate's recursion
 * through `assertSafeMemory`.
 */
function memoryWithNestedBody(nested: unknown): ExtractedProjectMemory {
  return { ...cleanMemory(), body: nested as string };
}

describe('Scenario: behavior — the metadata scan recurses into nested values', () => {
  it('when the value is a nested sensitive object, should report sensitive = true', () => {
    // given: a payload whose credential is a KEY inside a nested object
    const value = { body: { token: 'x' } };

    // when: the config-key predicate reads it
    const sensitive = containsSensitiveConfigValue(value);

    // then: the nested key is found, so the object answers true
    expect(sensitive).toBe(true);
  });

  it('when the sensitive key sits two levels down, should still report sensitive = true', () => {
    // given: the same shape, one nesting level deeper
    const value = { outer: { inner: { apiKey: 'placeholder' } } };

    // when: the predicate recurses through both objects
    const sensitive = containsSensitiveConfigValue(value);

    // then: depth does not hide the key
    expect(sensitive).toBe(true);
  });

  it('when the sensitive key sits behind an array, should report sensitive = true', () => {
    // given: an array is an object value; the predicate recurses into entries
    const value = { entries: ['opaque', { privateKey: 'placeholder' }] };

    // when: the predicate walks the array and then the object
    const sensitive = containsSensitiveConfigValue(value);

    // then: an array does not stop the scan
    expect(sensitive).toBe(true);
  });

  it('when the value is a plain string, should report sensitive = false', () => {
    // given: a bare string that LOOKS like a credential assignment
    const value = 'token: abc123';

    // when: the config-key predicate reads it
    const sensitive = containsSensitiveConfigValue(value);

    // then: a string is a VALUE, not a metadata key — value scanning is the
    //       content scanner's job, so the key predicate's non-object branch
    //       answers false. This is the branch's documented path.
    expect(sensitive).toBe(false);
  });

  it('when the value is a clean object, should report sensitive = false', () => {
    // given: the flat metadata `assertSafeMemory` actually builds
    const value = { title: 'Rotate the key quarterly', kind: 'lesson', body: 'A stable fact.' };

    // when: the predicate reads it
    const sensitive = containsSensitiveConfigValue(value);

    // then: none of the keys is a credential key
    expect(sensitive).toBe(false);
  });

  it('when the value is null or a scalar, should report sensitive = false', () => {
    // given: the remaining non-object shapes
    // when: the predicate reads each
    // then: none of them can carry a sensitive KEY
    expect(containsSensitiveConfigValue(null)).toBe(false);
    expect(containsSensitiveConfigValue(42)).toBe(false);
    expect(containsSensitiveConfigValue(undefined)).toBe(false);
  });
});

describe('Scenario: behavior — assertSafeMemory refuses metadata carrying a nested sensitive key', () => {
  it('when the memory body is a nested sensitive object, should refuse it', () => {
    // given: a memory whose body hides a credential key one level down
    const memory = memoryWithNestedBody({ token: 'x' });

    // when: the public gate runs
    // then: it throws the dedicated error type
    expect(() => assertSafeMemory(memory)).toThrow(UnsafeMemoryError);
  });

  it('when the memory is clean, should accept it', () => {
    // given: the clean baseline
    // when: the public gate runs
    // then: nothing is refused
    expect(() => assertSafeMemory(cleanMemory())).not.toThrow();
  });
});

describe('Scenario: a11y — the metadata refusal names the check that fired', () => {
  it('when a nested sensitive key is refused, should name the metadata key scan', () => {
    // given: the nested-body memory
    const memory = memoryWithNestedBody({ token: 'x' });

    // when: the gate refuses it
    let refusal: unknown;
    try {
      assertSafeMemory(memory);
    } catch (error) {
      refusal = error;
    }

    // then: the reader is told WHICH check stopped the write — not only that
    //       something did — and the term field stays null by contract
    expect(refusal).toBeInstanceOf(UnsafeMemoryError);
    const unsafe = refusal as UnsafeMemoryError;
    expect(unsafe.check).toBe(SENSITIVE_MEMORY_CHECKS.metadataKey);
    expect(unsafe.matchedTerm).toBeNull();
    expect(unsafe.message).toContain(SENSITIVE_MEMORY_CHECKS.metadataKey);
  });
});
