import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildToolLabel,
  collectPackageLegacySignals,
  cssFrameworkLabel,
  detectBuildTool,
  detectCssConflicts,
  detectDataFetching,
  detectRouting,
  detectStateManagement,
  isIgnoredEntry,
  isJsxFile,
  majorOf,
  notableDepsList,
  readDirOrEmpty,
  readPackageJson,
  scanSampleForLegacyMarkers,
  statOrNull
} from './project-context-support.js';
import type {
  BuildTool,
  ComponentLibrary,
  CssFramework,
  ProjectContext
} from './project-context-types.js';

/**
 * Re-exported so that every consumer of `./project-context.js` keeps seeing
 * the whole surface after the b1 file-size split: the four vocabulary names
 * are declared in `./project-context-types.js` and the two label maps in
 * `./project-context-support.js`.
 */
export { buildToolLabel, cssFrameworkLabel };
export type { BuildTool, ComponentLibrary, CssFramework, ProjectContext };

/** Library detector — returns a `ComponentLibrary` when its package
 *  signal is present, otherwise `null` so the dispatcher can move on.
 *  Each detector is a single-function unit (≤ 3 branches) so the
 *  per-detector complexity stays under the `complexity` threshold.
 *  Refactored 2026-08-07 (PRD-002b slice 3 Commit C — table-dispatch):
 *  replaces the original 12-step `if`-chain with a `[signal, detect]`
 *  table iterated in order; first detector to match wins. */
type LibraryDetector = (
  deps: Record<string, string>,
  projectRoot: string
) => ComponentLibrary | null;

const LIBRARY_DETECTORS: readonly LibraryDetector[] = [
  detectAntd,
  detectMui,
  detectElementPlus,
  detectElementUi,
  detectArco,
  detectTdesign,
  detectSemi,
  detectNextui,
  detectChakra,
  detectVant,
  detectShadcn
];

export function detectComponentLibrary(
  projectRoot: string,
  deps: Record<string, string>
): ComponentLibrary {
  for (const detector of LIBRARY_DETECTORS) {
    const result = detector(deps, projectRoot);
    if (result !== null) return result;
  }
  return { name: 'none' };
}

function detectAntd(deps: Record<string, string>, _projectRoot: string): ComponentLibrary | null {
  if (!('antd' in deps)) return null;
  const major = majorOf(deps['antd']);
  const hasProSuite =
    '@ant-design/pro-components' in deps ||
    Object.keys(deps).some((d) => d.startsWith('@ant-design/pro-'));
  return hasProSuite
    ? {
        name: 'antd-pro',
        ...(major !== undefined ? { majorVersion: major } : {}),
        hasProSuite: true
      }
    : { name: 'antd', ...(major !== undefined ? { majorVersion: major } : {}) };
}

function detectMui(deps: Record<string, string>, _projectRoot: string): ComponentLibrary | null {
  if (!('@mui/material' in deps)) return null;
  const major = majorOf(deps['@mui/material']);
  return { name: 'mui', ...(major !== undefined ? { majorVersion: major } : {}) };
}

function detectElementPlus(
  deps: Record<string, string>,
  _projectRoot: string
): ComponentLibrary | null {
  return 'element-plus' in deps ? { name: 'element-plus' } : null;
}

function detectElementUi(
  deps: Record<string, string>,
  _projectRoot: string
): ComponentLibrary | null {
  return 'element-ui' in deps ? { name: 'element-ui' } : null;
}

function detectArco(deps: Record<string, string>, _projectRoot: string): ComponentLibrary | null {
  return '@arco-design/web-react' in deps ? { name: 'arco' } : null;
}

function detectTdesign(
  deps: Record<string, string>,
  _projectRoot: string
): ComponentLibrary | null {
  return 'tdesign-react' in deps || 'tdesign-vue-next' in deps ? { name: 'tdesign' } : null;
}

function detectSemi(deps: Record<string, string>, _projectRoot: string): ComponentLibrary | null {
  return '@douyinfe/semi-ui' in deps ? { name: 'semi' } : null;
}

function detectNextui(deps: Record<string, string>, _projectRoot: string): ComponentLibrary | null {
  return '@nextui-org/react' in deps ? { name: 'nextui' } : null;
}

