// packages/peaks-loop-mut/tests/stryker-options.test.ts
//
// Unit tests for the PURE Stryker configuration builder
// (src/services/mut/stryker-options.ts).
//
// The builder has no IO, no clock and no process state, so these tests
// never load Stryker and never touch the filesystem — they assert the
// shape of the options object only.
//
// What is pinned here (and why each one matters):
//   - `mutate` patterns travel VERBATIM. Stryker supports `!` negation
//     and `:line-range` suffixes; `path.resolve()` would mangle both.
//   - `testFiles` patterns are resolved against the PROJECT ROOT, so the
//     result does not depend on the caller's CWD.
//   - `vitest.related` is false whenever explicit test files are given:
//     with the Stryker default (`related: true`) the vitest runner
//     narrows the dry run to tests that IMPORT the mutated source, and a
//     mutated file with no importing test aborts the run with "No tests
//     were executed" before the mutation stage.
//   - `reporters: []` + `logLevel: 'off'` keep stdout free for the
//     `--json` envelope (Stryker's logging backend writes to
//     process.stdout).
//
// Run with: pnpm --filter peaks-loop-mut test

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import { buildStrykerOptions } from '../src/services/mut/stryker-options.js';

const PROJECT = resolve('C:/tmp/does-not-need-to-exist');
describe('buildStrykerOptions', () => {
  it('keeps stdout clean: no reporters, logging off', () => {
    const { options } = buildStrykerOptions({ project: PROJECT, mutate: ['src'] });

    expect(options.reporters).toEqual([]);
    expect(options.logLevel).toBe('off');
    expect(options.fileLogLevel).toBe('off');
    expect(options.allowConsoleColors).toBe(false);
  });

  it('passes mutate patterns through verbatim (negation + line ranges survive)', () => {
    const patterns = ['src/**/*.ts', '!src/legacy/**', 'src/app.ts:1-11'];
    const { options } = buildStrykerOptions({ project: PROJECT, mutate: patterns });

    expect(options.mutate).toEqual(patterns);
  });

  it('omits mutate entirely when no pattern was given (the project config decides)', () => {
    const { options } = buildStrykerOptions({ project: PROJECT });

    expect(options.mutate).toBeUndefined();
  });

  it('resolves test files against the project root', () => {
    const { options } = buildStrykerOptions({
      project: PROJECT,
      mutate: ['src'],
      testFiles: ['src/a.test.ts']
    });

    expect(options.testFiles).toEqual([resolve(PROJECT, 'src/a.test.ts')]);
  });

  it('keeps absolute test file paths as they are', () => {
    const absolute = resolve('C:/elsewhere/b.test.ts');
    const { options } = buildStrykerOptions({
      project: PROJECT,
      mutate: ['src'],
      testFiles: [absolute]
    });

    expect(options.testFiles).toEqual([absolute]);
  });

  it('turns vitest related-mode off when an explicit test list is given', () => {
    const { options } = buildStrykerOptions({
      project: PROJECT,
      mutate: ['src'],
      testFiles: ['src/a.test.ts']
    });

    expect(options.vitest).toEqual({ related: false });
  });

  it('leaves vitest untouched when no test files are given', () => {
    const { options } = buildStrykerOptions({ project: PROJECT, mutate: ['src'] });

    expect(options.vitest).toBeUndefined();
  });

  it('appends the plugin descriptors instead of replacing the plugin list', () => {
    const { options, pluginDescriptors } = buildStrykerOptions({
      project: PROJECT,
      mutate: ['src'],
      pluginDescriptors: ['C:/toolchain/vitest-runner/dist/src/index.js']
    });

    expect(pluginDescriptors).toEqual(['C:/toolchain/vitest-runner/dist/src/index.js']);
    expect(options.appendPlugins).toEqual(pluginDescriptors);
    expect(options.plugins).toBeUndefined();
  });

  it('leaves the project-owned timing / coverage options unset by default', () => {
    const { options } = buildStrykerOptions({ project: PROJECT, mutate: ['src'] });

    // A project `stryker.conf.js` owns these; the builder only sets them
    // when the caller asks for them.
    expect(options.timeoutMS).toBeUndefined();
    expect(options.concurrency).toBeUndefined();
    expect(options.coverageAnalysis).toBeUndefined();
  });

  it('lets the caller override the timing defaults', () => {
    const { options } = buildStrykerOptions({
      project: PROJECT,
      mutate: ['src'],
      timeoutMs: 1234,
      concurrency: 7,
      coverageAnalysis: 'perTest'
    });

    expect(options.timeoutMS).toBe(1234);
    expect(options.concurrency).toBe(7);
    expect(options.coverageAnalysis).toBe('perTest');
  });

  it('names the test runner only when the caller does', () => {
    const without = buildStrykerOptions({ project: PROJECT, mutate: ['src'] });
    const with_ = buildStrykerOptions({
      project: PROJECT,
      mutate: ['src'],
      testRunner: 'vitest'
    });

    expect(without.options.testRunner).toBeUndefined();
    expect(with_.options.testRunner).toBe('vitest');
  });

  it('sets tsconfigFile only when one was given', () => {
    const without = buildStrykerOptions({ project: PROJECT, mutate: ['src'] });
    const with_ = buildStrykerOptions({
      project: PROJECT,
      mutate: ['src'],
      tsconfigFile: 'tsconfig.mut.json'
    });

    expect(without.options.tsconfigFile).toBeUndefined();
    expect(with_.options.tsconfigFile).toBe('tsconfig.mut.json');
  });

  it('is pure: the same input yields the same output', () => {
    const input = {
      project: PROJECT,
      mutate: ['src'],
      testFiles: ['src/a.test.ts'],
      pluginDescriptors: ['C:/toolchain/vitest-runner/dist/src/index.js']
    };

    expect(buildStrykerOptions(input)).toEqual(buildStrykerOptions(input));
  });
});
