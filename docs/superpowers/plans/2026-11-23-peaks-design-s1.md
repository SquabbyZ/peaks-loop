# peaks design — S1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the design truth layer for downstream projects: `peaks design init/status/uninit`, the `design/` contract files, a G1 source scanner, a `design` request role, and the user-facing `peaks-design` orchestrator skill.

**Architecture:** A new `src/services/design/` subsystem builds and reads per-app-root `design/` contracts. A `peaks design` CLI group exposes it. The contract is consumed by a `design` request role and by a new `peaks-design` skill that sits beside `peaks-code`; both orchestrators share one contract and one future gate. S1 is source-only: it never claims a render check it cannot run.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Commander, Vitest, Node ≥24, existing `peaks` scan/standards/artifact services.

**Spec:** `docs/superpowers/specs/2026-11-23-peaks-design-governance-design.md`

## Global Constraints

- `design/` lives at the **frontend app root**, not the repo root. ModelMatrix pilot → `web/design/`.
- `blocked` is never a pass. An empty or unknown change set is `blocked`, never `not-applicable`.
- `DESIGN_ARBITRARY_VALUE` and `DESIGN_RAW_PRIMITIVE` default to `fail`.
- `DESIGN_TOKEN_COVERAGE` threshold is `0.9`.
- URL trust: loopback only, plus a URL the user explicitly recorded; no private-network hosts; no `--cookie`/`--header` passthrough.
- Screenshots: only redacted or synthetic ones may be committed; runtime screenshots and baselines are gitignored.
- The user never types `peaks` commands; the LLM runs them. No prompt may require a CLI verb or hand-authored JSON.
- Reviewable artifacts go under `.peaks/_runtime/<sessionId>/design/...`; never create `.peaks/<YYYY-MM-DD-*>/`.
- Commit messages must not contain any AI-assistant co-author trailer.
- S1 must not write `DESIGN_CONFORMANCE` gate evidence; `--gate` is S3. A source-only pass requires an explicit `--allow-source-only --accept-note "<user words>"`.
- Tests use `declareDimensions(...)` and the BDD triple as the first three consecutive comments.

## Review Focus

- **Mixed repo scoping:** a Go root with `web/` must put the contract at `web/design/`; running `scanExistingSystem` at the repo root returns zero tokens and silently produces an empty contract. Task 1 + Task 2 pin this.
- **Empty change set:** a re-check after a commit must say `blocked`, not `not-applicable`. Task 8 pins this.
- **Scanner false positives:** `style={{` inside a comment or string, and `w-[123px]` outside `className`, must not fail a file. Task 7 pins this.
- **Private-network URLs:** `http://192.168.1.5:3000` and `https://localhost.evil.com` are untrusted; a substring check would accept both. Task 4 pins this.
- **Tailwind v4 provenance:** `@theme` variables are captured only when the scan is scoped to the app root; the contract must record them as `theme-file`. Task 2 pins this.

---

### Task 1: Contract root resolution

**Files:**
- Create: `src/services/design/design-types.ts`
- Create: `src/services/design/contract-root.ts`
- Test: `tests/unit/design/contract-root.test.ts`

**Interfaces:**
- Consumes: `scanArchetype({ projectRoot })` from `src/services/scan/archetype-service.ts`.
- Produces: `resolveContractRoot(input: { projectRoot: string; appPath?: string }): Promise<ContractRootResult>`; types `ContractRoot`, `ContractRootResult`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/design/contract-root.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { resolveContractRoot } from '../../../src/services/design/contract-root.js';

declareDimensions('tests/unit/design/contract-root.test.ts', ['behavior', 'integration', 'render', 'a11y']);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }); });

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-root-'));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

describe('Scenario: behavior — the contract root is the frontend app root', () => {
  it('when the frontend is at the repo root, should return the root design dir', async () => {
    // given: a root package.json with React and a src entry
    const root = makeRoot();
    writeJson(join(root, 'package.json'), { dependencies: { react: '19.0.0' } });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
    // when: the root is resolved
    const result = await resolveContractRoot({ projectRoot: root });
    // then: the design dir is at the repo root
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('');
    expect(result.root.designRoot).toBe(join(root, 'design'));
  });

  it('when the frontend lives under web/, should return web/design and not the repo root', async () => {
    // given: a Go root and a web/ React app
    const root = makeRoot();
    writeFileSync(join(root, 'go.mod'), 'module example.com/app\n', 'utf8');
    writeJson(join(root, 'web', 'package.json'), { dependencies: { react: '19.0.0' } });
    mkdirSync(join(root, 'web', 'src'), { recursive: true });
    writeFileSync(join(root, 'web', 'src', 'main.tsx'), 'export {}', 'utf8');
    // when: the root is resolved
    const result = await resolveContractRoot({ projectRoot: root });
    // then: the app root is web/, never the Go root
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('web');
    expect(result.root.designRoot).toBe(join(root, 'web', 'design'));
  });

  it('when two apps exist without --app, should refuse as ambiguous', async () => {
    // given: two frontend apps
    const root = makeRoot();
    for (const app of ['apps/a', 'apps/b']) {
      writeJson(join(root, app, 'package.json'), { dependencies: { react: '19.0.0' } });
      mkdirSync(join(root, app, 'src'), { recursive: true });
      writeFileSync(join(root, app, 'src', 'main.tsx'), 'export {}', 'utf8');
    }
    // when: no --app is supplied
    const result = await resolveContractRoot({ projectRoot: root });
    // then: the command refuses instead of guessing
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_APP_AMBIGUOUS');
    expect(result.candidates).toEqual(['apps/a', 'apps/b']);
  });

  it('when --app names one of two apps, should select it', async () => {
    // given: two frontend apps
    const root = makeRoot();
    for (const app of ['apps/a', 'apps/b']) {
      writeJson(join(root, app, 'package.json'), { dependencies: { react: '19.0.0' } });
      mkdirSync(join(root, app, 'src'), { recursive: true });
      writeFileSync(join(root, app, 'src', 'main.tsx'), 'export {}', 'utf8');
    }
    // when: --app selects apps/a
    const result = await resolveContractRoot({ projectRoot: root, appPath: 'apps/a' });
    // then: the selected app wins
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('apps/a');
  });

  it('when no frontend evidence exists, should return DESIGN_NOT_FRONTEND', async () => {
    // given: a Go-only repo
    const root = makeRoot();
    writeFileSync(join(root, 'go.mod'), 'module example.com/app\n', 'utf8');
    // when: the root is resolved
    const result = await resolveContractRoot({ projectRoot: root });
    // then: the command refuses
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_NOT_FRONTEND');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/contract-root.test.ts`
Expected: FAIL with "Cannot find module .../contract-root.js".

- [ ] **Step 3: Implement the types and resolver**

`design-types.ts` exports `ContractRoot`, `ContractRootErrorCode`, `ContractRootResult`. `ContractRoot` is `{ appRoot: string; designRoot: string; appRelPath: string }` (POSIX-joined `appRelPath`; empty string for the repo root).

`contract-root.ts`:
- Candidates: the repo root, each immediate subdirectory with a `package.json`, and each directory under `apps/` and `packages/` with a `package.json`. Skip `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`.
- For each candidate, `await scanArchetype({ projectRoot: candidate })`; a candidate counts when `report.detected.frontendEvidence !== null || report.frontendOnly`.
- `appPath` normalizes `\` to `/`, refuses `..`, and must match a candidate; otherwise `DESIGN_APP_NOT_FOUND`.
- One candidate → `ok`; more than one without `appPath` → `DESIGN_APP_AMBIGUOUS` with sorted `candidates`; none → `DESIGN_NOT_FRONTEND`.
- `designRoot = join(appRoot, 'design')`; `appRelPath = relative(projectRoot, appRoot).split(sep).join('/')`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/contract-root.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/design/design-types.ts src/services/design/contract-root.ts tests/unit/design/contract-root.test.ts
git commit -m "feat(design): resolve the design contract root at the frontend app root"
```

---

### Task 2: Tailwind v4 provenance and app-root scoping

**Files:**
- Modify: `src/services/scan/existing-system-service.ts` (the CSS-var block near line 176)
- Test: `tests/unit/design/tailwind-v4-theme.test.ts`

**Interfaces:**
- Consumes: `scanExistingSystem({ projectRoot })`, `VisualTokenSource.kind`.
- Produces: no new API; a CSS file containing `@theme` records its source as `theme-file` instead of `css-vars`.

> **Spec correction (verified):** `parseCssVars` already reads `@theme` variables because `walkStyleFiles` walks `src/styles/**/*.css`. Do **not** add a second parser. The only code change is the source tag; the rest is a proof fixture.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/design/tailwind-v4-theme.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { scanExistingSystem } from '../../../src/services/scan/existing-system-service.js';

declareDimensions('tests/unit/design/tailwind-v4-theme.test.ts', ['behavior', 'integration', 'render', 'a11y']);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }); });

function makeWebApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-v4-'));
  roots.push(root);
  mkdirSync(join(root, 'web', 'src', 'styles'), { recursive: true });
  writeFileSync(join(root, 'web', 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0', tailwindcss: '4.3.2' } }), 'utf8');
  writeFileSync(join(root, 'web', 'src', 'main.tsx'), 'export {}', 'utf8');
  writeFileSync(
    join(root, 'web', 'src', 'styles', 'theme.css'),
    "@import 'tailwindcss';\n@theme {\n  --color-primary: oklch(0.53 0.07 156);\n  --spacing-4: 1rem;\n  --radius-md: 0.5rem;\n  --font-sans: 'Public Sans', sans-serif;\n}\n",
    'utf8'
  );
  return root;
}

describe('Scenario: integration — Tailwind v4 @theme tokens', () => {
  it('when the scan is scoped to the app root, should capture @theme tokens and tag the source', async () => {
    // given: a Tailwind v4 app under web/
    const root = makeWebApp();
    // when: the scan runs against the app root
    const report = await scanExistingSystem({ projectRoot: join(root, 'web') });
    // then: the tokens are present and the source is theme-file
    expect(report.visualTokens.colors.map((t) => t.name)).toContain('--color-primary');
    expect(report.visualTokens.spacing.map((t) => t.name)).toContain('--spacing-4');
    expect(report.visualTokens.radii.map((t) => t.name)).toContain('--radius-md');
    expect(report.visualTokens.sources).toContainEqual({ path: 'src/styles/theme.css', kind: 'theme-file' });
  });

  it('when the scan is scoped to the repo root, should find no web tokens', async () => {
    // given: the same mixed repo
    const root = makeWebApp();
    // when: the scan runs at the repo root
    const report = await scanExistingSystem({ projectRoot: root });
    // then: it does not silently claim the web tokens
    expect(report.visualTokens.colors.map((t) => t.name)).not.toContain('--color-primary');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/tailwind-v4-theme.test.ts`
Expected: FAIL — the first test's `theme-file` source is `css-vars`; the second already passes and guards scoping.

- [ ] **Step 3: Tag `@theme` files**

In `existing-system-service.ts`, when a CSS file yields variables, choose the kind by content:

```ts
const cssVars = parseCssVars(content, rel);
if (cssVars.length > 0) {
  const kind = /@theme\b/.test(content) ? 'theme-file' : 'css-vars';
  sources.push({ path: rel, kind });
  rawTokens.push(...cssVars);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/tailwind-v4-theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/scan/existing-system-service.ts tests/unit/design/tailwind-v4-theme.test.ts
git commit -m "feat(design): tag Tailwind v4 @theme variables as theme-file sources"
```

---

### Task 3: DTCG token contract

**Files:**
- Create: `src/services/design/token-contract.ts`
- Test: `tests/unit/design/token-contract.test.ts`

**Interfaces:**
- Consumes: `VisualToken` from `src/services/scan/scan-types.ts`; `classifyToken` from `src/services/scan/existing-system-visual-tokens.ts`.
- Produces: `buildTokenContract(tokens: readonly VisualToken[]): DesignTokensFile`; types `DesignTokenValue`, `DesignTokensFile`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/design/token-contract.test.ts
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { buildTokenContract } from '../../../src/services/design/token-contract.js';

declareDimensions('tests/unit/design/token-contract.test.ts', ['behavior', 'integration', 'render', 'a11y']);

describe('Scenario: behavior — tokens are grouped by DTCG category', () => {
  it('when tokens cover four categories, should emit four groups with $type', () => {
    // given: one token per category
    const file = buildTokenContract([
      { name: '--color-primary', value: 'oklch(0.53 0.07 156)', source: 'theme.css' },
      { name: '--spacing-4', value: '1rem', source: 'theme.css' },
      { name: '--radius-md', value: '0.5rem', source: 'theme.css' },
      { name: '--font-sans', value: "'Public Sans', sans-serif", source: 'theme.css' }
    ]);
    // when: the contract is built
    // then: each category carries a typed value
    expect(file.color['color-primary']).toEqual({ $value: 'oklch(0.53 0.07 156)', $type: 'color' });
    expect(file.space['spacing-4']).toEqual({ $value: '1rem', $type: 'dimension' });
    expect(file.radius['radius-md']).toEqual({ $value: '0.5rem', $type: 'dimension' });
    expect(file.font['font-sans']).toEqual({ $value: "'Public Sans', sans-serif", $type: 'fontFamily' });
  });

  it('when two sources disagree, should keep the first value deterministically', () => {
    // given: the same name with two values
    const file = buildTokenContract([
      { name: '--color-primary', value: '#111111', source: 'a.css' },
      { name: '--color-primary', value: '#222222', source: 'b.css' }
    ]);
    // when: the contract is built
    // then: the first value wins and no duplicate remains
    expect(Object.keys(file.color)).toEqual(['color-primary']);
    expect(file.color['color-primary']?.$value).toBe('#111111');
  });

  it('when there are no tokens, should emit an empty contract', () => {
    // given: no tokens
    // when: the contract is built
    const file = buildTokenContract([]);
    // then: every group is empty
    expect(file.color).toEqual({});
    expect(file.space).toEqual({});
    expect(file.font).toEqual({});
    expect(file.radius).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/token-contract.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `buildTokenContract`**

`$schema` is `https://design-tokens.org/schema.json`. Key = token name minus a leading `--`; groups sort keys with `localeCompare` so output is deterministic. Type rule: color → `color`; a typography token whose value contains `,` or a quote → `fontFamily`; all other classified tokens → `dimension`. Unclassified tokens are dropped. First value per key wins.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/token-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/design/token-contract.ts tests/unit/design/token-contract.test.ts
git commit -m "feat(design): build a DTCG token contract from scanned tokens"
```

---

### Task 4: Paved road, engine contract, and URL trust

**Files:**
- Create: `src/services/design/design-rules.ts`
- Create: `src/services/design/paved-road.ts`
- Create: `src/services/design/engine-contract.ts`
- Create: `src/services/design/url-trust.ts`
- Test: `tests/unit/design/paved-road-and-engine.test.ts`

**Interfaces:**
- Produces: `DesignRuleCode`; `PavedRoadFile`; `buildPavedRoad(input)`; `EngineContractFile`; `buildEngineContract(input)`; `isTrustedDesignUrl(url, engine): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/design/paved-road-and-engine.test.ts
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { buildPavedRoad } from '../../../src/services/design/paved-road.js';
import { buildEngineContract } from '../../../src/services/design/engine-contract.js';
import { isTrustedDesignUrl } from '../../../src/services/design/url-trust.js';

declareDimensions('tests/unit/design/paved-road-and-engine.test.ts', ['behavior', 'integration', 'render', 'a11y']);

describe('Scenario: behavior — the paved road defaults', () => {
  it('when no rules are supplied, should hard-fail arbitrary values and raw primitives', () => {
    // given: a default paved road
    const road = buildPavedRoad({ pageRoots: ['src/routes'], componentEntrypoints: ['@/components/ui'] });
    // when: the rules are read
    // then: the two symptom rules are fail, coverage stays warn
    expect(road.rules.DESIGN_ARBITRARY_VALUE).toBe('fail');
    expect(road.rules.DESIGN_RAW_PRIMITIVE).toBe('fail');
    expect(road.rules.DESIGN_TOKEN_COVERAGE).toBe('warn');
  });
});

describe('Scenario: behavior — the engine contract does not hardcode a URL', () => {
  it('when built with no explicit URL, should leave render.url null', () => {
    // given: a dev command and port
    const engine = buildEngineContract({ cwd: 'web', startCommand: 'bun run dev', port: 3000, pages: ['/'], archetypes: ['list'] });
    // when: the engine file is read
    // then: no fixed URL is stored
    expect(engine.render.url).toBeNull();
    expect(engine.render.cwd).toBe('web');
    expect(engine.render.startPolicy).toBe('never');
  });
});

describe('Scenario: a11y — URL trust', () => {
  const engine = buildEngineContract({ cwd: 'web', startCommand: null, port: 3000, pages: ['/'], archetypes: ['list'] });

  it('when the host is loopback, should trust it', () => {
    // given: loopback spellings
    // when: each is checked
    // then: all are trusted
    expect(isTrustedDesignUrl('http://localhost:3000', engine)).toBe(true);
    expect(isTrustedDesignUrl('http://127.0.0.1:3000', engine)).toBe(true);
    expect(isTrustedDesignUrl('http://[::1]:3000', engine)).toBe(true);
  });

  it('when the host is a private IP or a lookalike, should refuse', () => {
    // given: private and lookalike hosts
    // when: each is checked
    // then: none is trusted
    expect(isTrustedDesignUrl('http://192.168.1.5:3000', engine)).toBe(false);
    expect(isTrustedDesignUrl('https://localhost.evil.com', engine)).toBe(false);
    expect(isTrustedDesignUrl('http://user:pass@localhost:3000', engine)).toBe(false);
    expect(isTrustedDesignUrl('file:///tmp/page.html', engine)).toBe(false);
    expect(isTrustedDesignUrl('not-a-url', engine)).toBe(false);
  });

  it('when the engine records an explicit URL, should trust exactly that URL', () => {
    // given: a recorded public URL
    const recorded = { ...engine, render: { ...engine.render, url: 'https://design.example.com' } };
    // when: it and a different host are checked
    // then: only the recorded one is trusted
    expect(isTrustedDesignUrl('https://design.example.com', recorded)).toBe(true);
    expect(isTrustedDesignUrl('https://other.example.com', recorded)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/paved-road-and-engine.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the three modules**

- `design-rules.ts`: the six `DesignRuleCode` values and `DEFAULT_DESIGN_RULES` (`fail` for inline style, raw color, library bypass, arbitrary value, raw primitive; `warn` for coverage).
- `paved-road.ts`: `PavedRoadFile` with `schemaVersion: 1`, the copied `pageRoots`, `componentEntrypoints`, `allowDirectLibraryImports`, `bannedImportSpecifiers` (optional, default `[]`), `banned: { inlineStyle: true, rawHex: true, arbitraryTailwind: true }`, `rules`, and the `tokenScale` copied from the spec (`space`, `font`, `radius`, `color`).
- `engine-contract.ts`: `EngineContractFile` with `schemaVersion: 1`, `contractVersion: null`, `engine: { name: 'designlang', supportedMajor: 13 }`, `render: { startCommand, cwd, port, path: '/', pages, startPolicy: 'never', url: null }`, `archetypes`.
- `url-trust.ts`: parse with `new URL`; reject non-`http:`/`https:`; reject `username`/`password`; trust hostname in `{ localhost, 127.0.0.1, ::1 }` (strip IPv6 brackets); also trust when `url === engine.render.url` and that value is non-null. Catch parse errors and return `false`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/paved-road-and-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/design/design-rules.ts src/services/design/paved-road.ts src/services/design/engine-contract.ts src/services/design/url-trust.ts tests/unit/design/paved-road-and-engine.test.ts
git commit -m "feat(design): add paved-road, engine contract, and URL trust"
```

---

### Task 5: Design governance standard and the AGENTS line

**Files:**
- Create: `src/services/design/design-standard.ts`
- Modify: `src/services/standards/standards-render-agents.ts`
- Modify: `src/services/standards/project-standards-service.ts`
- Test: `tests/unit/design/design-standard.test.ts`

**Interfaces:**
- Produces: `DESIGN_GOVERNANCE_RELATIVE_PATH`, `renderDesignGovernanceStandard`, `writeDesignGovernanceStandard`, `removeDesignGovernanceStandard`; `renderAgentsMd(language, scripts, rulesRoot, options?: { hasDesignGovernance?: boolean })`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/design/design-standard.test.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  DESIGN_GOVERNANCE_RELATIVE_PATH,
  removeDesignGovernanceStandard,
  writeDesignGovernanceStandard
} from '../../../src/services/design/design-standard.js';
import { renderAgentsMd } from '../../../src/services/standards/standards-render-agents.js';

declareDimensions('tests/unit/design/design-standard.test.ts', ['behavior', 'integration', 'render', 'a11y']);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }); });

describe('Scenario: behavior — the governance standard lifecycle', () => {
  it('when written twice, should leave exactly one block', async () => {
    // given: a project root
    const root = mkdtempSync(join(tmpdir(), 'peaks-design-std-'));
    roots.push(root);
    // when: the standard is written twice
    await writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'design' });
    await writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'design' });
    // then: one start and one end marker exist
    const body = readFileSync(join(root, DESIGN_GOVERNANCE_RELATIVE_PATH), 'utf8');
    expect(body.match(/peaks:design-governance:start/g)).toHaveLength(1);
    expect(body.match(/peaks:design-governance:end/g)).toHaveLength(1);
  });

  it('when removed, should delete the file', async () => {
    // given: a written standard
    const root = mkdtempSync(join(tmpdir(), 'peaks-design-std-'));
    roots.push(root);
    await writeDesignGovernanceStandard({ projectRoot: root, designRelPath: 'design' });
    // when: it is removed
    const result = await removeDesignGovernanceStandard(root);
    // then: the file is gone
    expect(result.removed).toBe(true);
  });
});

describe('Scenario: render — the AGENTS line is conditional', () => {
  it('when design governance exists, should print the read line', () => {
    // given: the renderer with the flag on
    const body = renderAgentsMd('typescript', { commands: [] }, '.peaks/standards', { hasDesignGovernance: true });
    // when: the body is rendered
    // then: the line is present
    expect(body).toContain('common/design-governance.md');
  });

  it('when it does not exist, should omit the line', () => {
    // given: the renderer with the flag off
    const body = renderAgentsMd('typescript', { commands: [] }, '.peaks/standards', { hasDesignGovernance: false });
    // when: the body is rendered
    // then: the line is absent
    expect(body).not.toContain('common/design-governance.md');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/design-standard.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the standard and the conditional line**

- `design-standard.ts` exports the relative path, the two markers, and the body from spec §6.5. Write is idempotent: create parent dirs, replace the marked block if present, append otherwise. `remove` deletes only when the file exists.
- `standards-render-agents.ts`: add the options parameter and one line in `renderStandardsSection` when true: ``- Read `${rulesRoot}/common/design-governance.md` before changing UI code.``
- `project-standards-service.ts`: pass `{ hasDesignGovernance: existsSync(join(projectRoot, DESIGN_GOVERNANCE_RELATIVE_PATH)) }` at the `renderAgentsMd` call site.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/design-standard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/design/design-standard.ts src/services/standards/standards-render-agents.ts src/services/standards/project-standards-service.ts tests/unit/design/design-standard.test.ts
git commit -m "feat(design): write the design governance standard and an AGENTS pointer"
```

---

### Task 6: Contract lifecycle — init, status, uninit, refresh

**Files:**
- Create: `src/services/design/contract-render.ts`
- Create: `src/services/design/contract-writer.ts`
- Create: `src/services/design/design-init.ts`
- Test: `tests/unit/design/design-init.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 3, 4, 5.
- Produces: `initDesignContract(options): Promise<DesignInitResult>`, `readDesignStatus(input): Promise<DesignStatusResult>`, `removeDesignContract(input): Promise<RemoveDesignResult>`, `renderDesignContractMarkdown(input): string`, `writeDesignContractFile(input): Promise<{ written: boolean; backupPath: string | null }>`.
  - `DesignInitResult = { ok: true; root: ContractRoot; written: string[]; preserved: string[]; tokensFound: number } | { ok: false; code: string; message: string; candidates?: string[] }`.
  - `DesignStatusResult = { adopted: boolean; contractVersion: string | null; contractAgeDays: number | null; tokenCounts: { color: number; space: number; font: number; radius: number } }`.
  - `RemoveDesignResult = { ok: true; removed: string[] } | { ok: false; code: string; message: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/design/design-init.test.ts
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { initDesignContract, readDesignStatus, removeDesignContract } from '../../../src/services/design/design-init.js';

declareDimensions('tests/unit/design/design-init.test.ts', ['behavior', 'integration', 'render', 'a11y']);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }); });

function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-init-'));
  roots.push(root);
  mkdirSync(join(root, 'src', 'styles'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0', tailwindcss: '4.3.2' } }), 'utf8');
  writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
  writeFileSync(join(root, 'src', 'styles', 'theme.css'), '@theme { --color-primary: #0f62fe; --spacing-4: 1rem; }\n', 'utf8');
  return root;
}

describe('Scenario: behavior — init writes the contract once and preserves user files', () => {
  it('when run on a fresh app, should write four contract files and the standard', async () => {
    // given: a React app with a token
    const root = makeApp();
    // when: init runs
    const result = await initDesignContract({ projectRoot: root });
    // then: the files exist and the token is in the contract
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.written).toContain(join('design', 'contract.md'));
    expect(JSON.parse(readFileSync(join(root, 'design', 'tokens.json'), 'utf8')).color['color-primary'].$value).toBe('#0f62fe');
    expect(readFileSync(join(root, '.peaks', 'standards', 'common', 'design-governance.md'), 'utf8')).toContain('peaks:design-governance:start');
  });

  it('when run twice, should not overwrite the user contract', async () => {
    // given: a project already initialized
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(join(root, 'design', 'contract.md'), '# user edited\n', 'utf8');
    // when: init runs again
    const result = await initDesignContract({ projectRoot: root });
    // then: the user prose is preserved
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, 'design', 'contract.md'), 'utf8')).toBe('# user edited\n');
  });

  it('when --force is used, should back up and rewrite the contract', async () => {
    // given: a project with a user-edited contract
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(join(root, 'design', 'contract.md'), '# user edited\n', 'utf8');
    // when: init runs with force
    await initDesignContract({ projectRoot: root, force: true });
    // then: a backup exists and the file was regenerated
    expect(readFileSync(join(root, 'design', 'contract.md.bak'), 'utf8')).toBe('# user edited\n');
    expect(readFileSync(join(root, 'design', 'contract.md'), 'utf8')).not.toBe('# user edited\n');
  });

  it('when status is read, should report adoption, age, and token counts', async () => {
    // given: an initialized project
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    // when: status is read
    const status = await readDesignStatus({ projectRoot: root });
    // then: it reports the contract facts
    expect(status.adopted).toBe(true);
    expect(status.tokenCounts.color).toBeGreaterThan(0);
  });

  it('when uninit runs, should remove contract files and the standard but keep exemplars', async () => {
    // given: an initialized project with an exemplar
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    mkdirSync(join(root, 'design', 'exemplars', 'list'), { recursive: true });
    writeFileSync(join(root, 'design', 'exemplars', 'list', 'meta.json'), '{}', 'utf8');
    // when: uninit runs
    const result = await removeDesignContract({ projectRoot: root });
    // then: generated files are gone, the exemplar remains
    expect(result.ok).toBe(true);
    expect(() => readFileSync(join(root, 'design', 'contract.md'), 'utf8')).toThrow();
    expect(readFileSync(join(root, 'design', 'exemplars', 'list', 'meta.json'), 'utf8')).toBe('{}');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/design-init.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the renderer, writer, and lifecycle**

- `contract-render.ts` renders the nine headings from spec §6.5's sibling list (`Visual Theme & Atmosphere`, `Color`, `Typography`, `Spacing & Grid`, `Layout & Composition`, `Components`, `Motion & Interaction`, `Voice & Brand`, `Anti-patterns`), with the app path and token counts filled in; prose is a starting point the user edits.
- `contract-writer.ts`: create parents; if absent write; if present and `force` copy to `${file}.bak` then write; otherwise `written: false`.
- `design-init.ts`:
  - `init`: resolve root → `scanExistingSystem({ projectRoot: root.appRoot })` → `buildTokenContract` → `buildPavedRoad` (`pageRoots` default `['src/pages', 'src/routes', 'src/features', 'src/app']`; `componentEntrypoints` default `['@/components/ui']` when the detected library is shadcn, otherwise `[]`) → `buildEngineContract` → write `tokens.json`, `paved-road.json`, `engine.json`, `contract.md` (force-aware) → `writeDesignGovernanceStandard` → return `{ ok: true, root, written, preserved, tokensFound }`.
  - `engine.json` is always refreshed (machine-owned); `tokens.json` honors `force`; `contract.md` honors `force`; `paved-road.json` honors `force` for defaults but preserves an existing `rules` object.
  - `status`: adopted when all four files exist; read `tokens.json` counts; age from `contract.md` `mtime`.
  - `uninit`: remove the four files, the `.bak`, and the governance standard; leave `exemplars/`.
  - `refresh`: same as `init` but only rewrites `engine.json` and reports every other file as preserved.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/design-init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/design/contract-render.ts src/services/design/contract-writer.ts src/services/design/design-init.ts tests/unit/design/design-init.test.ts
git commit -m "feat(design): add the per-app design contract lifecycle"
```

---

### Task 7: G1 source scanner

**Files:**
- Create: `src/services/design/source-scan/rules.ts`
- Create: `src/services/design/source-scan/strip-comments.ts`
- Create: `src/services/design/source-scan/scan-file.ts`
- Create: `src/services/design/source-scan/token-coverage.ts`
- Create: `src/services/design/source-scan/scan.ts`
- Test: `tests/unit/design/source-scan.test.ts`

**Interfaces:**
- Consumes: `PavedRoadFile`, `DesignTokensFile`, `DesignRuleCode`.
- Produces: `DesignFinding = { code: DesignRuleCode; file: string; line: number; severity: 'warn' | 'fail'; message: string }`; `TokenCoverage = { covered: number; total: number; ratio: number }`; `scanDesignSources(input): Promise<{ findings: DesignFinding[]; coverage: TokenCoverage; scannedFiles: string[] }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/design/source-scan.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { buildPavedRoad } from '../../../src/services/design/paved-road.js';
import { buildTokenContract } from '../../../src/services/design/token-contract.js';
import { scanDesignSources } from '../../../src/services/design/source-scan/scan.js';

declareDimensions('tests/unit/design/source-scan.test.ts', ['behavior', 'integration', 'render', 'a11y']);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }); });

function makeApp(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-scan-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body, 'utf8');
  }
  return root;
}

const ROAD = buildPavedRoad({ pageRoots: ['src/routes'], componentEntrypoints: ['@/components/ui'] });
const TOKENS = buildTokenContract([{ name: '--color-primary', value: '#0f62fe', source: 'theme.css' }]);

describe('Scenario: behavior — each rule fires on its symptom', () => {
  it('when a page hardcodes a style object, should fail inline style', async () => {
    // given: a page with an inline style
    const root = makeApp({ 'src/routes/a.tsx': "export const A = () => <div style={{ color: 'red' }} />;" });
    // when: it is scanned
    const result = await scanDesignSources({ appRoot: root, changedFiles: ['src/routes/a.tsx'], pavedRoad: ROAD, tokens: TOKENS });
    // then: the inline-style rule fires
    expect(result.findings.map((f) => f.code)).toContain('DESIGN_INLINE_STYLE');
  });

  it('when a page hardcodes a hex colour, should fail raw colour', async () => {
    // given: a page with a hardcoded colour
    const root = makeApp({ 'src/routes/a.tsx': "export const A = () => <div className=\"text-[#fff]\" />;" });
    // when: it is scanned
    const result = await scanDesignSources({ appRoot: root, changedFiles: ['src/routes/a.tsx'], pavedRoad: ROAD, tokens: TOKENS });
    // then: the raw-colour rule fires
    expect(result.findings.map((f) => f.code)).toContain('DESIGN_RAW_COLOR');
  });

  it('when a page uses an arbitrary Tailwind value, should fail it', async () => {
    // given: an arbitrary value in className
    const root = makeApp({ 'src/routes/a.tsx': "export const A = () => <div className=\"w-[123px]\" />;" });
    // when: it is scanned
    const result = await scanDesignSources({ appRoot: root, changedFiles: ['src/routes/a.tsx'], pavedRoad: ROAD, tokens: TOKENS });
    // then: the arbitrary-value rule fires
    expect(result.findings.map((f) => f.code)).toContain('DESIGN_ARBITRARY_VALUE');
  });

  it('when a page uses a raw button, should fail the primitive rule', async () => {
    // given: a raw button
    const root = makeApp({ 'src/routes/a.tsx': 'export const A = () => <button>go</button>;' });
    // when: it is scanned
    const result = await scanDesignSources({ appRoot: root, changedFiles: ['src/routes/a.tsx'], pavedRoad: ROAD, tokens: TOKENS });
    // then: the primitive rule fires
    expect(result.findings.map((f) => f.code)).toContain('DESIGN_RAW_PRIMITIVE');
  });
});

describe('Scenario: behavior — comments and token references do not fire', () => {
  it('when the symptom is inside a comment, should not report it', async () => {
    // given: a comment containing the exact shapes
    const root = makeApp({ 'src/routes/a.tsx': "// style={{ color: 'red' }} w-[123px]\nexport const A = () => <div className=\"w-4\" />;" });
    // when: it is scanned
    const result = await scanDesignSources({ appRoot: root, changedFiles: ['src/routes/a.tsx'], pavedRoad: ROAD, tokens: TOKENS });
    // then: no finding is produced
    expect(result.findings).toEqual([]);
  });

  it('when a token variable is used, should count it as covered', async () => {
    // given: a page using var(--color-primary)
    const root = makeApp({ 'src/routes/a.tsx': "export const A = () => <div style={{ color: 'var(--color-primary)' }} />;" });
    // when: it is scanned
    const result = await scanDesignSources({ appRoot: root, changedFiles: ['src/routes/a.tsx'], pavedRoad: ROAD, tokens: TOKENS });
    // then: the value is covered even though the inline-style rule still fires
    expect(result.coverage.covered).toBe(1);
    expect(result.coverage.ratio).toBe(1);
  });

  it('when an arbitrary-value string is not in className, should not fire', async () => {
    // given: the same shape outside a className attribute
    const root = makeApp({ 'src/routes/a.tsx': "const cls = 'w-[123px]';\nexport const A = () => <div className=\"w-4\" />;" });
    // when: it is scanned
    const result = await scanDesignSources({ appRoot: root, changedFiles: ['src/routes/a.tsx'], pavedRoad: ROAD, tokens: TOKENS });
    // then: only className values are judged
    expect(result.findings.map((f) => f.code)).not.toContain('DESIGN_ARBITRARY_VALUE');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/source-scan.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the scanner**

- `strip-comments.ts`: replace `//...` and `/*...*/` with spaces while preserving newlines, so line numbers hold.
- `scan-file.ts`: find `style={...}` / `style="..."`; hex/rgb/hsl/oklch literals; `className` values containing `x-[...]`; raw `<button|<input|<select|<table`; and imports matching `pavedRoad.bannedImportSpecifiers`. Only scan files whose extension is `.tsx|.jsx|.vue|.svelte|.ts|.js` and whose path starts with one of `pageRoots`; never scan `components/ui/**`.
- `token-coverage.ts`: count each hardcoded colour/space/font/radius literal; covered when its value is in the token value set or is `var(--...)`; return `{ covered, total, ratio: total === 0 ? 1 : covered / total }`.
- `scan.ts`: read only the changed files that exist under `appRoot`, run the file scanner, aggregate findings, and add a `DESIGN_TOKEN_COVERAGE` finding when `ratio < 0.9`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/source-scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/design/source-scan tests/unit/design/source-scan.test.ts
git commit -m "feat(design): add the G1 source scanner and token coverage"
```

---

### Task 8: Source-only check service

**Files:**
- Create: `src/services/design/design-check.ts`
- Test: `tests/unit/design/design-check.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 6, 7; `readGitChangeSet` and `readRidChangeClaims`.
- Produces: `checkDesignSourceOnly(input): Promise<DesignCheckResult>`; `exitCodeForVerdict(verdict): 0 | 1 | 2 | 3`. `DesignCheckResult = { schemaVersion: 1; rid: string | null; verdict: 'pass' | 'fail' | 'blocked' | 'not-adopted' | 'not-applicable'; surface: { isUi: boolean | 'unknown'; reasons: string[] }; checks: { g1_source: { status: 'pass' | 'fail' | 'not-applicable'; findings: DesignFinding[] }; g2_render: { status: 'skipped'; reason: 'explicitly-accepted' | 's2-not-implemented' } }; findings: DesignFinding[]; coverage: TokenCoverage | null; errorCode?: string; message?: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/design/design-check.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { initDesignContract } from '../../../src/services/design/design-init.js';
import { checkDesignSourceOnly, exitCodeForVerdict } from '../../../src/services/design/design-check.js';

declareDimensions('tests/unit/design/design-check.test.ts', ['behavior', 'integration', 'render', 'a11y']);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }); });

function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-check-'));
  roots.push(root);
  mkdirSync(join(root, 'src', 'styles'), { recursive: true });
  mkdirSync(join(root, 'src', 'routes'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0', tailwindcss: '4.3.2' } }), 'utf8');
  writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
  writeFileSync(join(root, 'src', 'styles', 'theme.css'), '@theme { --color-primary: #0f62fe; }\n', 'utf8');
  writeFileSync(join(root, 'src', 'routes', 'a.tsx'), 'export const A = () => <div />;\n', 'utf8');
  return root;
}

describe('Scenario: behavior — the verdict matrix', () => {
  it('when the project has no contract, should return not-adopted', async () => {
    // given: an app without design/
    const root = makeApp();
    // when: check runs
    const result = await checkDesignSourceOnly({ projectRoot: root, changedFiles: ['src/routes/a.tsx'] });
    // then: it is not adopted
    expect(result.verdict).toBe('not-adopted');
  });

  it('when the change set is empty, should block rather than pass', async () => {
    // given: an adopted app with no changed files
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    // when: check runs with an empty set
    const result = await checkDesignSourceOnly({ projectRoot: root, changedFiles: [] });
    // then: it is blocked
    expect(result.verdict).toBe('blocked');
    expect(result.errorCode).toBe('DESIGN_CHANGE_SET_UNKNOWN');
  });

  it('when the change is not UI, should be not-applicable', async () => {
    // given: an adopted app with a README change
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    // when: check runs on a non-UI file
    const result = await checkDesignSourceOnly({ projectRoot: root, changedFiles: ['README.md'] });
    // then: it does not apply
    expect(result.verdict).toBe('not-applicable');
  });

  it('when a UI change is clean and source-only is accepted, should pass', async () => {
    // given: an adopted app with a clean page
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    // when: check runs with an explicit acceptance
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      allowSourceOnly: true,
      acceptNote: 'I accept source-only for this pilot'
    });
    // then: it passes and records the acceptance
    expect(result.verdict).toBe('pass');
    expect(result.checks.g2_render).toEqual({ status: 'skipped', reason: 'explicitly-accepted' });
  });

  it('when a UI change is dirty and source-only is accepted, should fail', async () => {
    // given: an adopted app with an inline style
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(join(root, 'src', 'routes', 'a.tsx'), "export const A = () => <div style={{ color: 'red' }} />;\n", 'utf8');
    // when: check runs with an acceptance
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      allowSourceOnly: true,
      acceptNote: 'I accept source-only for this pilot'
    });
    // then: it fails on the finding
    expect(result.verdict).toBe('fail');
    expect(exitCodeForVerdict(result.verdict)).toBe(1);
  });

  it('when source-only is not accepted, should block instead of claiming a render pass', async () => {
    // given: an adopted app with a clean page
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    // when: check runs without the acceptance
    const result = await checkDesignSourceOnly({ projectRoot: root, changedFiles: ['src/routes/a.tsx'] });
    // then: it blocks because S1 cannot run G2
    expect(result.verdict).toBe('blocked');
    expect(result.errorCode).toBe('DESIGN_RENDER_NOT_IMPLEMENTED');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/design-check.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the check matrix**

Read the three contract JSON files (`tokens.json`, `paved-road.json`, `engine.json`) from the resolved `designRoot`. Change-set source: an explicit `changedFiles` list wins; otherwise `readRidChangeClaims` when `rid` is supplied, else `readGitChangeSet(projectRoot, base ?? 'HEAD')`. An empty list from any source is the blocked case.

Order of decisions: resolve root (not frontend → `blocked`/`DESIGN_NOT_FRONTEND`) → contract missing → `not-adopted` → change set empty/unknown → `blocked`/`DESIGN_CHANGE_SET_UNKNOWN` → no UI file → `not-applicable` → scan → if a `fail`-severity finding exists → `fail`; else if `allowSourceOnly` and `acceptNote` → `pass` with `g2_render: { status: 'skipped', reason: 'explicitly-accepted' }` and `acceptedBy: sessionId`; else → `blocked`/`DESIGN_RENDER_NOT_IMPLEMENTED`. `allowSourceOnly` without `acceptNote` throws a usage error (`DESIGN_ACCEPT_NOTE_REQUIRED`). `exitCodeForVerdict`: pass/not-adopted/not-applicable → 0; fail → 1; blocked → 2.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/design-check.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/design/design-check.ts tests/unit/design/design-check.test.ts
git commit -m "feat(design): add the source-only design check matrix"
```

---

### Task 9: `peaks design` CLI

**Files:**
- Create: `src/cli/commands/design-commands.ts`
- Modify: `src/cli/commands/_register.ts`
- Test: `tests/unit/cli/design-commands.test.ts`

**Interfaces:**
- Consumes: Task 6 (`initDesignContract`, `readDesignStatus`, `removeDesignContract`) and Task 8 (`checkDesignSourceOnly`, `exitCodeForVerdict`).
- Produces: `registerDesignCommands(program, io)`; exported runners `runDesignInit`, `runDesignStatus`, `runDesignUninit`, `runDesignCheck` for direct tests.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/cli/design-commands.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { runDesignInit, runDesignStatus } from '../../../src/cli/commands/design-commands.js';

declareDimensions('tests/unit/cli/design-commands.test.ts', ['behavior', 'integration', 'render', 'a11y']);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }); });

function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-cli-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }), 'utf8');
  writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
  return root;
}

