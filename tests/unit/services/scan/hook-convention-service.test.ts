import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { scanExistingSystem } from '../../../../src/services/scan/existing-system-service.js';
import { scanHookConvention } from '../../../../src/services/scan/hook-convention-service.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

const ws = withTmpWorkspacePerTest('peaks-hook-convention-');

const HOOK_DIRS = ['src/hooks', 'src/hook', 'src/composables'];

function seedFile(relativePath: string, content: string): void {
  const absolute = join(ws().path, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

function hookReturningObject(name: string): string {
  return `export function ${name}() {\n  return { data: null, loading: false, error: null };\n}\n`;
}

describe('scanHookConvention return shapes', () => {
  it('when a hook returns an object literal, should report its shape and sorted key signature', async () => {
    // given: one hook whose return object lists its keys out of order
    seedFile('src/hooks/useUser.ts', 'export function useUser() {\n  return { loading, data, error };\n}\n');
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the shape is object, with a deterministic (sorted) key signature
    const hook = report.directories[0]?.hooks[0];
    expect(hook?.name).toBe('useUser');
    expect(hook?.returnShape).toBe('object');
    expect(hook?.returnSignature).toBe('{ data, error, loading }');
  });

  it('when a hook returns a tuple, should classify it as a tuple', async () => {
    // given: a hook that returns an array instead of an object
    seedFile('src/hooks/useLegacyX.ts', 'export function useLegacyX() {\n  return [data, setData];\n}\n');
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the distinctive return shape is classified, not flattened into "other"
    expect(report.directories[0]?.hooks[0]?.returnShape).toBe('tuple');
  });

  it('when a return object nests object values, should count only the top-level keys', async () => {
    // given: a hook returning a nested object value
    seedFile(
      'src/hooks/useNested.ts',
      'export function useNested() {\n  return { data: { id: 1 }, loading: false };\n}\n'
    );
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the nested key `id` is not part of the signature
    expect(report.directories[0]?.hooks[0]?.returnSignature).toBe('{ data, loading }');
  });

  it('when a hook wraps its body in useCallback, should still read the wrapped body', async () => {
    // given: the wrapper form `export const useX = useCallback(() => { … }, [])`
    seedFile(
      'src/hooks/useWrapped.ts',
      'export const useWrapped = useCallback(() => {\n  return { data, loading };\n}, []);\n'
    );
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the callback body's return is read, not the wrapper call
    expect(report.directories[0]?.hooks[0]?.returnShape).toBe('object');
    expect(report.directories[0]?.hooks[0]?.returnSignature).toBe('{ data, loading }');
  });

  it('when a module exports a non-function const, should not report it as a hook', async () => {
    // given: a hook file carrying a plain constant alongside the hook
    seedFile('src/hooks/useUser.ts', "export const CACHE_KEY = 'user';\n" + hookReturningObject('useUser'));
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: only the functional export is reported
    expect(report.directories[0]?.hooks.map((hook) => hook.name)).toEqual(['useUser']);
  });
});

describe('scanHookConvention inconsistency reporting', () => {
  it('when one hook in a directory deviates in shape, should name it with the counts', async () => {
    // given: eight hooks returning an object and one returning a tuple
    seedFile('src/hooks/useUsers.ts', Array.from({ length: 8 }, (_unused, index) => hookReturningObject(`useUsers${index}`)).join(''));
    seedFile('src/hooks/useLegacyX.ts', 'export function useLegacyX() {\n  return [data, setData];\n}\n');
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the deviant hook is named, with the dominant shape and its count
    expect(report.directories[0]?.hookCount).toBe(9);
    expect(report.directories[0]?.offShapeCount).toBe(1);
    expect(report.directories[0]?.offShapeHooks).toEqual(['useLegacyX']);
    expect(report.inconsistencies).toEqual([
      'hook return shape: 8 of 9 hooks in src/hooks return an object { data, error, loading }; deviating: useLegacyX (a tuple)'
    ]);
  });

  it('when an exported function omits the use prefix, should report mixed naming', async () => {
    // given: one `use`-prefixed export and one helper export in the same directory
    seedFile('src/hooks/useUser.ts', hookReturningObject('useUser'));
    seedFile('src/hooks/fetchUser.ts', 'export function fetchUser() {\n  return { data: null };\n}\n');
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the naming pattern is mixed and the deviant name is surfaced
    expect(report.directories[0]?.namingPattern).toBe('mixed');
    expect(report.inconsistencies).toContain(
      'hook naming: 1 of 2 exported functions in src/hooks use the "use" prefix; deviating: fetchUser'
    );
  });

  it('when some hooks import a mapper and others do not, should report delegation at file granularity', async () => {
    // given: one file declaring two hooks and importing a mapper, plus a
    // second file declaring one hook and importing none
    seedFile(
      'src/hooks/usePair.ts',
      "import { toUserViewModel } from '@/mappers/user.mapper';\n\nexport function usePairA() {\n  return { data: toUserViewModel(1), loading: false };\n}\n\nexport function usePairB() {\n  return { data: toUserViewModel(2), loading: false };\n}\n"
    );
    seedFile(
      'src/hooks/usePlain.ts',
      'export function usePlain() {\n  return { data: 1, loading: false };\n}\n'
    );
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the import is attributed to its FILE, not to each hook that file
    // exports, and the wording stays an observation
    expect(report.directories[0]?.hookCount).toBe(3);
    expect(report.directories[0]?.hookFileCount).toBe(2);
    expect(report.directories[0]?.mapperFiles).toEqual(['src/hooks/usePair.ts']);
    expect(report.inconsistencies.join('\n')).toContain(
      'mapper delegation (observed from import paths only): 1 of 2 hook files in src/hooks'
    );
    expect(report.inconsistencies.join('\n')).toContain('not evidence that they map inline');
  });

  it('when a directory is uniform, should report no inconsistency for it', async () => {
    // given: two hooks with the same naming and return shape, neither importing a mapper
    seedFile('src/hooks/useA.ts', hookReturningObject('useA'));
    seedFile('src/hooks/useB.ts', hookReturningObject('useB'));
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: there is nothing to flag
    expect(report.directories[0]?.namingPattern).toBe('use<X>');
    expect(report.inconsistencies).toEqual([]);
  });
});

describe('scanHookConvention robustness', () => {
  it('when no hook directory exists, should return an empty report rather than fail', async () => {
    // given: a project root with no hook directory of any kind
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the absence is reported as empty, not thrown
    expect(report).toEqual({ directories: [], inconsistencies: [] });
  });

  it('when the same files are scanned twice, should produce identical output', async () => {
    // given: files created in reverse-lexicographic order, so a directory read
    // that returned creation order rather than sorted order would differ
    seedFile('src/hooks/useZeta.ts', hookReturningObject('useZeta'));
    seedFile('src/hooks/useAlpha.ts', hookReturningObject('useAlpha'));
    // when: the scan runs twice over the same tree
    const first = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    const second = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the output is a pure function of the file text, in sorted file order
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.directories[0]?.hooks.map((hook) => hook.file)).toEqual([
      'src/hooks/useAlpha.ts',
      'src/hooks/useZeta.ts'
    ]);
  });
});

describe('scanExistingSystem hook convention wiring', () => {
  it('when a legacy project has hooks, should add hookConvention and keep the existing fields', async () => {
    // given: a legacy-frontend fixture (no backend, >= 20 src files) with a hooks dir
    seedFile('package.json', JSON.stringify({ name: 'fixture', dependencies: { react: '^18.0.0' } }));
    for (let index = 0; index < 20; index += 1) {
      seedFile(`src/pages/page${index}.ts`, 'export const page = 1;\n');
    }
    seedFile('src/hooks/useLegacyX.ts', 'export function useLegacyX() {\n  return [data, setData];\n}\n');
    // when: the existing-system scan runs
    const report = await scanExistingSystem({ projectRoot: ws().path });
    // then: the new hook convention is present and the pre-slice fields are unchanged
    expect(report.archetype).toBe('legacy-frontend');
    expect(report.conventions.hookDir).toBe('src/hooks');
    expect(report.conventions.hookConvention.directories[0]?.hooks[0]?.name).toBe('useLegacyX');
    expect(report.conventions.componentNaming).toBe('unknown');
    expect(Array.isArray(report.conventions.samples)).toBe(true);
    expect(report.visualTokens.sources).toEqual([]);
    expect(report.inconsistencies).toEqual(report.conventions.hookConvention.inconsistencies);
  });
});

describe('scanExistingSystem hook convention is not gated on the archetype', () => {
  function seedHooksOnly(): void {
    seedFile('src/hooks/useUser.ts', hookReturningObject('useUser'));
    seedFile('src/hooks/useAccount.ts', hookReturningObject('useAccount'));
    seedFile('src/hooks/useLegacyOrders.ts', 'export function useLegacyOrders() {\n  return [data, setData];\n}\n');
  }

  it('when a greenfield project has hooks, should still report the hook convention', async () => {
    // given: a react/vite frontend with no legacy signal at all
    seedFile('package.json', JSON.stringify({ name: 'fixture', dependencies: { react: '^18.0.0', vite: '^5.0.0' } }));
    seedHooksOnly();
    // when: the existing-system scan runs
    const report = await scanExistingSystem({ projectRoot: ws().path });
    // then: the legacy extraction is still skipped, but the hooks are read anyway
    expect(report.archetype).toBe('greenfield');
    expect(report.scanned).toBe(false);
    expect(report.scanSkippedReason).toContain('archetype=greenfield');
    expect(report.conventions.componentDir).toBeNull();
    expect(report.visualTokens.colors).toEqual([]);
    expect(report.conventions.hookConvention.directories[0]?.hookCount).toBe(3);
    expect(report.conventions.hookConvention.directories[0]?.offShapeHooks).toEqual(['useLegacyOrders']);
    expect(report.inconsistencies).toEqual([
      'hook return shape: 2 of 3 hooks in src/hooks return an object { data, error, loading }; deviating: useLegacyOrders (a tuple)'
    ]);
  });

  it('when a project has no package.json, should still report the hook convention', async () => {
    // given: a hook directory in a tree with no package.json (archetype unknown)
    seedHooksOnly();
    // when: the existing-system scan runs
    const report = await scanExistingSystem({ projectRoot: ws().path });
    // then: the unknown archetype skips the legacy extraction but not the hooks
    expect(report.archetype).toBe('unknown');
    expect(report.scanned).toBe(false);
    expect(report.conventions.hookConvention.directories[0]?.hooks).toHaveLength(3);
    expect(report.inconsistencies).toHaveLength(1);
  });

  it('when a frontend monorepo has hooks, should report the hook convention alongside the extraction', async () => {
    // given: a monorepo config with no backend sub-package
    seedFile('package.json', JSON.stringify({ name: 'fixture', dependencies: { react: '^18.0.0' } }));
    seedFile('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    seedHooksOnly();
    // when: the existing-system scan runs
    const report = await scanExistingSystem({ projectRoot: ws().path });
    // then: the extraction runs and carries the hook convention with it
    expect(report.archetype).toBe('frontend-monorepo');
    expect(report.scanned).toBe(true);
    expect(report.conventions.hookDir).toBe('src/hooks');
    expect(report.conventions.hookConvention.directories[0]?.offShapeHooks).toEqual(['useLegacyOrders']);
    expect(report.inconsistencies).toEqual(report.conventions.hookConvention.inconsistencies);
  });

  it('when a greenfield project has no hook directory, should report an empty convention and no inconsistency', async () => {
    // given: a greenfield frontend with no hooks directory
    seedFile('package.json', JSON.stringify({ name: 'fixture', dependencies: { react: '^18.0.0', vite: '^5.0.0' } }));
    // when: the existing-system scan runs
    const report = await scanExistingSystem({ projectRoot: ws().path });
    // then: nothing is invented and nothing throws
    expect(report.conventions.hookConvention).toEqual({ directories: [], inconsistencies: [] });
    expect(report.inconsistencies).toEqual([]);
  });
});

describe('scanHookConvention body location for arrow-const hooks', () => {
  it('when an arrow-const hook returns early inside a nested if, should report its own return shape', async () => {
    // given: the arrow form with an early tuple return inside an if block
    seedFile(
      'src/hooks/useOrders.ts',
      'export const useOrders = (id) => {\n  if (!id) {\n    return [];\n  }\n  return { orders, loading };\n};\n'
    );
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the nested return is not mistaken for the hook's own signature
    expect(report.directories[0]?.hooks[0]?.returnShape).toBe('object');
    expect(report.directories[0]?.hooks[0]?.returnSignature).toBe('{ loading, orders }');
    expect(report.directories[0]?.offShapeHooks).toEqual([]);
  });

  it('when an arrow-const hook sits beside conventional hooks, should not invent a false deviant', async () => {
    // given: three conventional object hooks plus one arrow-const hook that
    // opens with `if (` — the form that used to be read as a tuple
    seedFile('src/hooks/useUsers.ts', Array.from({ length: 3 }, (_unused, index) => hookReturningObject(`useUsers${index}`)).join(''));
    seedFile(
      'src/hooks/useOrders.ts',
      'export const useOrders = (id) => {\n  if (!id) { return []; }\n  return { data, loading, error };\n};\n'
    );
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: nothing deviates, because nothing does
    expect(report.directories[0]?.dominantReturnShape).toBe('object');
    expect(report.directories[0]?.offShapeCount).toBe(0);
    expect(report.inconsistencies).toEqual([]);
  });

  it('when an arrow-const hook nests a switch, a for and a callback, should read only its own return', async () => {
    // given: a body nesting every form that carries a `(` or an inner `{`
    seedFile('src/hooks/useComplex.ts', [
      'export const useComplex = (id) => {',
      '  switch (id) {',
      '    case 1: { return []; }',
      '    default: break;',
      '  }',
      '  for (const item of items) {',
      '    if (item) { return [item]; }',
      '  }',
      '  const load = async (x) => {',
      '    return [x];',
      '  };',
      '  return { data, loading };',
      '};',
      ''
    ].join('\n'));
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the top-level return decides, and nothing is flagged
    expect(report.directories[0]?.hooks[0]?.returnShape).toBe('object');
    expect(report.directories[0]?.hooks[0]?.returnSignature).toBe('{ data, loading }');
    expect(report.inconsistencies).toEqual([]);
  });

  it('when an arrow-const hook has an expression body, should classify the returned expression', async () => {
    // given: a parenthesised object expression body and a tuple expression body
    seedFile('src/hooks/useParen.ts', 'export const useParen = () => ({ data, loading });\n');
    seedFile('src/hooks/usePlainBody.ts', 'export const usePlainBody = () => [data, setData];\n');
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: neither falls through to "other" by accident
    const hooks = report.directories[0]?.hooks ?? [];
    expect(hooks.find((hook) => hook.name === 'useParen')?.returnShape).toBe('object');
    expect(hooks.find((hook) => hook.name === 'useParen')?.returnSignature).toBe('{ data, loading }');
    expect(hooks.find((hook) => hook.name === 'usePlainBody')?.returnShape).toBe('tuple');
  });

  it('when an arrow-const hook has a generic parameter list, should still find its body', async () => {
    // given: a generic arrow hook
    seedFile(
      'src/hooks/useGeneric.ts',
      'export const useGeneric = <T,>(id: T) => {\n  return { data: id, loading: false };\n};\n'
    );
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the body is located from the parameter list, not from the generic
    expect(report.directories[0]?.hooks[0]?.returnShape).toBe('object');
    expect(report.directories[0]?.hooks[0]?.returnSignature).toBe('{ data, loading }');
  });
});

describe('scanHookConvention ignores non-code text', () => {
  it('when a hook is commented out, should not count it as a hook', async () => {
    // given: a commented-out tuple hook ahead of a real object hook
    seedFile('src/hooks/useOrders.ts', [
      '// export function useLegacyOrders() {',
      '//   return [data, setData];',
      '// }',
      'export function useOrders() {',
      '  return { data, loading };',
      '}',
      ''
    ].join('\n'));
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: only the real hook exists, so there is nothing to deviate from
    expect(report.directories[0]?.hooks.map((hook) => hook.name)).toEqual(['useOrders']);
    expect(report.directories[0]?.dominantReturnShape).toBe('object');
    expect(report.inconsistencies).toEqual([]);
  });

  it('when a mapper import is commented out, should not count it as delegation', async () => {
    // given: a mapper import that only appears inside a line comment
    seedFile(
      'src/hooks/useOrders.ts',
      "// import { toOrderViewModel } from '@/mappers/order.mapper';\nexport function useOrders() {\n  return { data };\n}\n"
    );
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: no file is reported as importing a mapper
    expect(report.directories[0]?.mapperFiles).toEqual([]);
    expect(report.inconsistencies).toEqual([]);
  });

  it('when a mapper import sits inside a block comment, should not count it as delegation', async () => {
    // given: a block comment whose line starts with `import`, which only the
    // masked text can tell apart from real code
    seedFile('src/hooks/useOrders.ts', [
      '/*',
      "import { toOrderViewModel } from '@/mappers/order.mapper';",
      '*/',
      'export function useOrders() {',
      '  return { data };',
      '}',
      ''
    ].join('\n'));
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: it is not delegation
    expect(report.directories[0]?.mapperFiles).toEqual([]);
    expect(report.inconsistencies).toEqual([]);
  });
});

describe('scanHookConvention shape dominance', () => {
  it('when two shape classes tie, should report no dominant shape instead of picking one', async () => {
    // given: one object hook and one tuple hook
    seedFile('src/hooks/useA.ts', 'export function useA() {\n  return { data };\n}\n');
    seedFile('src/hooks/useB.ts', 'export function useB() {\n  return [data];\n}\n');
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: the tie is stated rather than resolved arbitrarily
    expect(report.directories[0]?.dominantReturnShape).toBeNull();
    expect(report.directories[0]?.offShapeHooks).toEqual([]);
    expect(report.inconsistencies).toEqual([
      'hook return shape: no dominant shape among the 2 hooks in src/hooks (object ×1, tuple ×1); no deviant set is reported'
    ]);
  });

  it('when object hooks disagree on keys, should report key drift rather than a shape deviant', async () => {
    // given: two hooks returning { data, loading } and one returning { data }
    seedFile('src/hooks/useA.ts', 'export function useA() {\n  return { data, loading };\n}\n');
    seedFile('src/hooks/useB.ts', 'export function useB() {\n  return { data, loading };\n}\n');
    seedFile('src/hooks/useC.ts', 'export function useC() {\n  return { data };\n}\n');
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: useC is still an object, so it is not a shape deviant — only its keys differ
    expect(report.directories[0]?.dominantReturnShape).toBe('object');
    expect(report.directories[0]?.dominantReturnSignature).toBe('{ data, loading }');
    expect(report.directories[0]?.offShapeHooks).toEqual([]);
    expect(report.inconsistencies).toEqual([
      'hook return keys: 2 of 3 object-returning hooks in src/hooks return an object { data, loading }; differing keys: useC ({ data })'
    ]);
  });

  it('when a hook returns a spread object, should not flag its unreadable keys as a deviant', async () => {
    // given: one readable object hook and one whose keys cannot be read
    seedFile('src/hooks/useBase.ts', 'export function useBase() {\n  return { data, loading };\n}\n');
    seedFile('src/hooks/useSpread.ts', 'export function useSpread() {\n  return { ...base };\n}\n');
    // when: the hook convention scan runs
    const report = await scanHookConvention({ projectRoot: ws().path, hookDirs: HOOK_DIRS });
    // then: an object is never described as deviating from objects
    const spread = report.directories[0]?.hooks.find((hook) => hook.name === 'useSpread');
    expect(spread?.returnShape).toBe('object');
    expect(spread?.returnSignature).toBeNull();
    expect(report.directories[0]?.offShapeHooks).toEqual([]);
    expect(report.inconsistencies).toEqual([]);
  });
});
