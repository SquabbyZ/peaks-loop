// tests/unit/services/standards/ui-library-priority.test.ts
//
// Effective 2026-08-01: every downstream project whose scan identifies
// a known UI component library must prefer the library's exported
// components over hand-rolled native DOM. The standard is generated
// by `renderLanguageCodingStyle` so it ships to every consumer
// through `peaks standards init/update`.
//
// These tests pin the two surface boundaries of the rule:
//   1. The detector recognises shadcn / ui in addition to the existing
//      list of supported libraries.
//   2. The generated standard carries the priority rule whenever the
//      project scan has labelled a frontend component library.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectComponentLibrary,
  detectProjectContext,
} from '~/src/services/standards/project-context';
import {
  renderUiLibraryPriorityRule,
  type ProjectContext,
} from '~/src/services/standards/project-standards-service';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-ui-priority-'));
  // writePackageJson() inside the project-context module reads this file.
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
    name: 'tmp-downstream',
    version: '0.0.0',
    dependencies: {},
  }));
});

afterEach(() => {
  // tmp dirs are cleaned up by the host; the test only relies on
  // an isolated cwd per case.
});

function withDeps(deps: Record<string, string>): void {
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
    name: 'tmp-downstream',
    version: '0.0.0',
    dependencies: deps,
  }));
}

function withComponents(relative: string): void {
  mkdirSync(join(projectRoot, relative), { recursive: true });
}

function renderFor(componentLibrary: string): string | null {
  const ctx: ProjectContext = {
    hasPackageJson: true,
    buildTool: 'vite',
    componentLibrary: { name: componentLibrary as 'antd' } as ProjectContext['componentLibrary'],
    cssFrameworks: ['tailwind'],
    cssConflicts: [],
    stateManagement: [],
    routing: [],
    dataFetching: [],
    notableDeps: [],
    legacySignals: [],
  };
  return renderUiLibraryPriorityRule(ctx);
}

describe('detectComponentLibrary — shadcn recognition', () => {
  it('detects shadcn when tailwindcss + class-variance-authority are both present', () => {
    withDeps({ tailwindcss: '^3.0.0', 'class-variance-authority': '^0.7.0' });
    expect(detectComponentLibrary(projectRoot, { tailwindcss: '^3.0.0', 'class-variance-authority': '^0.7.0' }).name).toBe('shadcn');
  });

  it('detects shadcn via tailwind + clsx + tailwind-merge without components dir', () => {
    expect(detectComponentLibrary(projectRoot, {
      tailwindcss: '^3.4.0',
      clsx: '^2.0.0',
      'tailwind-merge': '^2.0.0',
    }).name).toBe('shadcn');
  });

  it('detects shadcn via lucide-react + components/ui even without tailwind', () => {
    withComponents('components/ui');
    expect(detectComponentLibrary(projectRoot, { 'lucide-react': '^0.300.0' }).name).toBe('shadcn');
  });

  it('does NOT detect shadcn when only tailwindcss is present', () => {
    expect(detectComponentLibrary(projectRoot, { tailwindcss: '^3.0.0' }).name).toBe('none');
  });

  it('does NOT detect shadcn when only cva is present (no tailwind signal)', () => {
    expect(detectComponentLibrary(projectRoot, { 'class-variance-authority': '^0.7.0' }).name).toBe('none');
  });
});

describe('renderUiLibraryPriorityRule — UI library priority rule', () => {
  it('emits the priority rule for antd projects', () => {
    const out = renderFor('antd');
    expect(out).toContain('UI library priority');
    expect(out).toContain('this project uses `antd`');
  });

  it('emits the priority rule for mui projects', () => {
    const out = renderFor('mui');
    expect(out).toContain('UI library priority');
    expect(out).toContain('this project uses `mui`');
  });

  it('emits the priority rule for shadcn projects', () => {
    const out = renderFor('shadcn');
    expect(out).toContain('UI library priority');
    expect(out).toContain('this project uses `shadcn`');
  });

  it('returns null for projects whose scan found no library', () => {
    const ctx: ProjectContext = {
      hasPackageJson: true,
      buildTool: 'unknown',
      componentLibrary: { name: 'none' },
      cssFrameworks: [],
      cssConflicts: [],
      stateManagement: [],
      routing: [],
      dataFetching: [],
      notableDeps: [],
      legacySignals: [],
    };
    expect(renderUiLibraryPriorityRule(ctx)).toBeNull();
  });
});

describe('detectProjectContext — component library is propagated to standard rule', () => {
  it('emits the priority rule for a downstream project whose scan finds shadcn', () => {
    withDeps({ tailwindcss: '^3.0.0', 'class-variance-authority': '^0.7.0' });
    const ctx = detectProjectContext(projectRoot);
    const out = renderUiLibraryPriorityRule(ctx);
    expect(out).not.toBeNull();
    expect(out).toContain('this project uses `shadcn`');
  });
});
