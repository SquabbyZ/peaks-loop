# Peaks-Loop Frontend-only development mode

> Extracted from `skills/peaks-code/SKILL.md` on 2026-06-09 (slice 019 — slim skill files to references) to keep SKILL.md under the 800-line cap from `common/coding-style.md`. The content below is the verbatim Frontend-only development mode section that was previously inline; nothing was paraphrased, just relocated.
>
> **2026-09-12 (`rd-routing-by-integration-mode`):** this file is now the routing home for all three integration modes, not just `prd-only`. `### Integration-mode routing (RD)` was added and the boolean-era text in `### Mode determination` was retargeted onto `.integrationMode`; the mock table and placeholder layout below belong to `prd-only`.

`peaks scan archetype --json` classifies every project into exactly one of three integration modes (`.integrationMode`). Code and RD both branch on that value — the `frontendOnly` boolean is retained for back-compat only (the swarm plan still reads it) and is no longer a routing decision.

### Mode determination (deterministic — CLI is the source of truth)

Read `.integrationMode` and `.integrationModeReason` from the `peaks scan archetype --json` output and copy both into `.peaks/project-scan/project-scan.md` under `## Project mode`. Copy `frontendOnly` / `frontendOnlyReason` alongside them under `## Project mode`, labelled back-compat. Do NOT re-derive the decision from user phrasing — the three values are already deterministic:

| `.integrationMode` | `.integrationModeReason` | What is physically present |
|---|---|---|
| `full-stack` | `backend-detected` | a backend framework, Next API routes, or a backend dir in this repo |
| `prd-plus-interface-doc` | `interface-doc-present` | an OpenAPI / proto document, and no backend here |
| `prd-only` | `no-backend-no-interface-doc` | neither |

A 0-1 bootstrap stub writes `unknown`; treat that as "not yet scanned", not as a fourth mode.

Back-compat mapping: `frontendOnly=false` covers `full-stack` **and** `prd-plus-interface-doc`; `frontendOnly=true` covers `prd-only`. That is why the boolean cannot route work — it merges two modes that need different procedures.

User-stated intent is **only** consulted when it conflicts with the CLI result. The two conflict cases:

- **CLI says `full-stack` but the user says "前端项目 / 没有后端 / 先 mock 数据"**: STOP and `AskUserQuestion` to confirm whether to override the scan (the repo probably contains a backend folder the user wants to ignore). Record the override decision and reason in `.peaks/project-scan/project-scan.md` under `## Project mode`.
- **CLI says `prd-only` but the user says "需要做后端 / 加 API"**: STOP and `AskUserQuestion` to confirm whether the request actually targets the missing backend (the user may be confused about repo scope, or there is a separate backend repo Code should switch to).

When there is no conflict, do not ask — the CLI value wins and the workflow proceeds.

### Integration-mode routing (RD) — three procedures

RD reads `.integrationMode` from `## Project mode` in `.peaks/project-scan/project-scan.md` and follows exactly one of the procedures below. Each mode has a different first command, a different contract source, and a different artifact; running one mode's steps under another mode is the collapse this routing exists to prevent.

#### `full-stack` — the backend is in this repo

1. **First:** read `## API` in `.peaks/project-scan/project-scan.md`. A real request wrapper, error shape, and endpoint inventory exist here — take them from the scan instead of re-deriving them by reading every service file.
2. If `.detected.swaggerPaths` from `peaks scan archetype --json` is non-empty, run `peaks scan api-diff <that path> --project <repo>` **before** editing any `*-api.types.ts`, and start from its `Exact` section.
3. **Boundary:** the DTO is the backend's own response type, imported at exactly one site per domain — the mapper path recorded under `## API → DTO ↔ ViewModel boundary` (`frontend-acl-mapper.md` rule 3: one mapper file per domain, reference shape `src/mappers/user.mapper.ts`). The internal ViewModel file it targets is the one recorded in that same `## API` row (reference shape `src/models/<domain>.ts`).
4. **Produces:** that mapper file, and the `## Red-line scope` section of `.peaks/_runtime/<sessionId>/rd/requests/<rid>.md` naming the in-scope endpoints. Close with `peaks scan diff-vs-scope --rid <rid> --project <repo>` (Gate B8).
5. **MUST NOT** mock. There is no missing contract to guess, so no `mock-plan.md` entry and no `mock/*.ts` file is written. This is not honour-system: an inline mock literal in a changed file under `src/` fails `rl-mock-placement-001` (`src/services/audit/enforcers/mock-placement.ts`).

