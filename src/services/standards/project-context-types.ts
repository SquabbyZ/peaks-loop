/**
 * The detected-stack vocabulary, hoisted verbatim out of `project-context.ts`
 * by the b1 file-size campaign: the build-tool / component-library /
 * CSS-framework unions and the `ProjectContext` record they assemble into.
 *
 * No union member, field, default or doc comment was edited.
 * `project-context.ts` re-exports all four names, so every
 * `import type { ProjectContext } from './project-context.js'` keeps
 * resolving through the path its consumers already use.
 */

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
    | 'element-plus'
    | 'element-ui'
    | 'arco'
    | 'tdesign'
    | 'semi'
    | 'nextui'
    | 'chakra'
    | 'shadcn'
    | 'vant'
    | 'none';
  readonly majorVersion?: string;
  readonly hasProSuite?: boolean;
};

export type CssFramework =
  | 'less'
  | 'sass'
  | 'tailwind'
  | 'css-modules'
  | 'styled-components'
  | 'emotion'
  | 'plain-css'
  | 'unknown';

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
