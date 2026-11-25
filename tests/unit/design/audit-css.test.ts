import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { AuditFinding } from '../../../src/services/design/audit/audit-finding.js';
import { auditSpacing } from '../../../src/services/design/audit/audit-spacing.js';
import { auditType } from '../../../src/services/design/audit/audit-type.js';
import { readCssProject, type CssProject } from '../../../src/services/design/audit/audit-css.js';
import { parseCss } from '../../../src/services/design/audit/css-blocks.js';
import {
  buildVariableTable,
  resolveVariable,
  stateNames,
  variableValues,
  type CssVariableTable
} from '../../../src/services/design/audit/css-variables.js';
import { buildPavedRoad } from '../../../src/services/design/paved-road.js';
import { readPavedRoad } from '../../../src/services/design/source-scan/inputs.js';
import { scanDesignSources } from '../../../src/services/design/source-scan/scan.js';
import { buildTokenContract } from '../../../src/services/design/token-contract.js';

declareDimensions('tests/unit/design/audit-css.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const CUSTOM = join(FIXTURES, 'custom-scale-project/design');

/** The fixture project's declared ladder: space 4/8/12/16/20/24, weights 400-700. */
const scale = readPavedRoad(CUSTOM).tokenScale;

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeApp(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-css-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body, 'utf8');
  }
  return root;
}

function cssProject(name: string): CssProject {
  return readCssProject({ appRoot: join(FIXTURES, name), pageRoots: ['pages'] });
}

/** The spacing audit over a fixture project, with its stylesheet table wired in. */
function spacingOf(name: string, useTable = true): AuditFinding[] {
  const project = cssProject(name);
  return auditSpacing({
    tokenScale: scale,
    sources: project.sources,
    ...(useTable ? { variables: project.variables } : {})
  });
}

/**
 * The injection control: the resolution rule inverted.
 *
 * The real rule leaves a variable with THREE distinct values `unmeasured`.
 * This wrapper keeps only the FIRST definition, so the same detector resolves
 * it to one value — the fixture must then produce a real violation. If the
 * real rule ever stopped distinguishing states, the two would agree and this
 * test would fail instead of passing vacuously.
 */
function firstDefinitionTable(table: CssVariableTable): CssVariableTable {
  return new Map([...table].map(([name, definitions]) => [name, definitions.slice(0, 1)]));
}

describe('Scenario: render — a stylesheet contributes declarations and findings', () => {
  it('when a plain-CSS page is read, should expose each declaration with file and line', () => {
    // given: the off-ladder page whose only declaration is a 13px padding
    // when: the stylesheet reader parses it
    // then: one declaration carries the property, value, selector and its line
    const project = cssProject('plain-css-off-ladder');
    expect(project.declarations).toEqual([
      {
        file: 'pages/page.css',
        line: 2,
        property: 'padding',
        value: '13px',
        selector: '.card',
        state: null
      }
    ]);
  });

  it('when an off-ladder value is reported, should render the documented finding shape', () => {
    // given: the off-ladder page judged against the declared scale
    // when: the spacing audit runs with the stylesheet table
    // then: one soft finding carries exactly the documented fields
    const findings = spacingOf('plain-css-off-ladder');
    expect(findings).toHaveLength(1);
    expect(Object.keys(findings[0] ?? {}).sort()).toEqual([
      'dimension',
      'expected',
      'file',
      'humanText',
      'line',
      'severity',
      'techText',
      'value'
    ]);
    expect(findings[0]?.dimension).toBe('spacing');
    expect(findings[0]?.severity).toBe('soft');
    expect(findings[0]?.file).toBe('pages/page.css');
    expect(findings[0]?.line).toBe(2);
  });
});