#### `prd-plus-interface-doc` — a document exists, no backend here

1. **First:** `peaks scan api-diff <doc> --project <repo>`, where `<doc>` is a path from `.detected.swaggerPaths`. Run it **before any type is written** — the whole point of this mode is that the recorded interfaces start from the document rather than from a guess. The `Exact` section is the change list; it is exact because both sides are parsed.
2. Write or refresh `src/services/types/<feature>-api.types.ts` — one interface per endpoint the `Exact` section names. Every field must trace to a line of the document.
3. **Boundary:** the mapper imports its DTO from the doc-derived `*-api.types.ts` and its ViewModel from the internal model file recorded under `## API → DTO ↔ ViewModel boundary`. The mapper is what absorbs a doc revision: after the document changes, re-run step 1 and the mapper file appears in the `Candidate mentions` section as the place to edit.
4. **Produces:** the doc-derived `*-api.types.ts`, the mapper, and the `api-diff` `Exact` output pasted into `.peaks/_runtime/<sessionId>/rd/requests/<rid>.md`.
5. **MUST NOT** author a DTO from memory — that is `prd-only`'s guess, and here it would silently shadow the document. **MUST NOT** treat the `Candidate mentions` section as exact: it is a name-grep over the consumer's source, so it over-reports test fixtures and under-reports i18n keys, AntD `columns` arrays, `data-field` attributes, and monorepo barrels.
6. **Not checkable in this repo:** nothing detects doc↔server drift. `api-diff` compares the document against what the project recorded; if the document itself is stale, the interfaces compile clean and the UI renders `undefined`. `api-diff` prints this limitation in its own output footer — do not restate it as covered.

#### `prd-only` — no backend, no document

1. **First:** pick a row of the mock-strategy table below from the project's data-fetching pattern in `## API`, then write `.peaks/_runtime/<sessionId>/rd/mock-plan.md` **before producing any mock file** — chosen strategy, planned file paths, one-line rationale per file (`mock-plan.md` is the source of truth for mock locations across runs; RD reads it before writing code and QA reads it before writing test cases). If the table's last row applies ("cannot decide from scan alone"), STOP and `AskUserQuestion`.
2. Define the response interfaces first: `src/services/types/<feature>-api.types.ts`, per the placeholder layout below. These interfaces are an **authored guess** — mark them as such in the file header.
3. **Boundary:** write the mapper against the *interface*, never against the mock module. That is what keeps the guess cheap: when the real document lands, the mock file is deleted and the mapper's import target changes — no component, hook, or store is touched.
4. **Produces:** `mock-plan.md`, the `*-api.types.ts` interfaces, `mock/<feature>-mock.ts`, and the mapper.
5. **MUST NOT** write mock data inline in a component file — mock files live in the mock directory, and an inline mock literal in a changed file under `src/` fails `rl-mock-placement-001`. Every mock file carries the `// MOCK: Replace with real API call when swagger.json is available` header (mock rule 4 below).
6. **Exit path:** when a document appears, run `peaks scan api-diff <doc> --project <repo>` and follow §"Mock-to-real migration path" below. **Not checkable in this repo:** nothing detects "a real document now exists for this domain" automatically, and the conditional contract artifact (`.peaks/api-contract.json` with staleness detection, design spec §2.6 / S3) is **not built**. Until it is, step 1 of the migration is a run RD schedules manually.

### Mock data strategy selection

This table belongs to `prd-only`. Under `full-stack` and `prd-plus-interface-doc` a real contract source exists (the backend type, or the document), so no mock is written. Under `prd-only`, Code records the chosen strategy in `.peaks/_runtime/<sessionId>/rd/mock-plan.md` under a `## Mock Data Strategy` section — the same file mock rule 5 below requires before any mock file is produced. The choice depends on the project scan results:

