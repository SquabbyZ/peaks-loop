# Peaks-Cli Frontend-only development mode

> Extracted from `skills/peaks-solo/SKILL.md` on 2026-06-09 (slice 019 — slim skill files to references) to keep SKILL.md under the 800-line cap from `common/coding-style.md`. The content below is the verbatim Frontend-only development mode section that was previously inline; nothing was paraphrased, just relocated.

When the project has no live backend (no swagger.json, no API server), Solo must activate frontend-only mode.

### Mode determination (deterministic — CLI is the source of truth)

The CLI decision is authoritative. Read `frontendOnly` and `frontendOnlyReason` directly from the `peaks scan archetype --json` output and copy both into `project-scan.md` under `## Project mode`. Do NOT re-derive the decision from user phrasing.

User-stated intent is **only** consulted when it conflicts with the CLI result. The two conflict cases:

- **CLI says `frontendOnly=false` but the user says "前端项目 / 没有后端 / 先 mock 数据"**: STOP and `AskUserQuestion` to confirm whether to override the scan (the repo probably contains a backend folder the user wants to ignore). Record the override decision and reason in `project-scan.md`.
- **CLI says `frontendOnly=true` but the user says "需要做后端 / 加 API"**: STOP and `AskUserQuestion` to confirm whether the request actually targets the missing backend (the user may be confused about repo scope, or there is a separate backend repo Solo should switch to).

When there is no conflict, do not ask — the CLI value wins and the workflow proceeds.

### Mock data strategy selection

Solo records the chosen mock strategy in `.peaks/_runtime/<sessionId>/rd/tech-doc.md` under a `## Mock Data Strategy` section. The choice depends on the project scan results:

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

Solo records the migration readiness in the TXT handoff capsule under a `## API Migration` section listing: mock file paths, the corresponding swagger endpoints (when known), and the migration status for each.

### Feishu document access fallback

When the PRD source is a Feishu/Lark document that requires authentication:

1. **Primary path**: Playwright MCP headed browser → user completes login → Solo reads document content via `browser_snapshot`.
2. **Fallback A (user cannot login)**: Ask user to copy-paste the document content or export as Markdown/PDF. Solo creates the PRD artifact from the pasted content.
3. **Fallback B (user provides export)**: User drops a `.md` or `.pdf` export into `.peaks/_runtime/<sessionId>/prd/source/`. Solo reads and processes it.
4. **Fallback C (none of the above)**: Mark PRD as `blocked` with reason `doc-inaccessible`, list the exact next steps for the user, and pause the workflow.

Never silently fall back to unauthenticated `fetch` or `WebFetch` for authenticated documents.