describe('Scenario: render — JSON envelopes', () => {
  it('when init succeeds, should print an ok envelope with the written files', async () => {
    // given: a frontend app
    const root = makeApp();
    const io = makeCapturedIo();
    // when: init runs as JSON
    await runDesignInit({ project: root, json: true }, io);
    // then: the envelope names the command and the files
    const parsed = JSON.parse(io.stdoutLines.join('\n'));
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('design.init');
    expect(parsed.data.written).toContain(join('design', 'contract.md'));
  });

  it('when status runs on a missing contract, should report adopted false', async () => {
    // given: a frontend app with no contract
    const root = makeApp();
    const io = makeCapturedIo();
    // when: status runs
    await runDesignStatus({ project: root, json: true }, io);
    // then: the envelope reports not adopted
    const parsed = JSON.parse(io.stdoutLines.join('\n'));
    expect(parsed.data.adopted).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/cli/design-commands.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the command group and register it**

- `design-commands.ts` registers a `design` parent with `init`, `status`, `uninit`, `check`. Options as in spec §7.1, plus `--source-only`, `--force`, `--refresh`, `--start`, `--port`, `--pages`, `--archetypes`. Use `addJsonOption`. **Do not register `--gate` in S1**; S3 adds it. Accepting the flag and refusing it would be a second verb surface for something not implemented.
- Envelopes: `ok('design.init', data, [], nextActions)` and `fail(command, code, message, data, nextActions)`; set `process.exitCode` to `exitCodeForVerdict` on check.
- In `_register.ts`, add the import and a `['design-commands', registerDesignCommands]` entry in `REGISTRATIONS` (do not add it to `NON_AUTO`; do not register it a second time in `program.ts`).
- Keep the runners exported and free of `process.exit()` so tests call them directly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/cli/design-commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/design-commands.ts src/cli/commands/_register.ts tests/unit/cli/design-commands.test.ts
git commit -m "feat(design): add the peaks design CLI group"
```

---

### Task 10: `design` request role

**Files:**
- Modify: `src/services/artifacts/artifact-templates.ts`
- Modify: `src/services/artifacts/artifact-template-bodies.ts`
- Modify: `src/services/artifacts/request-artifact-service.ts`
- Modify: `src/services/artifacts/request-artifact-state-helpers.ts`
- Modify: `src/services/artifacts/artifact-contract-block.ts`
- Modify: `src/cli/commands/request-format-helpers.ts`
- Test: `tests/unit/artifacts/design-role.test.ts`

**Interfaces:**
- Produces: `RequestArtifactRole` includes `'design'`; `DESIGN_TEMPLATE_BODY`; `renderDesignTemplate`; `ALLOWED_STATES_PER_ROLE.design`; `parseRole('design')` returns `'design'`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/artifacts/design-role.test.ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { renderTemplate } from '../../../src/services/artifacts/artifact-templates.js';
import { allowedStatesForRole } from '../../../src/services/artifacts/request-artifact-state-helpers.js';
import { createRequestArtifact } from '../../../src/services/artifacts/request-artifact-service.js';
import { parseRole } from '../../../src/cli/commands/request-format-helpers.js';

declareDimensions('tests/unit/artifacts/design-role.test.ts', ['behavior', 'integration', 'render', 'a11y']);

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }); });

describe('Scenario: behavior — the design role is a first-class request role', () => {
  it('when the role is parsed, should accept design', () => {
    // given: the CLI role parser
    // when: design is parsed
    // then: it is accepted
    expect(parseRole('design')).toBe('design');
  });

  it('when the state map is read, should allow the six design states', () => {
    // given: the state table
    // when: design states are read
    // then: the six lifecycle states are present
    expect(allowedStatesForRole('design')).toEqual(['draft', 'spec-locked', 'implemented', 'qa-handoff', 'handed-off', 'blocked']);
  });

  it('when the template is rendered, should carry the five sections', () => {
    // given: a design request context
    const body = renderTemplate('design', 'rid-1', 'sid-1', 'slug', '2026-11-23T00:00:00.000Z', { requestType: 'feature', projectRoot: '/tmp/x' });
    // when: the body is inspected
    // then: every section is present
    for (const heading of ['## Scope', '## Contract status', '## Conformance', '## Changed paths', '## Acceptance']) {
      expect(body).toContain(heading);
    }
  });

  it('when a design artifact is created, should land under design/requests', async () => {
    // given: a project root
    const root = mkdtempSync(join(tmpdir(), 'peaks-design-role-'));
    roots.push(root);
    // when: a design request is created
    const result = await createRequestArtifact({ role: 'design', requestId: 'rid-1', projectRoot: root, sessionId: 'sid-1', apply: true });
    // then: the artifact path and body are correct
    expect(result.path.replace(/\\/g, '/')).toContain('/design/requests/rid-1.md');
    expect(readFileSync(result.path, 'utf8')).toContain('## Contract status');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/artifacts/design-role.test.ts`
Expected: FAIL — `parseRole('design')` throws; the template switch has no `design` case.

- [ ] **Step 3: Extend every role surface**

- `artifact-templates.ts`: add `'design'` to the type; add `case 'design': return renderDesignTemplate(...)`.
- `artifact-template-bodies.ts`: add `DESIGN_TEMPLATE_BODY` with exactly the five headings; include a `## Changed paths` section so the RD claim reader can use it.
- `request-artifact-service.ts`: add `'design'` to its `VALID_ROLES` Set and to both error messages (the list is duplicated in two throw sites).
- `request-artifact-state-helpers.ts`: add `design: ['draft', 'spec-locked', 'implemented', 'qa-handoff', 'handed-off', 'blocked']`.
- `artifact-contract-block.ts`: add `'design'` to `TYPE_SOURCE_ROLES`.
- `request-format-helpers.ts`: add `'design'` to `VALID_ROLES`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/artifacts/design-role.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/artifacts/artifact-templates.ts src/services/artifacts/artifact-template-bodies.ts src/services/artifacts/request-artifact-service.ts src/services/artifacts/request-artifact-state-helpers.ts src/services/artifacts/artifact-contract-block.ts src/cli/commands/request-format-helpers.ts tests/unit/artifacts/design-role.test.ts
git commit -m "feat(design): add the design request role"
```

---

### Task 11: `peaks-design` skill and registration

**Files:**
- Create: `skills/peaks-design/SKILL.md`
- Create: `skills/peaks-design/test_prompts.json`
- Modify: `src/services/skills/presence-role.ts`
- Modify: `.claude/output-styles/peaks-skill-swarm.md`
- Modify: `src/services/skills/skill-conformance-service.ts`
- Modify: `src/cli/commands/_super.ts`
- Modify: all `skills/**/SKILL.md` (loop-hygiene block `25` → `26`)
- Test: existing guards + one new smoke test

**Interfaces:**
- Consumes: the `peaks design` CLI (Task 9) and the `design` role (Task 10).
- Produces: an orchestrator-tier skill named `peaks-design` that is user-invocable and never dispatches `src/**` edits.

- [ ] **Step 1: Write the failing smoke test**

```ts
// tests/unit/skills/peaks-design-skill.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { presenceRoleTier } from '../../../src/services/skills/presence-role.js';

declareDimensions('tests/unit/skills/peaks-design-skill.test.ts', ['behavior', 'integration', 'render', 'a11y']);

const BODY = readFileSync(join('skills', 'peaks-design', 'SKILL.md'), 'utf8');

describe('Scenario: behavior — the design orchestrator contract', () => {
  it('when the skill is registered, should have the orchestrator tier', () => {
    // given: the shipped skill set
    // when: the role tier is read
    // then: it is an orchestrator
    expect(presenceRoleTier('peaks-design')).toBe('orchestrator');
  });

  it('when the skill body is read, should reference the loop guideline and the CLI', () => {
    // given: the skill body
    // when: the required references are checked
    // then: both are present
    expect(BODY).toContain('.peaks/standards/loop-engineering-guidelines.md');
    expect(BODY).toContain('peaks design check');
  });

  it('when the skill body is read, should forbid direct source edits', () => {
    // given: the skill body
    // when: the red line is checked
    // then: it names the RD dispatch requirement
    expect(BODY).toContain('peaks sub-agent dispatch rd');
  });
});
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/unit/skills/peaks-design-skill.test.ts`
Expected: FAIL with ENOENT for `skills/peaks-design/SKILL.md`.

- [ ] **Step 3: Create the skill and register it**

- Copy the loop-hygiene block **byte-for-byte** from `skills/peaks-code/SKILL.md`. In the same commit, change `Edit one, edit all 25` to `Edit one, edit all 26` in **all** SKILL.md files (the test compares all copies; an atomic change is required).
- Frontmatter: name `peaks-design`, a description naming the triggers `/peaks-design`, "设计治理", "UI 治理", "设计系统", "页面风格不一致"; no `visibility: internal`.
- Body: purpose; RL-8 scope (design work in code repos only); the sibling-lane boundary (never dispatched by peaks-code); owned (contract, audit, remediation plan, gate); delegated (`peaks-ui` aesthetics on top of the contract, `peaks-rd` for every source edit, `peaks-qa` for verification); the default flow from spec §9.3; the hard rules from spec §10.
- `test_prompts.json`: three NL prompts, modeled on `skills/peaks-doctor/test_prompts.json`.
- Register: add `'peaks-design'` to `ORCHESTRATOR_ROLE_SKILLS`; add it to the orchestrator list in `.claude/output-styles/peaks-skill-swarm.md`; add it to `SKILL_NAMES` in `skill-conformance-service.ts`; add a `design/ui/设计系统` route in `_super.ts`.

- [ ] **Step 4: Run the guards to verify they pass**

Run:
```bash
npx vitest run --config vitest.config.ts tests/unit/skills/peaks-design-skill.test.ts tests/unit/skills/loop-hygiene-block.test.ts tests/unit/skills/presence-role-coverage.test.ts
node node_modules/tsx/dist/cli.mjs src/cli/index.ts skill lint --category loop-engineering-readiness --path skills/peaks-design --json
```
Expected: PASS; the lint envelope has `ok: true`.

- [ ] **Step 5: Commit**

```bash
git add skills/peaks-design src/services/skills/presence-role.ts .claude/output-styles/peaks-skill-swarm.md src/services/skills/skill-conformance-service.ts src/cli/commands/_super.ts skills/*/SKILL.md skills/bee/*/SKILL.md tests/unit/skills/peaks-design-skill.test.ts
git commit -m "feat(design): add the peaks-design orchestrator skill"
```

---

## Self-Review Notes

- **Spec coverage:** S1 covers init/status/uninit/refresh, app-root contracts, token extraction, paved road, engine/URL trust, governance standard, G1, source-only check, `design` role, and the skill skeleton. G2 and `--gate` are deliberately S2/S3.
- **Spec correction to carry back:** Tailwind v4 needs no new parser (`parseCssVars` already covers `@theme`); the real prerequisite is app-root scoping plus the `theme-file` source tag. The spec's §6.4/U16 wording should be updated to match.
- **Known S1 boundary:** `peaks design check` without `--allow-source-only --accept-note` returns `blocked` (`DESIGN_RENDER_NOT_IMPLEMENTED`). That is intentional: S1 has no render engine, and a pass would be a false claim.