describe('Scenario: behavior — the variable rule resolves or stays unmeasured', () => {
  it('when every plain-CSS value is on the ladder, should report nothing', () => {
    // given: the clean page and the stylesheet it imports, all on the declared scale
    // when: the spacing audit runs with the import closure
    // then: no finding is emitted
    expect(spacingOf('plain-css-clean')).toEqual([]);
  });

  it('when a plain-CSS value is off the ladder, should flag it like a Tailwind page', () => {
    // given: the 13px padding page and the declared ladder whose nearest step is 12
    // when: the spacing audit runs
    // then: one soft finding cites the .css line and the nearest declared step
    const findings = spacingOf('plain-css-off-ladder');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.value).toBe('13px');
    expect(findings[0]?.expected).toBe('12');
    expect(findings[0]?.techText).toBe('pages/page.css:2 padding:13px not in tokenScale.space');
  });

  it('when --spacing has three state values, should stay unmeasured and list every state', () => {
    // given: --spacing defined under three density selectors and a padding using it
    // when: the spacing audit runs with the variable table
    // then: the one finding is unmeasured and names all three values and selectors
    const project = cssProject('plain-css-multi-state');
    const findings = spacingOf('plain-css-multi-state');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('unmeasured');
    const tech = findings[0]?.techText ?? '';
    for (const value of ['13px', '16px', '20px']) expect(tech).toContain(value);
    for (const selector of ['compact', 'comfortable', 'spacious']) expect(tech).toContain(selector);
    expect(variableValues(project.variables).get('--spacing')).toEqual(['13px', '16px', '20px']);
    expect(stateNames(project.variables)).toHaveLength(3);
    // The rule never averages the states into a fourth value nobody declared.
    expect(tech).not.toContain('16.33');
  });

  it('when a declaration lives inside a variable block, should record that selector as its state', () => {
    // given: a density block that defines --spacing and also declares a padding
    // when: the stylesheet is parsed
    // then: the declaration and the definition both name the density selector
    const parsed = parseCss(
      'theme.css',
      "[data-density='compact'] {\n  --spacing: 13px;\n  padding: var(--spacing);\n}\n"
    );
    expect(parsed.variables[0]?.state).toBe("[data-density='compact']");
    expect(parsed.declarations[0]?.state).toBe("[data-density='compact']");
    expect(parsed.variables[0]?.line).toBe(2);
  });

  it('when a variable is defined once, should resolve it to that value', () => {
    // given: --space-md defined once as 16px and a padding using it
    // when: the spacing audit runs with the variable table
    // then: the value resolves on the ladder and no finding is emitted
    const project = cssProject('plain-css-single-var');
    expect(resolveVariable(project.variables, '--space-md')).toEqual({
      kind: 'resolved',
      value: '16px',
      state: null
    });
    expect(spacingOf('plain-css-single-var')).toEqual([]);
  });

  it('when a custom property is named like a real property, should not judge it', () => {
    // given: --padding / --font-size custom properties and a $gap Sass variable
    // when: the spacing and type audits run over the stylesheet
    // then: a name that merely ends in a property is not a declaration
    const source = {
      file: 'tokens.css',
      source: ':root { --padding: 13px; --font-size: 13px; }\n$gap: 13px;\n'
    };
    expect(auditSpacing({ tokenScale: scale, sources: [source] })).toEqual([]);
    const typeFindings = auditType({ tokenScale: scale, sources: [source] });
    expect(typeFindings.filter((finding) => finding.techText.includes('font-size'))).toEqual([]);
  });

  it('when a utility wraps a unique variable, should resolve the whole value', () => {
    // given: --space-md defined once as 16px and a class utility p-[var(--space-md)]
    // when: the spacing audit runs with the variable table
    // then: the whole arbitrary value resolves to the on-ladder 16px
    const variables = buildVariableTable(
      parseCss('tokens.css', ':root { --space-md: 16px; }\n').variables
    );
    const source = {
      file: 'page.tsx',
      source: 'export const X = () => <div className="p-[var(--space-md)]">x</div>;\n'
    };
    expect(auditSpacing({ tokenScale: scale, sources: [source], variables })).toEqual([]);
  });

  it('when calc() mixes a resolved variable with a literal, should stay unmeasured', () => {
    // given: --space-md defined once and padding: calc(var(--space-md) * 2)
    // when: the spacing audit runs with the variable table
    // then: the value is unmeasured, never resolved into a 32px verdict
    const variables = buildVariableTable(
      parseCss('tokens.css', ':root { --space-md: 16px; }\n').variables
    );
    const source = {
      file: 'page.css',
      source: '.p { padding: calc(var(--space-md) * 2); }\n'
    };
    const findings = auditSpacing({ tokenScale: scale, sources: [source], variables });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('unmeasured');
    expect(findings[0]?.techText).toContain('--space-md');
  });

  it('when a font size resolves through a unique variable, should count it as a level', () => {
    // given: 12/14/16(var)/20 sizes and 400/500/600(var)/700 weights
    // when: the type audit runs with the variable table
    // then: both resolved values join their sets and no finding is emitted
    const tokens = ':root { --text-body: 16px; --weight: 600; }\n';
    const page =
      '.a { font-size: 12px; font-weight: 400; }\n' +
      '.b { font-size: 14px; font-weight: 500; }\n' +
      '.c { font-size: 20px; font-weight: 700; }\n' +
      '.d { font-size: var(--text-body); font-weight: var(--weight); }\n';
    const variables = buildVariableTable(parseCss('tokens.css', tokens).variables);
    const findings = auditType({
      tokenScale: scale,
      sources: [
        { file: 'tokens.css', source: tokens },
        { file: 'page.css', source: page }
      ],
      variables
    });
    expect(findings).toEqual([]);
  });

  it('when a font size is state-dependent, should stay unmeasured naming every state', () => {
    // given: --text-body defined under a dark and a light block
    // when: the type audit runs on a font-size using it
    // then: the size finding is unmeasured and lists both values and selectors
    const tokens =
      "[data-theme='dark'] { --text-body: 14px; }\n[data-theme='light'] { --text-body: 16px; }\n";
    const variables = buildVariableTable(parseCss('tokens.css', tokens).variables);
    const findings = auditType({
      tokenScale: scale,
      sources: [{ file: 'page.css', source: '.p { font-size: var(--text-body); }\n' }],
      variables
    });
    const unmeasured = findings.filter((finding) => finding.severity === 'unmeasured');
    expect(unmeasured).toHaveLength(1);
    expect(unmeasured[0]?.techText).toContain('--text-body');
    expect(unmeasured[0]?.techText).toContain('14px');
    expect(unmeasured[0]?.techText).toContain('16px');
    expect(unmeasured[0]?.techText).toContain("data-theme='dark'");
  });

  it('when the resolution rule is inverted, should turn the multi-state page into a violation', () => {
    // given: the multi-state fixture and a table that keeps only its first definition
    // when: both the real and the inverted resolution run the same detector
    // then: the real one is unmeasured and the inverted one reports a soft 13px
    const project = cssProject('plain-css-multi-state');
    const real = auditSpacing({
      tokenScale: scale,
      sources: project.sources,
      variables: project.variables
    });
    const inverted = auditSpacing({
      tokenScale: scale,
      sources: project.sources,
      variables: firstDefinitionTable(project.variables)
    });
    expect(real).toHaveLength(1);
    expect(real[0]?.severity).toBe('unmeasured');
    expect(inverted).toHaveLength(1);
    expect(inverted[0]?.severity).toBe('soft');
    expect(inverted[0]?.value).toBe('var(--spacing)');
    expect(inverted[0]?.expected).toBe('12');
  });
});

