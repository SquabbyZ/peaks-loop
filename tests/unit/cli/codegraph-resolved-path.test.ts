// tests/unit/cli/codegraph-resolved-path.test.ts
//
// Root-only codegraph data-dir resolution — regression for the
// `.peaks`-nested `.codegraph/` preferred-path removal.
//
// Dimensions covered (per `.peaks/standards/typescript/testing.md`):
//   - behavior:    resolver always returns root `.codegraph/` with
//                  cwd = projectRoot; a leftover `.peaks`-nested
//                  `.codegraph/` tree is ignored; init guard probes root
//                  `.codegraph/` for fresh / noop / conflict.
//   - integration: real fs (mkdtempSync + mkdirSync + writeFileSync).
//   - render:      `ResolvedCodegraphLocation` shape preserved.
//   - a11y:        guard outcomes name the root codegraphDir so the
//                  LLM (or operator) can recover without re-reading.
//
// Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
//
// Run with: pnpm vitest run tests/unit/cli/codegraph-resolved-path.test.ts

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CODEGRAPH_DIR_NAME,
  CODEGRAPH_MARKER_NAME,
  createCodegraphInvocation,
  defaultCodegraphInitGuard,
  resolveCodegraphProjectRoot,
  writeCodegraphMarker
} from '~/src/services/codegraph/codegraph-service';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/cli/codegraph-resolved-path.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

function freshProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-cg-root-'));
}

function rootCodegraphDir(projectRoot: string): string {
  return join(projectRoot, CODEGRAPH_DIR_NAME);
}

