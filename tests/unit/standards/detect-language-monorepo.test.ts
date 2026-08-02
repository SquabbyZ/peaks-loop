// tests/unit/standards/detect-language-monorepo.test.ts
//
// Slice 4.0.7-dogfood-PR-7. Verifies that `detectLanguage` is
// monorepo-aware: a root without a language-bearing manifest but
// with a sub-package that has tsconfig.json returns 'typescript'
// (instead of falling through to 'javascript' or 'generic').
//
// Run with: pnpm vitest run tests/unit/standards/detect-language-monorepo.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectLanguage } from '../../../src/services/standards/project-standards-service.js';

describe('detectLanguage (monorepo-aware)', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'peaks-lang-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('root tsconfig.json → typescript (single-package)', () => {
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    expect(detectLanguage(root)).toBe('typescript');
  });

  it('monorepo with packages/<name>/tsconfig.json and no root tsconfig.json → typescript (PR-7 fix)', () => {
    mkdirSync(join(root, 'packages', 'server'), { recursive: true });
    writeFileSync(join(root, 'packages', 'server', 'tsconfig.json'), '{}');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'monorepo', workspaces: ['packages/*'] }));
    expect(detectLanguage(root)).toBe('typescript');
  });

  it('monorepo with only package.json (no tsconfig anywhere) → javascript', () => {
    mkdirSync(join(root, 'packages', 'a'), { recursive: true });
    writeFileSync(join(root, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a' }));
    expect(detectLanguage(root)).toBe('javascript');
  });

  it('root tsconfig.json wins even when sub-packages lack one', () => {
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    mkdirSync(join(root, 'packages', 'a'), { recursive: true });
    writeFileSync(join(root, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a' }));
    expect(detectLanguage(root)).toBe('typescript');
  });

  it('not a monorepo (no packages dir) → falls back to root scan', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'solo' }));
    expect(detectLanguage(root)).toBe('javascript');
  });
});