describe('Scenario: integration — page roots, the import closure and the G1 boundary', () => {
  it('when a page root imports a stylesheet outside it, should follow the closure', () => {
    // given: page.css imports ../styles/tokens.css, which no page root walks
    // when: the project's stylesheets are read
    // then: both files are sources and the imported one still judges clean
    const project = cssProject('plain-css-clean');
    expect(project.sources.map((source) => source.file).sort()).toEqual([
      'pages/page.css',
      'styles/tokens.css'
    ]);
    expect(project.truncated).toBe(false);
    expect(spacingOf('plain-css-clean')).toEqual([]);
  });

  it('when a stylesheet is .scss, should read it and judge its declarations', () => {
    // given: the single-var page that @use's an extra .scss partial
    // when: the stylesheets are read and audited
    // then: the .scss file is a source and its on-ladder gap contributes no finding
    const project = cssProject('plain-css-single-var');
    expect(project.sources.map((source) => source.file)).toContain('styles/extra.scss');
    expect(spacingOf('plain-css-single-var')).toEqual([]);
  });

  it('when a .css file is in the change set, should keep it out of the G1 scan', async () => {
    // given: a route with a .css file and a .tsx file, both carrying a raw colour
    // when: the G1 source scan runs over the change set
    // then: only the .tsx is scanned; the .css contributes no G1 finding at all
    const root = makeApp({
      'src/routes/page.css': '.card { color: #ff00aa; }\n',
      'src/routes/page.tsx': "export const X = () => <div style={{ color: '#0f62fe' }}>x</div>;\n"
    });
    const road = buildPavedRoad({ pageRoots: ['src/routes'], componentEntrypoints: [] });
    const tokens = buildTokenContract([
      { name: '--color-primary', value: '#0f62fe', source: 'theme.css' }
    ]);
    const result = await scanDesignSources({
      appRoot: root,
      changedFiles: ['src/routes/page.css', 'src/routes/page.tsx'],
      pavedRoad: road,
      tokens
    });
    expect(result.scannedFiles).toEqual(['src/routes/page.tsx']);
    expect(result.findings.filter((finding) => finding.file === 'src/routes/page.css')).toEqual([]);
    // Anti-vacuity: the same scan DOES flag the .tsx, so the empty .css result
    // is the boundary working, not a scan that judged nothing at all.
    expect(
      result.findings.some(
        (finding) => finding.code === 'DESIGN_RAW_COLOR' && finding.file === 'src/routes/page.tsx'
      )
    ).toBe(true);
  });
});

describe('Scenario: a11y — the bilingual pair names the state and the line', () => {
  it('when an off-ladder .css value is reported, should explain it in Chinese', () => {
    // given: the 13px plain-CSS page
    // when: the spacing audit runs
    // then: the sentence names the line and the nearest declared step
    const finding = spacingOf('plain-css-off-ladder')[0];
    expect(finding?.humanText).toContain('第 2 行');
    expect(finding?.humanText).toContain('最近的刻度是 12px');
  });

  it('when three states define one variable, should name every value in both languages', () => {
    // given: the multi-state fixture
    // when: the spacing audit runs with the variable table
    // then: neither line averages the states; both list the three values
    const finding = spacingOf('plain-css-multi-state')[0];
    for (const text of [finding?.humanText ?? '', finding?.techText ?? '']) {
      expect(text).toContain('13px');
      expect(text).toContain('16px');
      expect(text).toContain('20px');
      expect(text).toContain('--spacing');
    }
    expect(finding?.techText).toContain('state-dependent');
  });
});
