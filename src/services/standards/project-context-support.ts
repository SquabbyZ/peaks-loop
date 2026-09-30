/**
 * Support declarations hoisted verbatim out of `project-context.ts` by the
 * b1 file-size campaign: the package.json reader, the build-tool config probe
 * and its candidate table, the semver-major helper, the CSS-conflict /
 * state-management / routing / data-fetching / notable-dependency tables, the
 * package-level legacy-signal collector, the sampled-JSX marker scanner and
 * the directory-walk helpers it walks with — plus the two display-label maps
 * that were finding-free where they stood.
 *
 * Signatures, bodies, tables and comments are unchanged; the two long
 * signatures that could not take an `export ` prefix without being re-wrapped
 * are exported from the footer below so every moved line stays byte-identical.
 *
 * What deliberately stayed in `project-context.ts` is every declaration that
 * carries a lint finding today: the `_projectRoot` `no-unused-vars` cluster
 * behind the detector table, `detectCssFrameworks` and
 * `componentLibraryLabel` (both over the `complexity` threshold),
 * `collectSourceFileLegacySignals` (`no-magic-numbers`) and
 * `sampleSourceFiles` (a non-null assertion). A campaign sibling must be
 * clean outright, so a finding-carrying declaration cannot be hoisted into
 * one — which is also why only two of the three label maps live here.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { BuildTool, ComponentLibrary, CssFramework } from './project-context-types.js';

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readPackageJson(projectRoot: string): { exists: boolean; deps: Record<string, string> } {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return { exists: false, deps: {} };
  try {
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as PackageJson;
    return {
      exists: true,
      deps: {
        ...(parsed.dependencies ?? {}),
        ...(parsed.devDependencies ?? {}),
        ...(parsed.peerDependencies ?? {})
      }
    };
  } catch {
    return { exists: true, deps: {} };
  }
}

function configExists(projectRoot: string, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(join(projectRoot, candidate))) return candidate;
  }
  return undefined;
}

export function detectBuildTool(projectRoot: string): { tool: BuildTool; path?: string } {
  const map: Array<[BuildTool, string[]]> = [
    ['umi', ['.umirc.ts', '.umirc.js', 'config/config.ts', 'config/config.js']],
    ['next', ['next.config.js', 'next.config.ts', 'next.config.mjs']],
    ['vite', ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']],
    ['rsbuild', ['rsbuild.config.ts', 'rsbuild.config.js']],
    ['rspack', ['rspack.config.ts', 'rspack.config.js']],
    ['farm', ['farm.config.ts', 'farm.config.js']],
    ['craco', ['craco.config.js', 'craco.config.ts']],
    ['webpack', ['webpack.config.js', 'webpack.config.ts']],
    ['gulp', ['gulpfile.js', 'gulpfile.ts']],
    ['angular', ['angular.json']]
  ];
  for (const [tool, candidates] of map) {
    const found = configExists(projectRoot, candidates);
    if (found !== undefined) return { tool, path: found };
  }
  return { tool: 'unknown' };
}

export function majorOf(version: string | undefined): string | undefined {
  if (version === undefined) return undefined;
  const cleaned = version.replace(/^[\^~>=<]+/, '').trim();
  const major = cleaned.split('.')[0];
  return major !== undefined && /^\d+$/.test(major) ? major : undefined;
}

function detectCssConflicts(library: ComponentLibrary, frameworks: CssFramework[]): string[] {
  const conflicts: string[] = [];
  const hasTailwind = frameworks.includes('tailwind');
  if (hasTailwind && (library.name === 'antd' || library.name === 'antd-pro')) {
    conflicts.push(
      "Tailwind preflight reset can break antd component base styles; set `corePlugins.preflight: false` in tailwind.config or scope Tailwind via `important: '#root'`."
    );
  }
  if (hasTailwind && library.name === 'mui') {
    conflicts.push(
      'Tailwind preflight overrides MUI base styles; disable Tailwind preflight or scope it away from MUI roots.'
    );
  }
  const cssInJsCount = [
    frameworks.includes('styled-components'),
    frameworks.includes('emotion')
  ].filter(Boolean).length;
  if (cssInJsCount >= 2) {
    conflicts.push(
      'Multiple CSS-in-JS libraries detected (styled-components + emotion); pick one and remove the other.'
    );
  }
  return conflicts;
}

export function detectStateManagement(deps: Record<string, string>): string[] {
  const map: Array<[string, string]> = [
    ['zustand', 'zustand'],
    ['jotai', 'jotai'],
    ['@reduxjs/toolkit', 'Redux Toolkit'],
    ['redux', 'redux'],
    ['valtio', 'valtio'],
    ['mobx', 'mobx'],
    ['hox', 'hox']
  ];
  return map.filter(([dep]) => dep in deps).map(([, label]) => label);
}

export function detectRouting(deps: Record<string, string>): string[] {
  const out: string[] = [];
  if ('react-router-dom' in deps) out.push('react-router-dom');
  if ('@umijs/max' in deps || '@umijs/preset-react' in deps) out.push('Umi router');
  if ('next' in deps) out.push('Next.js file-based');
  if ('vue-router' in deps) out.push('vue-router');
  return out;
}

export function detectDataFetching(deps: Record<string, string>): string[] {
  const out: string[] = [];
  if ('@tanstack/react-query' in deps) out.push('@tanstack/react-query');
  if ('swr' in deps) out.push('swr');
  if ('ahooks' in deps) out.push('ahooks (useRequest)');
  if ('umi-request' in deps) out.push('umi-request');
  if ('axios' in deps) out.push('axios');
  return out;
}

export function collectPackageLegacySignals(deps: Record<string, string>, signals: string[]): void {
  if ('moment' in deps)
    signals.push('`moment` in deps — prefer `dayjs` or `date-fns` for new code');
  if (Object.keys(deps).some((d) => d.startsWith('enzyme')))
    signals.push('Enzyme test suite — write new tests with React Testing Library');
  if ('redux-saga' in deps)
    signals.push(
      'redux-saga — keep saga patterns for existing flows; use Redux Toolkit thunks/RTK Query for new code'
    );
  if ('redux-thunk' in deps && !('@reduxjs/toolkit' in deps))
    signals.push('Plain redux-thunk — prefer Redux Toolkit createAsyncThunk for new code');
  if ('jquery' in deps) signals.push('jQuery — do not add new jQuery usage');
  if ('backbone' in deps) signals.push('Backbone — legacy; do not add new Backbone code');
  if (deps['vue']?.startsWith('2') === true)
    signals.push('Vue 2 — preserve Options API for existing components');
}

export function scanSampleForLegacyMarkers(sample: readonly string[]): {
  classComponentHits: number;
  inlineStyleHits: number;
} {
  let classComponentHits = 0;
  let inlineStyleHits = 0;
  for (const filePath of sample) {
    try {
      const content = readFileSync(filePath, 'utf8');
      if (/extends\s+(?:React\.)?Component\b/.test(content)) classComponentHits += 1;
      const matches = content.match(/style=\{\{/g);
      if (matches !== null) inlineStyleHits += matches.length;
    } catch {
      // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // ignore unreadable files
    }
  }
  return { classComponentHits, inlineStyleHits };
}

export function readDirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function statOrNull(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

export function isIgnoredEntry(entry: string): boolean {
  if (entry.startsWith('.')) return true;
  if (entry === 'node_modules' || entry === 'dist' || entry === 'build') return true;
  return false;
}

export function isJsxFile(entry: string): boolean {
  return /\.(tsx|jsx)$/.test(entry);
}

export function notableDepsList(deps: Record<string, string>): string[] {
  const interesting = [
    'monaco-editor',
    '@monaco-editor/react',
    'react-querybuilder',
    '@dnd-kit/core',
    'react-dnd',
    'echarts',
    'recharts',
    '@ant-design/charts',
    'antd-style',
    'lodash',
    'lodash-es',
    'rxjs',
    'socket.io-client'
  ];
  return interesting.filter((d) => d in deps);
}

export function buildToolLabel(tool: BuildTool): string {
  const labels: Record<BuildTool, string> = {
    umi: 'Umi',
    next: 'Next.js',
    vite: 'Vite',
    rsbuild: 'Rsbuild',
    rspack: 'Rspack',
    farm: 'Farm',
    craco: 'CRA + craco',
    webpack: 'Webpack',
    gulp: 'Gulp (legacy)',
    angular: 'Angular',
    custom: 'Custom build pipeline',
    unknown: 'unknown'
  };
  return labels[tool];
}

export function cssFrameworkLabel(framework: CssFramework): string {
  const labels: Record<CssFramework, string> = {
    less: 'Less',
    sass: 'Sass/SCSS',
    tailwind: 'TailwindCSS',
    'css-modules': 'CSS Modules',
    'styled-components': 'styled-components',
    emotion: 'Emotion',
    'plain-css': 'plain CSS',
    unknown: 'unknown'
  };
  return labels[framework];
}

export { readPackageJson, detectCssConflicts };
