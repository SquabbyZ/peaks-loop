import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type BuildTool =
  | 'umi'
  | 'next'
  | 'vite'
  | 'rsbuild'
  | 'rspack'
  | 'farm'
  | 'craco'
  | 'webpack'
  | 'gulp'
  | 'angular'
  | 'custom'
  | 'unknown';

export type ComponentLibrary = {
  readonly name:
    | 'antd'
    | 'antd-pro'
    | 'mui'
    | 'shadcn'
    | 'element-plus'
    | 'element-ui'
    | 'arco'
    | 'tdesign'
    | 'semi'
    | 'nextui'
    | 'chakra'
    | 'vant'
    | 'none';
  readonly majorVersion?: string;
  readonly hasProSuite?: boolean;
};

export type CssFramework = 'less' | 'sass' | 'tailwind' | 'css-modules' | 'styled-components' | 'emotion' | 'plain-css' | 'unknown';

export type ProjectContext = {
  readonly hasPackageJson: boolean;
  readonly buildTool: BuildTool;
  readonly buildConfigPath?: string;
  readonly componentLibrary: ComponentLibrary;
  readonly cssFrameworks: CssFramework[];
  readonly cssConflicts: string[];
  readonly stateManagement: string[];
  readonly routing: string[];
  readonly dataFetching: string[];
  readonly legacySignals: string[];
  readonly notableDeps: string[];
};

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