function detectChakra(deps: Record<string, string>, _projectRoot: string): ComponentLibrary | null {
  return '@chakra-ui/react' in deps ? { name: 'chakra' } : null;
}

function detectVant(deps: Record<string, string>, _projectRoot: string): ComponentLibrary | null {
  return 'vant' in deps ? { name: 'vant' } : null;
}

/** shadcn / ui is a Tailwind-based component primitive set shipped as
 *  copyable source files under `components/ui/`. It has no top-level
 *  package of its own, so the signal we use is: at least one of its
 *  peer utilities (cva, clsx, tailwind-merge, lucide-react) is present
 *  AND Tailwind is present (either as a dep or via a components/ui dir). */
function detectShadcn(deps: Record<string, string>, projectRoot: string): ComponentLibrary | null {
  const hasPeerUtility =
    'class-variance-authority' in deps ||
    'clsx' in deps ||
    'tailwind-merge' in deps ||
    'lucide-react' in deps;
  if (!hasPeerUtility) return null;
  const hasTailwind =
    'tailwindcss' in deps ||
    existsSync(join(projectRoot, 'components', 'ui')) ||
    existsSync(join(projectRoot, 'src', 'components', 'ui'));
  return hasTailwind ? { name: 'shadcn' } : null;
}

function detectCssFrameworks(projectRoot: string, deps: Record<string, string>): CssFramework[] {
  const frameworks: CssFramework[] = [];
  if (
    'tailwindcss' in deps ||
    existsSync(join(projectRoot, 'tailwind.config.js')) ||
    existsSync(join(projectRoot, 'tailwind.config.ts'))
  ) {
    frameworks.push('tailwind');
  }
  if ('less' in deps || 'less-loader' in deps) frameworks.push('less');
  if ('sass' in deps || 'node-sass' in deps || 'sass-loader' in deps) frameworks.push('sass');
  if ('styled-components' in deps) frameworks.push('styled-components');
  if ('@emotion/react' in deps || '@emotion/styled' in deps) frameworks.push('emotion');
  // css-modules detection is heuristic (Umi/Next default); skip unless we see *.module.* in src
  return frameworks;
}

function detectLegacySignals(projectRoot: string, deps: Record<string, string>): string[] {
  const signals: string[] = [];
  collectPackageLegacySignals(deps, signals);
  collectSourceFileLegacySignals(projectRoot, signals);
  return signals;
}

function collectSourceFileLegacySignals(projectRoot: string, signals: string[]): void {
  const srcRoot = join(projectRoot, 'src');
  if (!existsSync(srcRoot)) return;
  const sample = sampleSourceFiles(srcRoot, 80);
  const { classComponentHits, inlineStyleHits } = scanSampleForLegacyMarkers(sample);
  if (classComponentHits >= 1)
    signals.push(
      `React class components detected (${classComponentHits}+ files) — keep class style for existing modules, use function components + hooks for new code`
    );
  if (inlineStyleHits >= 50)
    signals.push(
      `Inline styles dominant (${inlineStyleHits}+ occurrences) — match existing styling for new code in same modules`
    );
}

function sampleSourceFiles(root: string, limit: number): string[] {
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()!;
    const entries = readDirOrEmpty(dir);
    for (const entry of entries) {
      if (isIgnoredEntry(entry)) continue;
      const full = join(dir, entry);
      const s = statOrNull(full);
      if (s === null || s === undefined) continue;
      if (s.isDirectory()) {
        queue.push(full);
      } else if (isJsxFile(entry)) {
        out.push(full);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

export function detectProjectContext(projectRoot: string): ProjectContext {
  const { exists, deps } = readPackageJson(projectRoot);
  const { tool, path } = detectBuildTool(projectRoot);
  const componentLibrary = detectComponentLibrary(projectRoot, deps);
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

export function componentLibraryLabel(lib: ComponentLibrary): string {
  const base = (() => {
    switch (lib.name) {
      case 'antd':
        return 'Ant Design';
      case 'antd-pro':
        return 'Ant Design + Ant Design Pro';
      case 'mui':
        return 'Material UI';
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
      case 'shadcn':
        return 'shadcn / ui';
      case 'vant':
        return 'Vant (mobile)';
      case 'none':
        return 'no component library detected';
    }
  })();
  return lib.majorVersion !== undefined ? `${base} v${lib.majorVersion}` : base;
}
