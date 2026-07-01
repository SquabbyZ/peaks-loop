# Peaks-Loop Pre-RD project scan checklist

> Extracted from `skills/peaks-solo/SKILL.md` on 2026-06-09 (slice 019 — slim skill files to references) to keep SKILL.md under the 800-line cap from `common/coding-style.md`. The content below is the verbatim Pre-RD project scan checklist that was previously inline; nothing was paraphrased, just relocated.

Before handing off to `peaks-rd`, scan the project and record findings to `.peaks/_runtime/<sessionId>/rd/project-scan.md`. RD and UI roles read this before starting work. **project-scan.md is a session-scoped singleton** — check if it already exists before regenerating (e.g. via `ls .peaks/_runtime/<sessionId>/rd/project-scan.md`). If it exists and is complete (has `## Archetype` and `## Project mode` sections), reuse it. Only regenerate if missing or incomplete.

### 0. Project archetype detection (MANDATORY — run FIRST, deterministic CLI)

Run the CLI; do NOT infer the archetype from prompts. Record the JSON output as `## Archetype` and `## Project mode` in `project-scan.md`. Later gates (frontend-only mode, visual system extraction, standards generation) read these fields.

```bash
peaks scan archetype --project <repo> --json
```

The command emits a stable JSON envelope with these fields you copy verbatim into `project-scan.md`:

- `archetype`: `greenfield | legacy-frontend | legacy-fullstack | frontend-monorepo | unknown`
- `confidence`: `high | medium | low`
- `frontendOnly`: `true | false`
- `frontendOnlyReason`: short string explaining the decision
- `signals[]`: each signal's name, matched flag, and detail (paste under `## Archetype → Signals matched`)
- `detected`: raw filesystem facts (package.json presence, backend frameworks, swagger paths, monorepo configs, src file count, lockfile age)

If `archetype` is `unknown`, STOP and surface to the user as an open question in the TXT handoff — do NOT guess. If `confidence` is `low`, note the uncertainty in `project-scan.md` and confirm the choice with the user before proceeding.

The CLI is the sole source of truth for archetype and frontend-only-mode decisions. Manual heuristics in older versions of this skill are superseded by the CLI output.

### 1. Build tool: inspect config files for the framework

| Config file | Framework |
|---|---|
| `.umirc.ts`, `config/config.ts` | Umi (Ant Design Pro) |
| `next.config.*` | Next.js |
| `vite.config.*` | Vite |
| `rsbuild.config.*` | Rsbuild |
| `rspack.config.*` | Rspack |
| `farm.config.*` | Farm |
| `craco.config.*` | CRA + craco |
| `webpack.config.*` | Webpack |
| `gulpfile.*` | Gulp (legacy) |
| `angular.json` | Angular |
| Custom `build/` or `scripts/build.*` only | Bespoke pipeline — record as `custom` and capture entry script path |

If multiple build configs coexist (e.g. `webpack.config.js` + `vite.config.ts`), record ALL of them and mark `build.mixed: true`. Mixed builds are a constraint, not an error — do not silently pick one.

### 2. Component library: check `package.json` dependencies

| Package | Library |
|---|---|
| `antd` (capture major version: v3/v4/v5) | Ant Design |
| `@ant-design/pro-components`, `@ant-design/pro-*` | Ant Design Pro suite |
| `@mui/material` | Material UI |
| `tailwindcss` + `radix-ui` | shadcn/ui |
| `element-plus` / `element-ui` | Element UI/Plus |
| `@arco-design/web-react` | Arco Design |
| `tdesign-react` / `tdesign-vue-next` | TDesign |
| `@douyinfe/semi-ui` | Semi Design |
| `@nextui-org/react` | NextUI |
| `@chakra-ui/react` | Chakra UI |
| `vant` | Vant (mobile) |
| Workspace package (`workspace:*`) or private-registry scope matching internal design system | In-house design system — record package name and entry path |

**CRITICAL**: Never add a second component library to a project that already has one. Do not introduce shadcn/ui to an antd project or vice versa. For antd, ALSO record the major version — v3 / v4 / v5 have incompatible APIs and tokens; mixing component code across majors is a blocker.

### 3. CSS framework: check for conflicts

- **antd + TailwindCSS**: High conflict risk (preflight reset overrides base styles). Resolution:
  - Both already in `package.json` → coexist; use Tailwind for layout, antd for components.
  - Tailwind breaks antd styles → add `corePlugins: { preflight: false }` or `important: '#root'`.
  - Only antd, user wants Tailwind → **Block**; propose antd `ConfigProvider` tokens or CSS Modules.
- **Less/Sass**: Standard for Umi+antd projects; compatible with CSS Modules.
- **CSS-in-JS (@emotion, styled-components)**: Check if component library already uses one internally; don't add competing solutions.

### 4. State management, routing, data fetching: detect from `package.json`

State: `zustand`, `jotai`, `redux`/`@reduxjs/toolkit`, `valtio`, `mobx`, `hox`
Routing: `react-router-dom`, `@umijs/max`, Next.js file-based, `vue-router`
Data fetching: `@tanstack/react-query`, `swr`, `ahooks` (`useRequest`), `umi-request`

### 5. Legacy signals (legacy-frontend / legacy-fullstack only)

Grep `src/` for outdated patterns and list them as constraints in `project-scan.md` under `## Legacy constraints`. RD must preserve these patterns for new code in the same file/module unless PRD explicitly authorizes modernization.

| Signal | Detection |
|---|---|
| Class components | `extends React.Component` / `extends Component` in `.tsx`/`.jsx` |
| `moment` instead of dayjs/date-fns | `package.json` dep |
| Enzyme test suite | `package.json` dep `enzyme*` |
| redux-saga / redux-thunk | `package.json` dep |
| HOC-heavy patterns | `withRouter`, `connect()`, `compose(` frequency in `src/` |
| Legacy lifecycle | `componentWillMount`/`componentWillReceiveProps` occurrences |
| jQuery / Backbone / Vue 2 | `package.json` dep |
| Inline styles dominant | `style={{` occurrences ≥ 50 |

### 6. Project-scan artifact template

```markdown
# Project Scan: <project-name>
**Date:** YYYY-MM-DD
**Session:** <session-id>

## Archetype
- Type: <greenfield | legacy-frontend | legacy-fullstack | frontend-monorepo | unknown>
- Signals matched: <bullet list of signals that drove the decision>

## Project mode
- Frontend-only: <true | false>
- Reason: <archetype-derived | user-stated | backend-detected>

## Build tool
- Framework: <name> <version>
- Config file: <path>
- Mixed builds: <true | false; list all configs if true>

## Component library
- Library: <name> <version (major matters for antd)>
- Design-system packages: <list>
- In-house design system: <package name | none>

## CSS solution
- Primary: <Less/Sass/CSS-in-JS/TailwindCSS/CSS Modules>
- Conflicts detected: <none | description and recommendation>

## State management, routing, data fetching
- State: <name>
- Routing: <name>
- Data fetching: <name>

## Library versions
- Source: output of `peaks scan libraries --project <repo> --json` (see Gate A; cross-check diff imports against `schemas/library-breaking-changes.data.json` in `peaks-rd` preflight)
- Total: <count from scan.libraries.totalCount>
- Notable: <bullet list of libraries with major >= a known breaking change in `schemas/library-breaking-changes.data.json`; e.g. "- antd@^5.18.0 (major=5) — see breaking-change rule for antd v4→v5 if any code uses Drawer.width">

## Legacy constraints
- <bullet list of legacy signals from section 5; empty for greenfield>
```
