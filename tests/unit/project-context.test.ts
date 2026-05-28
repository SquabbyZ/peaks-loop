import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  detectProjectContext,
  buildToolLabel,
  componentLibraryLabel,
  cssFrameworkLabel,
  type ProjectContext,
} from '../../src/services/standards/project-context.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-project-context-'));
}

function writePkg(project: string, deps: Record<string, string>) {
  writeFileSync(join(project, 'package.json'), JSON.stringify({ dependencies: deps }), 'utf8');
}

function writePkgWithDev(project: string, deps: Record<string, string>, devDeps: Record<string, string>) {
  writeFileSync(join(project, 'package.json'), JSON.stringify({ dependencies: deps, devDependencies: devDeps }), 'utf8');
}

describe('detectProjectContext', () => {
  test('returns hasPackageJson:false for greenfield project', () => {
    const project = makeProject();
    try {
      const ctx = detectProjectContext(project);
      expect(ctx.hasPackageJson).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns unknown build tool when no config found', () => {
    const project = makeProject();
    try {
      writePkg(project, { react: '^18' });
      const ctx = detectProjectContext(project);
      expect(ctx.buildTool).toBe('unknown');
      expect(ctx.hasPackageJson).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects .umirc.ts as umi build tool', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@umijs/max': '^4' });
      writeFileSync(join(project, '.umirc.ts'), 'export default {}');
      const ctx = detectProjectContext(project);
      expect(ctx.buildTool).toBe('umi');
      expect(ctx.buildConfigPath).toBe('.umirc.ts');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('build tool detection', () => {
  const buildConfigs: Array<[string, string]> = [
    ['next', 'next.config.js'],
    ['vite', 'vite.config.ts'],
    ['rsbuild', 'rsbuild.config.ts'],
    ['rspack', 'rspack.config.js'],
    ['farm', 'farm.config.ts'],
    ['craco', 'craco.config.js'],
    ['webpack', 'webpack.config.js'],
    ['gulp', 'gulpfile.js'],
    ['angular', 'angular.json'],
  ];

  for (const [tool, configFile] of buildConfigs) {
    test(`detects ${tool} from ${configFile}`, () => {
      const project = makeProject();
      try {
        writePkg(project, { react: '^18' });
        writeFileSync(join(project, configFile), '');
        const ctx = detectProjectContext(project);
        expect(ctx.buildTool).toBe(tool);
        expect(ctx.buildConfigPath).toBe(configFile);
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });
  }
});

describe('component library detection', () => {
  test('detects antd', () => {
    const project = makeProject();
    try {
      writePkg(project, { antd: '^5.12.0' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('antd');
      expect(ctx.componentLibrary.majorVersion).toBe('5');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects antd-pro with pro-components', () => {
    const project = makeProject();
    try {
      writePkg(project, { antd: '^5.12.0', '@ant-design/pro-components': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('antd-pro');
      expect(ctx.componentLibrary.hasProSuite).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects mui', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@mui/material': '^5.15.0' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('mui');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects shadcn/ui (tailwindcss + radix)', () => {
    const project = makeProject();
    try {
      writePkg(project, { tailwindcss: '^3', '@radix-ui/react-dialog': '^1' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('shadcn');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects element-plus', () => {
    const project = makeProject();
    try {
      writePkg(project, { 'element-plus': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('element-plus');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects element-ui', () => {
    const project = makeProject();
    try {
      writePkg(project, { 'element-ui': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('element-ui');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects arco', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@arco-design/web-react': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('arco');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects tdesign', () => {
    const project = makeProject();
    try {
      writePkg(project, { 'tdesign-react': '^1' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('tdesign');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects semi', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@douyinfe/semi-ui': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('semi');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects nextui', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@nextui-org/react': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('nextui');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects chakra', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@chakra-ui/react': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('chakra');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects vant', () => {
    const project = makeProject();
    try {
      writePkg(project, { vant: '^4' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('vant');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns none when no component library found', () => {
    const project = makeProject();
    try {
      writePkg(project, { react: '^18' });
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('none');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('CSS framework detection', () => {
  test('detects tailwindcss from deps', () => {
    const project = makeProject();
    try {
      writePkg(project, { tailwindcss: '^3' });
      const ctx = detectProjectContext(project);
      expect(ctx.cssFrameworks).toContain('tailwind');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects tailwindcss from config file', () => {
    const project = makeProject();
    try {
      writePkg(project, { react: '^18' });
      writeFileSync(join(project, 'tailwind.config.js'), 'module.exports = {}');
      const ctx = detectProjectContext(project);
      expect(ctx.cssFrameworks).toContain('tailwind');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects less', () => {
    const project = makeProject();
    try {
      writePkg(project, { less: '^4' });
      const ctx = detectProjectContext(project);
      expect(ctx.cssFrameworks).toContain('less');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects sass', () => {
    const project = makeProject();
    try {
      writePkg(project, { sass: '^1.70' });
      const ctx = detectProjectContext(project);
      expect(ctx.cssFrameworks).toContain('sass');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects styled-components', () => {
    const project = makeProject();
    try {
      writePkg(project, { 'styled-components': '^6' });
      const ctx = detectProjectContext(project);
      expect(ctx.cssFrameworks).toContain('styled-components');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects emotion', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@emotion/react': '^11' });
      const ctx = detectProjectContext(project);
      expect(ctx.cssFrameworks).toContain('emotion');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('CSS conflicts', () => {
  test('reports tailwind + antd conflict', () => {
    const project = makeProject();
    try {
      writePkg(project, { antd: '^5', tailwindcss: '^3' });
      const ctx = detectProjectContext(project);
      expect(ctx.cssConflicts.length).toBeGreaterThan(0);
      expect(ctx.cssConflicts.some((c) => c.includes('antd'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('reports tailwind + mui conflict', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@mui/material': '^5', tailwindcss: '^3' });
      const ctx = detectProjectContext(project);
      expect(ctx.cssConflicts.some((c) => c.includes('MUI'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('reports multiple CSS-in-JS libraries', () => {
    const project = makeProject();
    try {
      writePkg(project, { 'styled-components': '^6', '@emotion/react': '^11' });
      const ctx = detectProjectContext(project);
      expect(ctx.cssConflicts.some((c) => c.includes('CSS-in-JS'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('no conflicts for plain project', () => {
    const project = makeProject();
    try {
      writePkg(project, { react: '^18' });
      const ctx = detectProjectContext(project);
      expect(ctx.cssConflicts).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('state management detection', () => {
  test('detects zustand', () => {
    const project = makeProject();
    try {
      writePkg(project, { zustand: '^4' });
      const ctx = detectProjectContext(project);
      expect(ctx.stateManagement).toContain('zustand');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects Redux Toolkit', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@reduxjs/toolkit': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.stateManagement).toContain('Redux Toolkit');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects multiple state management libs', () => {
    const project = makeProject();
    try {
      writePkg(project, { zustand: '^4', jotai: '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.stateManagement).toContain('zustand');
      expect(ctx.stateManagement).toContain('jotai');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('routing detection', () => {
  test('detects react-router-dom', () => {
    const project = makeProject();
    try {
      writePkg(project, { 'react-router-dom': '^6' });
      const ctx = detectProjectContext(project);
      expect(ctx.routing).toContain('react-router-dom');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects Next.js file-based routing', () => {
    const project = makeProject();
    try {
      writePkg(project, { next: '^14' });
      writeFileSync(join(project, 'next.config.js'), '');
      const ctx = detectProjectContext(project);
      expect(ctx.routing).toContain('Next.js file-based');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects vue-router', () => {
    const project = makeProject();
    try {
      writePkg(project, { 'vue-router': '^4' });
      const ctx = detectProjectContext(project);
      expect(ctx.routing).toContain('vue-router');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('data fetching detection', () => {
  test('detects @tanstack/react-query', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@tanstack/react-query': '^5' });
      const ctx = detectProjectContext(project);
      expect(ctx.dataFetching).toContain('@tanstack/react-query');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects swr', () => {
    const project = makeProject();
    try {
      writePkg(project, { swr: '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.dataFetching).toContain('swr');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects axios', () => {
    const project = makeProject();
    try {
      writePkg(project, { axios: '^1.6' });
      const ctx = detectProjectContext(project);
      expect(ctx.dataFetching).toContain('axios');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('legacy signals', () => {
  test('detects moment in deps', () => {
    const project = makeProject();
    try {
      writePkg(project, { moment: '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('moment'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects enzyme', () => {
    const project = makeProject();
    try {
      writePkg(project, { enzyme: '^3' });
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('Enzyme'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects redux-saga', () => {
    const project = makeProject();
    try {
      writePkg(project, { 'redux-saga': '^1' });
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('redux-saga'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects redux-thunk without RTK', () => {
    const project = makeProject();
    try {
      writePkg(project, { 'redux-thunk': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('redux-thunk'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('no redux-thunk signal when RTK is present', () => {
    const project = makeProject();
    try {
      writePkg(project, { '@reduxjs/toolkit': '^2', 'redux-thunk': '^2' });
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('redux-thunk'))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects jquery', () => {
    const project = makeProject();
    try {
      writePkg(project, { jquery: '^3' });
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('jQuery'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects backbone', () => {
    const project = makeProject();
    try {
      writePkg(project, { backbone: '^1' });
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('Backbone'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects Vue 2', () => {
    const project = makeProject();
    try {
      writePkg(project, { vue: '2.7.14' });
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('Vue 2'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects class components in source files', () => {
    const project = makeProject();
    try {
      writePkg(project, { react: '^18' });
      mkdirSync(join(project, 'src'), { recursive: true });
      writeFileSync(join(project, 'src', 'OldThing.tsx'), 'class OldThing extends React.Component {}', 'utf8');
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('class component'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('detects dominant inline styles', () => {
    const project = makeProject();
    try {
      writePkg(project, { react: '^18' });
      mkdirSync(join(project, 'src'), { recursive: true });
      const lines = Array.from({ length: 60 }, (_, i) => `const e${i} = <div style={{ color: 'red' }} />;`);
      writeFileSync(join(project, 'src', 'Styled.tsx'), lines.join('\n'), 'utf8');
      const ctx = detectProjectContext(project);
      expect(ctx.legacySignals.some((s) => s.includes('Inline styles dominant'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('notable deps', () => {
  test('detects notable dependencies', () => {
    const project = makeProject();
    try {
      writePkg(project, { echarts: '^5', lodash: '^4' });
      const ctx = detectProjectContext(project);
      expect(ctx.notableDeps).toContain('echarts');
      expect(ctx.notableDeps).toContain('lodash');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('empty notable deps for plain project', () => {
    const project = makeProject();
    try {
      writePkg(project, { react: '^18' });
      const ctx = detectProjectContext(project);
      expect(ctx.notableDeps).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('label functions', () => {
  test('buildToolLabel returns readable labels for all tools', () => {
    expect(buildToolLabel('umi')).toBe('Umi');
    expect(buildToolLabel('next')).toBe('Next.js');
    expect(buildToolLabel('vite')).toBe('Vite');
    expect(buildToolLabel('rsbuild')).toBe('Rsbuild');
    expect(buildToolLabel('rspack')).toBe('Rspack');
    expect(buildToolLabel('farm')).toBe('Farm');
    expect(buildToolLabel('craco')).toBe('CRA + craco');
    expect(buildToolLabel('webpack')).toBe('Webpack');
    expect(buildToolLabel('gulp')).toBe('Gulp (legacy)');
    expect(buildToolLabel('angular')).toBe('Angular');
    expect(buildToolLabel('custom')).toBe('Custom build pipeline');
    expect(buildToolLabel('unknown')).toBe('unknown');
  });

  test('componentLibraryLabel returns readable labels', () => {
    expect(componentLibraryLabel({ name: 'antd' })).toBe('Ant Design');
    expect(componentLibraryLabel({ name: 'antd', majorVersion: '5' })).toBe('Ant Design v5');
    expect(componentLibraryLabel({ name: 'antd-pro', hasProSuite: true })).toBe('Ant Design + Ant Design Pro');
    expect(componentLibraryLabel({ name: 'mui', majorVersion: '5' })).toBe('Material UI v5');
    expect(componentLibraryLabel({ name: 'shadcn' })).toBe('shadcn/ui (Tailwind + Radix)');
    expect(componentLibraryLabel({ name: 'none' })).toBe('no component library detected');
  });

  test('cssFrameworkLabel returns readable labels', () => {
    expect(cssFrameworkLabel('less')).toBe('Less');
    expect(cssFrameworkLabel('sass')).toBe('Sass/SCSS');
    expect(cssFrameworkLabel('tailwind')).toBe('TailwindCSS');
    expect(cssFrameworkLabel('css-modules')).toBe('CSS Modules');
    expect(cssFrameworkLabel('styled-components')).toBe('styled-components');
    expect(cssFrameworkLabel('emotion')).toBe('Emotion');
    expect(cssFrameworkLabel('plain-css')).toBe('plain CSS');
    expect(cssFrameworkLabel('unknown')).toBe('unknown');
  });
});

describe('peer dependencies', () => {
  test('includes peerDependencies in detection', () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, 'package.json'), JSON.stringify({
        peerDependencies: { antd: '^5' }
      }), 'utf8');
      const ctx = detectProjectContext(project);
      expect(ctx.componentLibrary.name).toBe('antd');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('corrupt package.json', () => {
  test('handles unreadable package.json gracefully', () => {
    const project = makeProject();
    try {
      writeFileSync(join(project, 'package.json'), '{invalid', 'utf8');
      const ctx = detectProjectContext(project);
      expect(ctx.hasPackageJson).toBe(true);
      expect(ctx.buildTool).toBe('unknown');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
