# Mock data placement rules

> Body of `## Mock data placement rules` + `### Framework-to-mock-directory mapping` + `### Hard rules` + `### Verification gate`. **BLOCKING — framework-aware.**

When the project-scan in `.peaks/_runtime/<sessionId>/rd/project-scan.md` identifies a frontend framework, mock data MUST follow the framework's built-in mock mechanism. **Never write mock data inline in component files.**

## Framework-to-mock-directory mapping

| Project-scan finding | Mock location | Notes |
|---|---|---|
| Umi (`@umijs/max`, `.umirc.ts`) | `mock/*.ts` | Umi's built-in mock directory. Zero config, auto-reload. |
| Next.js (`next.config.*`) | `__mocks__/` or MSW handlers | Match the project's existing pattern |
| Vite (`vite.config.*`) | `src/mock/` | Service-layer mock files with typed fixtures |
| CRA / Webpack | `src/__mocks__/` | Match the project's existing pattern |

## Hard rules

1. **Umi project → `mock/*.ts`**: If the project-scan says the build tool is Umi, mock data MUST go in the `mock/` directory at project root. This is Umi's built-in feature — it intercepts requests matching the defined path and method. Do NOT write `Promise.resolve(mockData)` in component files or service files for Umi projects.

2. **Never inline mock data in component files**: Mock data, fixture objects, and stub responses belong in dedicated mock files. Components should receive data through their normal channels (props, API calls via services). Writing `const mockData = [...]` inside a `.tsx` file is prohibited.

3. **Mock files must export TypeScript interfaces**: Every mock response type must be exported so RD implementation and QA test-cases can import the same contract. See peaks-code's "Frontend-only development mode" for the full mock-to-real migration pattern.

4. **Every mock file must be marked**: Add `// MOCK: Replace with real API call when swagger.json is available` at the top of every mock file.

5. **Mock data must be realistic**: No `"test"`, `"foo"`, `"123"` values. Use plausible content that resembles production data.

## Verification gate (after mock creation)

```bash
# If project-scan detected Umi, verify mock/ directory was used
ls mock/*.ts 2>&1
# Expected: one or more .ts files in mock/
# "No such file" → BLOCKED. Umi projects must use mock/ directory.

# Verify no inline mock data in component files
grep -r "const mock\|mockData\|mock_data\|MOCK_DATA" src/ --include="*.tsx" --include="*.ts" -l 2>&1
# Expected: no matches (or only in dedicated mock files / test files)
# Any match in a component → BLOCKED. Move to mock/ (Umi) or src/mock/ (Vite).
```