describe('resolveCodegraphProjectRoot + createCodegraphInvocation (root-only)', () => {
  withTmpWorkspacePerTest();

  it('when no codegraph dir exists, should resolve to root .codegraph with cwd = projectRoot', () => {
    // given: a fresh project with neither `.codegraph/` nor a `.peaks`-nested `.codegraph/`
    // when:  resolveCodegraphProjectRoot is invoked
    // then:  it returns source 'root', codegraphDir = `<root>/.codegraph`, cwd = projectRoot
    const projectRoot = freshProject();
    try {
      const location = resolveCodegraphProjectRoot(projectRoot);
      expect(location.source).toBe('root');
      expect(location.codegraphDir).toBe(rootCodegraphDir(projectRoot));
      expect(location.cwd).toBe(projectRoot);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when root .codegraph already exists, should still resolve to root .codegraph', () => {
    // given: an existing root `.codegraph/` directory
    // when:  resolveCodegraphProjectRoot is invoked
    // then:  it resolves to root `.codegraph/` (root-only — no legacy label)
    const projectRoot = freshProject();
    try {
      mkdirSync(rootCodegraphDir(projectRoot), { recursive: true });
      const location = resolveCodegraphProjectRoot(projectRoot);
      expect(location.source).toBe('root');
      expect(location.codegraphDir).toBe(rootCodegraphDir(projectRoot));
      expect(location.cwd).toBe(projectRoot);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when a .peaks-nested codegraph dir exists, should ignore it and resolve to root .codegraph', () => {
    // given: a leftover `.peaks`-nested codegraph directory from the pre-4.0.21 move
    // when:  resolveCodegraphProjectRoot is invoked
    // then:  the `.peaks` tree is ignored and root `.codegraph/` is returned
    const projectRoot = freshProject();
    try {
      mkdirSync(join(projectRoot, '.peaks', CODEGRAPH_DIR_NAME), { recursive: true });
      const location = resolveCodegraphProjectRoot(projectRoot);
      expect(location.source).toBe('root');
      expect(location.codegraphDir).toBe(rootCodegraphDir(projectRoot));
      expect(location.cwd).toBe(projectRoot);
      expect(location.codegraphDir.startsWith(join(projectRoot, '.peaks'))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when creating a status invocation, should spawn with cwd = projectRoot so discovery reads root .codegraph', () => {
    // given: a project directory
    // when:  createCodegraphInvocation({ subcommand: 'status', project }) is called
    // then:  cwd is the realpath'd project root (Windows 8.3-safe), never a `.peaks` child
    const projectRoot = freshProject();
    try {
      const expectedCwd = realpathSync.native(projectRoot);
      const invocation = createCodegraphInvocation({ subcommand: 'status', project: projectRoot });
      expect(invocation.cwd).toBe(expectedCwd);
      expect(invocation.cwd.endsWith('.peaks')).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when creating an init invocation on a fresh project, should spawn with cwd = projectRoot (no .peaks prefix)', () => {
    // given: a fresh project with no codegraph dir
    // when:  createCodegraphInvocation({ subcommand: 'init', project }) is called
    // then:  cwd is the realpath'd project root — the upstream binary's default
    //        discovery will land on `<projectRoot>/.codegraph/`
    const projectRoot = freshProject();
    try {
      const expectedCwd = realpathSync.native(projectRoot);
      const invocation = createCodegraphInvocation({ subcommand: 'init', project: projectRoot });
      expect(invocation.cwd).toBe(expectedCwd);
      expect(invocation.cwd.endsWith('.peaks')).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('defaultCodegraphInitGuard root-only', () => {
  withTmpWorkspacePerTest();

  it('when neither dir exists, should return fresh pointing at root .codegraph', () => {
    // given: a fresh project with no codegraph dir
    // when:  defaultCodegraphInitGuard is invoked
    // then:  status is 'fresh' and codegraphDir is `<root>/.codegraph`
    const projectRoot = freshProject();
    try {
      const outcome = defaultCodegraphInitGuard(projectRoot);
      expect(outcome.status).toBe('fresh');
      expect(outcome.codegraphDir).toBe(rootCodegraphDir(projectRoot));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when root .codegraph holds a peaks-loop marker, should return noop at root .codegraph', () => {
    // given: root `.codegraph/` stamped with the peaks-loop marker
    // when:  defaultCodegraphInitGuard is invoked
    // then:  status is noop-already-peaks-loop and the marker file is on disk at root
    const projectRoot = freshProject();
    try {
      const codegraphDir = rootCodegraphDir(projectRoot);
      mkdirSync(codegraphDir, { recursive: true });
      writeCodegraphMarker(codegraphDir);

      const outcome = defaultCodegraphInitGuard(projectRoot);
      expect(outcome.status).toBe('noop-already-peaks-loop');
      expect(outcome.codegraphDir).toBe(codegraphDir);
      expect(existsSync(join(codegraphDir, CODEGRAPH_MARKER_NAME))).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when root .codegraph holds a foreign schema, should return conflict at root .codegraph', () => {
    // given: root `.codegraph/` containing a foreign file and no marker
    // when:  defaultCodegraphInitGuard is invoked
    // then:  status is conflict-foreign-schema at root `.codegraph/`
    const projectRoot = freshProject();
    try {
      mkdirSync(rootCodegraphDir(projectRoot), { recursive: true });
      writeFileSync(join(rootCodegraphDir(projectRoot), 'foreign.db'), 'not ours\n', 'utf8');

      const outcome = defaultCodegraphInitGuard(projectRoot);
      expect(outcome.status).toBe('conflict-foreign-schema');
      expect(outcome.codegraphDir).toBe(rootCodegraphDir(projectRoot));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when only a .peaks-nested codegraph marker exists, should still return fresh at root .codegraph', () => {
    // given: a leftover `.peaks`-nested codegraph dir carrying the peaks-loop marker
    //        and no root `.codegraph/`
    // when:  defaultCodegraphInitGuard is invoked
    // then:  the `.peaks` tree is ignored; status is fresh at root `.codegraph/`
    const projectRoot = freshProject();
    try {
      const legacyDir = join(projectRoot, '.peaks', CODEGRAPH_DIR_NAME);
      mkdirSync(legacyDir, { recursive: true });
      writeCodegraphMarker(legacyDir);

      const outcome = defaultCodegraphInitGuard(projectRoot);
      expect(outcome.status).toBe('fresh');
      expect(outcome.codegraphDir).toBe(rootCodegraphDir(projectRoot));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
