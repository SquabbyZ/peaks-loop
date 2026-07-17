import { Command } from 'commander';
import { describe, expect, test } from 'vitest';
import { addJsonOption, isArtifactRepoSegment, multipleOption, printResult } from '../../src/cli/cli-helpers.js';
import { ok } from 'peaks-loop-shared/result';

describe('cli helpers', () => {
  test('prints warnings and next actions for non-json success output', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    printResult({ stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) }, ok('helper.test', { ok: true }, ['be careful'], ['retry later']));

    expect(stdout.join('\n')).toContain('"ok": true');
    expect(stdout).toContain('next: retry later');
    expect(stderr).toContain('warning: be careful');
  });

  test('adds the shared json flag to commands', () => {
    const command = addJsonOption(new Command('demo'));

    expect(command.options.some((option) => option.long === '--json')).toBe(true);
  });

  test('accumulates repeated command option values', () => {
    expect(multipleOption('second', ['first'])).toEqual(['first', 'second']);
    expect(multipleOption('first', undefined as unknown as string[])).toEqual(['first']);
  });
});

describe('isArtifactRepoSegment', () => {
  test('accepts valid repo segment names', () => {
    expect(isArtifactRepoSegment('my-repo')).toBe(true);
    expect(isArtifactRepoSegment('repo123')).toBe(true);
    expect(isArtifactRepoSegment('my.repo')).toBe(true);
    expect(isArtifactRepoSegment('my_repo')).toBe(true);
  });

  test('rejects segment starting with non-alphanumeric', () => {
    expect(isArtifactRepoSegment('.hidden')).toBe(false);
    expect(isArtifactRepoSegment('-dash')).toBe(false);
    expect(isArtifactRepoSegment('_underscore')).toBe(false);
  });

  test('rejects segment ending with dot', () => {
    expect(isArtifactRepoSegment('trailing.')).toBe(false);
  });

  test('rejects segment containing double dots', () => {
    expect(isArtifactRepoSegment('path..traversal')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isArtifactRepoSegment('')).toBe(false);
  });
});
