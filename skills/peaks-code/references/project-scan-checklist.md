# Peaks-Loop Pre-RD project scan checklist

> Extracted from `skills/peaks-code/SKILL.md` on 2026-06-09 (slice 019 — slim skill files to references) to keep SKILL.md under the 800-line cap from `common/coding-style.md`. The content below is the verbatim Pre-RD project scan checklist that was previously inline; nothing was paraphrased, just relocated.

Before handing off to `peaks-rd`, scan the project and record findings to `.peaks/project-scan/project-scan.md` (project-level, git-tracked; sibling of `.peaks/PROJECT.md`). RD and UI roles read this before starting work. **project-scan.md is a project-scoped singleton** — check if it already exists before regenerating (e.g. via `ls .peaks/project-scan/project-scan.md`). If it exists and is complete (has `## Archetype` and `## Project mode` sections), reuse it. Only regenerate if missing or incomplete.

> **Slice 2026-07-15-project-scan-bootstrap (G1 + G2 + G4b):** `peaks workspace init` and `peaks project context` now both bootstrap `.peaks/project-scan/project-scan.md` automatically. On a brand-new 0-1 project (no `package.json` or no source files) the file is seeded with `archetype: unknown` + `(empty)` placeholder rows. On an existing project it is filled from `peaks scan archetype` + `peaks scan libraries` output. Idempotent — re-running `workspace init` does NOT overwrite the existing file unless `--force` is passed.

### 0. Project archetype detection (MANDATORY — run FIRST, deterministic CLI)

Run the CLI; do NOT infer the archetype from prompts. Record the JSON output as `## Archetype` and `## Project mode` in `project-scan.md`. Later gates (frontend-only mode, visual system extraction, standards generation) read these fields.

```bash
peaks scan archetype --project <repo> --json
```

The command emits a stable JSON envelope with these fields you copy verbatim into `project-scan.md`:

- `archetype`: `greenfield | legacy-frontend | legacy-fullstack | frontend-monorepo | unknown`
- `confidence`: `high | medium | low`
- `frontendOnly`: `true | false` (back-compat boolean — keep it recorded)
- `frontendOnlyReason`: short string explaining the decision
- `integrationMode`: `full-stack | prd-plus-interface-doc | prd-only` — which of the three frontend integration scenarios the project is in (`full-stack` = backend in this repo, contract is a shared interface; `prd-plus-interface-doc` = no backend here but an interface doc exists, derive the ACL from it; `prd-only` = no backend and no doc yet, mock and keep the boundary cheap to change)
- `integrationModeReason`: short string explaining the decision (`backend-detected | interface-doc-present | no-backend-no-interface-doc`)
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
- Integration mode: <full-stack | prd-plus-interface-doc | prd-only> (from `peaks scan archetype --json` → `.integrationMode`)
- Integration mode reason: <backend-detected | interface-doc-present | no-backend-no-interface-doc>
- Frontend-only: <true | false>
- Reason: <archetype-derived | user-stated | backend-detected>

The integration mode is one of exactly three values, all derived by `peaks scan archetype`
from signals it already detects — never judged by hand. The 0-1 bootstrap stub writes
`unknown` instead, because on that path no archetype report has been produced yet; treat
`unknown` as "not yet scanned", not as a fourth mode.

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

## API
- Record file paths, not summaries — a later slice diffs against them, and a path that has moved is a finding.
- Base URL / env configuration: <env-var name(s) and the file that reads them, e.g. `VITE_API_BASE` in `src/config/env.ts` | none>
- Request wrapper + interceptors: <path of the single HTTP entry point, e.g. `src/services/http/client.ts`, and the mechanism used for cross-cutting concerns — axios interceptors, a `fetch` wrapper, ofetch hooks — with the auth/retry/header logic named | none>
- Error-handling shape: <what the wrapper hands callers on failure — thrown `Error` subclass, `{ ok, data, error }` result, HTTP-status branch — and the file where it is normalised>
- Hook convention: <naming pattern and directory, e.g. `use<Domain>` under `src/hooks/`, the return shape (`{ data, loading, error }` | `[data, actions]` | query object), and whether the hook does its own mapping or delegates>
- Endpoint inventory: <one bullet per endpoint the frontend actually calls — `METHOD /path` → calling file; when an interface doc exists, cross-check with `peaks scan api-diff <path-to-doc>`>
- Existing mock strategy: <mechanism in use today (module mock | MSW | static fixture module | inline) and where mock files live. Per `frontend-only-mode.md` mocks MUST NOT be inline in component files — an inline mock here is a finding, record it>
- DTO ↔ ViewModel boundary: <path of the per-domain mapper file, e.g. `src/mappers/user.mapper.ts`, and the internal ViewModel file it targets, per `skills/bee/peaks-rd/references/frontend-acl-mapper.md`. Record `none` explicitly when there is no mapper — that is a finding, not a blank>

## Library versions
- Source: output of `peaks scan libraries --project <repo> --json` (see Gate A; cross-check diff imports against `schemas/library-breaking-changes.data.json` in `peaks-rd` preflight)
- Total: <count from scan.libraries.totalCount>
- Notable: <bullet list of libraries with major >= a known breaking change in `schemas/library-breaking-changes.data.json`; e.g. "- antd@^5.18.0 (major=5) — see breaking-change rule for antd v4→v5 if any code uses Drawer.width">

## Legacy constraints
- <bullet list of legacy signals from section 5; empty for greenfield>
```
