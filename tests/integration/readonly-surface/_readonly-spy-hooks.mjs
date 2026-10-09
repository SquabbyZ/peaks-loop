// tests/integration/readonly-surface/_readonly-spy-hooks.mjs
//
// Loader hooks for layer B of the read-only proof (PRD rid-035 AC-3 B).
//
// WHY HOOKS AND NOT PROPERTY ASSIGNMENT. `import { spawn } from 'node:child_process'`
// binds to a read-only ESM namespace: assigning `childProcess.spawn = ...` throws
// (`Cannot assign to read only property 'spawn'`), so a preload that patches the
// module object intercepts NOTHING and the arm would pass while measuring zero
// because it never measured. The hook below replaces the module NAMESPACE for the
// specifier, which every importer observes.
//
// The replacement delegates to the real builtin, obtained through `createRequire`
// because this hook body runs on the loader thread (its `globalThis` is NOT the
// application's) while the generated module body below is evaluated on the MAIN
// thread - so the counters it writes are the ones the preload reads back.
//
// The wrapper re-exports a default as well as the named bindings: `import http from
// 'node:http'` is a shape real consumers use, and a namespace without a default
// turns that import into a SyntaxError rather than a measured call.

const CHILD_PROCESS_FNS = [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork'
];

const HTTP_FNS = ['request', 'get'];

function wrapperSource(specifier, exported) {
  const declared = exported.map((name) => `export const ${name} = wrap(${JSON.stringify(name)});`);
  const asDefault = exported.map((name) => `${name}: wrap(${JSON.stringify(name)})`).join(', ');
  return [
    "import { createRequire } from 'node:module';",
    `const real = createRequire(process.execPath)(${JSON.stringify(specifier)});`,
    'const spy = globalThis.__PEAKS_READONLY_SPY__;',
    'const note = (name) => {',
    '  if (!spy) return;',
    `  spy.calls.push(${JSON.stringify(specifier)} + '.' + name);`,
    `  if (${JSON.stringify(specifier)} === 'node:child_process') spy.childProcess += 1;`,
    '  else spy.network += 1;',
    '};',
    'const wrap = (name) => (...args) => { note(name); return real[name](...args); };',
    ...declared,
    `export default { ...real, ${asDefault} };`
  ].join('\n');
}

const REPLACEMENTS = {
  'peaks-readonly-spy:child_process': ['node:child_process', CHILD_PROCESS_FNS],
  'peaks-readonly-spy:http': ['node:http', HTTP_FNS],
  'peaks-readonly-spy:https': ['node:https', HTTP_FNS]
};

const INTERCEPTED = new Map([
  ['node:child_process', 'peaks-readonly-spy:child_process'],
  ['child_process', 'peaks-readonly-spy:child_process'],
  ['node:http', 'peaks-readonly-spy:http'],
  ['http', 'peaks-readonly-spy:http'],
  ['node:https', 'peaks-readonly-spy:https'],
  ['https', 'peaks-readonly-spy:https']
]);

export async function resolve(specifier, context, next) {
  const replacement = INTERCEPTED.get(specifier);
  if (replacement !== undefined) {
    return { url: replacement, shortCircuit: true, format: 'module' };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  const replacement = REPLACEMENTS[url];
  if (replacement !== undefined) {
    return {
      format: 'module',
      shortCircuit: true,
      source: wrapperSource(replacement[0], replacement[1])
    };
  }
  return next(url, context);
}