function detectBuildTool(projectRoot: string): { tool: BuildTool; path?: string } {
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

function majorOf(version: string | undefined): string | undefined {
  if (version === undefined) return undefined;
  const cleaned = version.replace(/^[\^~>=<]+/, '').trim();
  const major = cleaned.split('.')[0];
  return major !== undefined && /^\d+$/.test(major) ? major : undefined;
}

function detectComponentLibrary(deps: Record<string, string>): ComponentLibrary {
  if ('antd' in deps) {
    const major = majorOf(deps['antd']);
    const hasProSuite = '@ant-design/pro-components' in deps || Object.keys(deps).some((d) => d.startsWith('@ant-design/pro-'));
    return hasProSuite
      ? { name: 'antd-pro', ...(major !== undefined ? { majorVersion: major } : {}), hasProSuite: true }
      : { name: 'antd', ...(major !== undefined ? { majorVersion: major } : {}) };
  }
  if ('@mui/material' in deps) return { name: 'mui', ...(majorOf(deps['@mui/material']) !== undefined ? { majorVersion: majorOf(deps['@mui/material'])! } : {}) };
  if ('tailwindcss' in deps && Object.keys(deps).some((d) => d.startsWith('@radix-ui/'))) return { name: 'shadcn' };
  if ('element-plus' in deps) return { name: 'element-plus' };
  if ('element-ui' in deps) return { name: 'element-ui' };
  if ('@arco-design/web-react' in deps) return { name: 'arco' };
  if ('tdesign-react' in deps || 'tdesign-vue-next' in deps) return { name: 'tdesign' };
  if ('@douyinfe/semi-ui' in deps) return { name: 'semi' };
  if ('@nextui-org/react' in deps) return { name: 'nextui' };
  if ('@chakra-ui/react' in deps) return { name: 'chakra' };
  if ('vant' in deps) return { name: 'vant' };
  return { name: 'none' };
}

function detectCssFrameworks(projectRoot: string, deps: Record<string, string>): CssFramework[] {
  const frameworks: CssFramework[] = [];
  if ('tailwindcss' in deps || existsSync(join(projectRoot, 'tailwind.config.js')) || existsSync(join(projectRoot, 'tailwind.config.ts'))) {
    frameworks.push('tailwind');
  }
  if ('less' in deps || 'less-loader' in deps) frameworks.push('less');
  if ('sass' in deps || 'node-sass' in deps || 'sass-loader' in deps) frameworks.push('sass');
  if ('styled-components' in deps) frameworks.push('styled-components');
  if ('@emotion/react' in deps || '@emotion/styled' in deps) frameworks.push('emotion');
  // css-modules detection is heuristic (Umi/Next default); skip unless we see *.module.* in src
  return frameworks;
}

function detectCssConflicts(library: ComponentLibrary, frameworks: CssFramework[]): string[] {
  const conflicts: string[] = [];
  const hasTailwind = frameworks.includes('tailwind');
  if (hasTailwind && (library.name === 'antd' || library.name === 'antd-pro')) {
    conflicts.push("Tailwind preflight reset can break antd component base styles; set `corePlugins.preflight: false` in tailwind.config or scope Tailwind via `important: '#root'`.");
  }
  if (hasTailwind && library.name === 'mui') {
    conflicts.push('Tailwind preflight overrides MUI base styles; disable Tailwind preflight or scope it away from MUI roots.');
  }
  const cssInJsCount = [frameworks.includes('styled-components'), frameworks.includes('emotion')].filter(Boolean).length;
  if (cssInJsCount >= 2) {
    conflicts.push('Multiple CSS-in-JS libraries detected (styled-components + emotion); pick one and remove the other.');
  }
  return conflicts;
}

function detectStateManagement(deps: Record<string, string>): string[] {
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

function detectRouting(deps: Record<string, string>): string[] {
  const out: string[] = [];
  if ('react-router-dom' in deps) out.push('react-router-dom');
  if ('@umijs/max' in deps || '@umijs/preset-react' in deps) out.push('Umi router');
  if ('next' in deps) out.push('Next.js file-based');
  if ('vue-router' in deps) out.push('vue-router');
  return out;
}

function detectDataFetching(deps: Record<string, string>): string[] {
  const out: string[] = [];
  if ('@tanstack/react-query' in deps) out.push('@tanstack/react-query');
  if ('swr' in deps) out.push('swr');
  if ('ahooks' in deps) out.push('ahooks (useRequest)');
  if ('umi-request' in deps) out.push('umi-request');
  if ('axios' in deps) out.push('axios');
  return out;
}

function detectLegacySignals(projectRoot: string, deps: Record<string, string>): string[] {
  const signals: string[] = [];
  if ('moment' in deps) signals.push('`moment` in deps — prefer `dayjs` or `date-fns` for new code');
  if (Object.keys(deps).some((d) => d.startsWith('enzyme'))) signals.push('Enzyme test suite — write new tests with React Testing Library');
  if ('redux-saga' in deps) signals.push('redux-saga — keep saga patterns for existing flows; use Redux Toolkit thunks/RTK Query for new code');
  if ('redux-thunk' in deps && !('@reduxjs/toolkit' in deps)) signals.push('Plain redux-thunk — prefer Redux Toolkit createAsyncThunk for new code');
  if ('jquery' in deps) signals.push('jQuery — do not add new jQuery usage');
  if ('backbone' in deps) signals.push('Backbone — legacy; do not add new Backbone code');
  if (deps['vue']?.startsWith('2') === true) signals.push('Vue 2 — preserve Options API for existing components');

  // Lightweight heuristic for class components and inline styles in src/
  const srcRoot = join(projectRoot, 'src');
  if (existsSync(srcRoot)) {
    const sample = sampleSourceFiles(srcRoot, 80);
    let classComponentHits = 0;
    let inlineStyleHits = 0;
    for (const filePath of sample) {
      try {
        const content = readFileSync(filePath, 'utf8');
        if (/extends\s+(?:React\.)?Component\b/.test(content)) classComponentHits += 1;
        const matches = content.match(/style=\{\{/g);
        if (matches !== null) inlineStyleHits += matches.length;
      } catch {
        // ignore unreadable files
      }
    }
    if (classComponentHits >= 1) signals.push(`React class components detected (${classComponentHits}+ files) — keep class style for existing modules, use function components + hooks for new code`);
    if (inlineStyleHits >= 50) signals.push(`Inline styles dominant (${inlineStyleHits}+ occurrences) — match existing styling for new code in same modules`);
  }
  return signals;
}

function sampleSourceFiles(root: string, limit: number): string[] {
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
      const full = join(dir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        queue.push(full);
      } else if (/\.(tsx|jsx)$/.test(entry)) {
        out.push(full);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

function notableDepsList(deps: Record<string, string>): string[] {
  const interesting = ['monaco-editor', '@monaco-editor/react', 'react-querybuilder', '@dnd-kit/core', 'react-dnd', 'echarts', 'recharts', '@ant-design/charts', 'antd-style', 'lodash', 'lodash-es', 'rxjs', 'socket.io-client'];
  return interesting.filter((d) => d in deps);
}

export function detectProjectContext(projectRoot: string): ProjectContext {
  const { exists, deps } = readPackageJson(projectRoot);
  const { tool, path } = detectBuildTool(projectRoot);
  const componentLibrary = detectComponentLibrary(deps);
  const cssFrameworks = detectCssFrameworks(projectRoot, deps);
  return {
    hasPackageJson: exists,
    buildTool: tool,
    ...(path !== undefined ? { buildConfigPath: path } : {}),
    componentLibrary,
    cssFrameworks,
    cssConflicts: detectCssConflicts(componentLibrary, cssFrameworks),
    stateManagement: detectStateManagement(deps),
    routing: detectRouting(deps),
    dataFetching: detectDataFetching(deps),
    legacySignals: detectLegacySignals(projectRoot, deps),
    notableDeps: notableDepsList(deps)
  };
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

export function componentLibraryLabel(lib: ComponentLibrary): string {
  const base = (() => {
    switch (lib.name) {
      case 'antd':
        return 'Ant Design';
      case 'antd-pro':
        return 'Ant Design + Ant Design Pro';
      case 'mui':
        return 'Material UI';
      case 'shadcn':
        return 'shadcn/ui (Tailwind + Radix)';
      case 'element-plus':
        return 'Element Plus';
      case 'element-ui':
        return 'Element UI';
      case 'arco':
        return 'Arco Design';
      case 'tdesign':
        return 'TDesign';
      case 'semi':
        return 'Semi Design';
      case 'nextui':
        return 'NextUI';
      case 'chakra':
        return 'Chakra UI';
      case 'vant':
        return 'Vant (mobile)';
      case 'none':
        return 'no component library detected';
    }
  })();
  return lib.majorVersion !== undefined ? `${base} v${lib.majorVersion}` : base;
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
