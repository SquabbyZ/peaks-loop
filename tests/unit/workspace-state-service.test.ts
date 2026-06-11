import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  collectLegacyDecisionDotfiles,
  isLegacyDecisionDotfile,
  stateDirPath,
} from '../../src/services/workspace/workspace-state-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-state-'));
}

const LEGACY_DOTFILES = [
  '.peaks-init-hooks-decision.json',
  '.peaks-openspec-opt-in.json',
] as const;

describe('isLegacyDecisionDotfile', () => {
  test.each(LEGACY_DOTFILES.map((name) => [name]))('recognizes legacy %s', (name) => {
    expect(isLegacyDecisionDotfile(name)).toBe(true);
  });

  test('rejects non-decision dotfiles', () => {
    expect(isLegacyDecisionDotfile('package.json')).toBe(false);
    expect(isLegacyDecisionDotfile('peaks-cli.md')).toBe(false);
  });
});

describe('stateDirPath', () => {
  test('returns .peaks/_state under projectRoot', () => {
    expect(stateDirPath('/tmp/proj')).toBe('/tmp/proj/.peaks/_state');
  });
});

describe('collectLegacyDecisionDotfiles', () => {
  test('moves both legacy dotfiles from .peaks/ root to .peaks/_state/', () => {
    const project = makeProject();
    try {
      const peaksDir = join(project, '.peaks');
      mkdirSync(peaksDir, { recursive: true });
      writeFileSync(join(peaksDir, '.peaks-init-hooks-decision.json'), '{"hooks":true}', 'utf8');
      writeFileSync(join(peaksDir, '.peaks-openspec-opt-in.json'), '{"optIn":true}', 'utf8');

      const result = collectLegacyDecisionDotfiles(project);
      expect(result.moved).toEqual(expect.arrayContaining([
        '.peaks-init-hooks-decision.json',
        '.peaks-openspec-opt-in.json',
      ]));
      expect(result.skipped).toEqual([]);

      const stateDir = join(peaksDir, '_state');
      for (const name of LEGACY_DOTFILES) {
        expect(existsSync(join(peaksDir, name))).toBe(false);
        expect(existsSync(join(stateDir, name))).toBe(true);
        const content = readFileSync(join(stateDir, name), 'utf8');
        expect(content.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('skips legacy dotfile that does not exist (no error)', () => {
    const project = makeProject();
    try {
      mkdirSync(join(project, '.peaks'), { recursive: true });
      const result = collectLegacyDecisionDotfiles(project);
      expect(result.moved).toEqual([]);
      expect(result.skipped).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('throws DOTFILE_COLLISION when target already exists in _state/', () => {
    const project = makeProject();
    try {
      const peaksDir = join(project, '.peaks');
      const stateDir = join(peaksDir, '_state');
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(peaksDir, '.peaks-init-hooks-decision.json'), '{}', 'utf8');
      writeFileSync(join(stateDir, '.peaks-init-hooks-decision.json'), '{"existing":true}', 'utf8');
      expect(() => collectLegacyDecisionDotfiles(project)).toThrow(/DOTFILE_COLLISION/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