| Project data-fetching pattern | Recommended mock approach | Rationale |
|---|---|---|
| Umi + `umi-request` / `@umijs/plugins` request | Umi mock directory (`mock/*.ts`) | Built-in, zero-config, auto-reload on file change |
| `@tanstack/react-query` + custom fetcher | Service-layer mock with `Promise.resolve()` stubs in the service file | Keeps query hooks unchanged; swap fetcher target later |
| `ahooks` `useRequest` + service functions | Service-layer mock: replace HTTP call with `Promise.resolve(mockData)` | Matches existing service-function pattern |
| MSW (Mock Service Worker) already configured | Add new handlers to existing MSW setup | Consistent with project convention |
| No existing pattern (greenfield) | Service-layer mock with a `mock/` directory and typed fixture files | Clean separation, easy to delete later |
| Existing `src/services/*` but no fetcher abstraction | Inline mock inside the service file; preserve the function signature | Keeps existing call-sites unchanged |
| Mixed data-fetching styles (e.g. react-query + raw fetch in legacy files) | Match the style of the most recently added code in the same module | Avoid introducing a third style |
| Cannot decide from scan alone | STOP and `AskUserQuestion` | Asking once beats picking differently on every run |

**Mock data rules:**

1. Every mock response must match the shape of the expected real API response. Define a TypeScript interface for the response type first, then create mock data that satisfies it.
2. Mock data should be realistic (not `"test"`, `"foo"`, `123`) — use plausible Chinese/English content that resembles production data.
3. Each mock must export its TypeScript interface so RD implementation and QA test-cases can import the same types.
4. Mark every mock file with a header comment: `// MOCK: Replace with real API call when swagger.json is available`.
5. Before producing any mock file, register the plan in `.peaks/_runtime/<sessionId>/rd/mock-plan.md` with: chosen strategy (from the table above), planned file paths, and a one-line rationale per file. This file is the source of truth for mock locations across runs — RD must read it before writing code, QA must read it before writing test cases.

### API contract placeholder pattern

When no swagger.json exists, RD defines API contracts as TypeScript interfaces with a mock-then-real service layer:

```
src/services/types/<feature>-api.types.ts   ← API request/response interfaces
src/services/<feature>-service.ts          ← Service functions (mock → real)
mock/<feature>-mock.ts                     ← Mock data satisfying interfaces
```

Each service function returns a typed mock response marked with `// MOCK: Replace with real API call when swagger.json is available`.

### Mock-to-real migration path

When swagger.json becomes available later, the migration follows this sequence:

1. Generate typed API client from swagger.json (e.g. via `openapi-typescript` or manual mapping).
2. Replace mock imports with generated API calls, one service file at a time.
3. Remove corresponding mock files.
4. Run QA regression to verify the real API responses match the mock interface contracts.

Code records the migration readiness in the TXT handoff capsule under a `## API Migration` section listing: mock file paths, the corresponding swagger endpoints (when known), and the migration status for each.

### Feishu document access fallback

When the PRD source is a Feishu/Lark document that requires authentication:

1. **Primary path**: Playwright MCP headed browser → user completes login → Code reads document content via `browser_snapshot`.
2. **Fallback A (user cannot login)**: Ask user to copy-paste the document content or export as Markdown/PDF. Code creates the PRD artifact from the pasted content.
3. **Fallback B (user provides export)**: User drops a `.md` or `.pdf` export into `.peaks/_runtime/<sessionId>/prd/source/`. Code reads and processes it.
4. **Fallback C (none of the above)**: Mark PRD as `blocked` with reason `doc-inaccessible`, list the exact next steps for the user, and pause the workflow.

Never silently fall back to unauthenticated `fetch` or `WebFetch` for authenticated documents.

---

### Frontend-only trigger pre-flight

> Body of `### Frontend-only trigger pre-flight`. Before computing the swarm plan, Code runs the keyword scan deterministically:

1. Read `.peaks/_runtime/<sessionId>/prd/requests/<rid>.md` body.
2. Lowercase + strip markdown; check regex `\b(页面|组件|表单|弹窗|表格|样式|布局|交互|UI|UX|page|component|form|modal|table|styling|layout|interaction|frontend|前端)\b`.
3. If match count ≥ 1 → `frontendKeywordHit=true`.
4. If `frontendOnly` (back-compat boolean from `## Project mode` in project-scan — the UI-inclusion signal only; it is not the integration-mode router) is `true` and no keyword hit → UI joins anyway (frontend-only project, even non-visual changes may need visual sanity for regressions).
5. If `frontendOnly` is `false` and no keyword hit → UI skipped.

Code records the pre-flight result in `sc/swarm-plan.json` so the audit trail shows why UI was or was not included.
