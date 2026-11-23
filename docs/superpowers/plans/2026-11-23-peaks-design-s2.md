# peaks design — S2 Implementation Plan (render engine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the designlang render engine to `peaks design check`: a hard dependency with an explicit availability gate, dynamic render URL resolution, designlang command wrappers with positive evidence, and the G2 check matrix — never a pass when the engine did not run.

**Architecture:** A new `src/services/design/engine-status.ts` resolves the installed designlang and a browser; `render-url.ts` + `render-server.ts` resolve and optionally start the app; `designlang.ts` wraps the CLI (`drift`, `verify-ui`, `slop`, `grade`) with JSON evidence and `process.execPath` spawning; `design-check.ts` gains `checkDesign`, which runs G1 + G2 and returns `pass | fail | blocked | not-adopted | not-applicable`. The CLI `design check` calls it; `--source-only` remains the diagnostic and `--allow-source-only --accept-note` the only acceptance path.

**Tech Stack:** TypeScript ESM (`process.execPath`, `child_process.spawn` with `shell:false`), Node ≥24, designlang 13.4.1 (hard dependency, already added by the spike), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-peaks-design-governance-design.md` (§4, §7.1, §7.3, §12 S2)

## Spike findings (t1, complete)

- `designlang@13.4.1` is a hard dependency (`dependencies`), entry `bin/design-extract.js`; bundled playwright 1.65.1.
- Command surfaces: root `designlang <url>` (extract), `drift <url> --tokens <file>`, `verify-ui <url> --brand <file>`, `slop <url>`, `grade <url>`.
- JSON: `extract`, `drift`, `verify-ui`, `slop` support `--json`; `grade` exposes JSON only as a written `<prefix>.grade.json` (`--format json`).
- Screenshots: the extract root supports `--screenshots` / `--responsive-shots` / `--full`; no separate screenshot command.
- Browser: bundled Chromium is **not installed**; a system-Chrome fallback works on this host. `designlang doctor` exits 9 and crashes on Node 24 teardown — do not use it as the browser probe.
- Exit codes: 0 OK; 1 drift or grade error; 2 extraction/navigation failure; 3 navigation timeout.
- `extract --json` writes no files; the token bundle and JSON are mutually exclusive in one call.

## Global Constraints

- **Never pass without evidence.** Engine, browser, URL, or a positive designlang artifact missing → `blocked`, never `pass`.
- `designlang` is a hard `dependencies` entry (spike added it). Do not move it to optional.
- Do not run `designlang install-browser` or download a browser. Report the exact hint instead.
- Do not use designlang's MCP server, plugin, or skill. Spawn its CLI only, with `process.execPath` + the resolved entry, `shell:false`, and a timeout.
- URL trust: loopback + an explicitly recorded URL only; no cookie/header passthrough; untrusted → `blocked`.
- `--source-only` is a diagnostic that cannot pass; `--allow-source-only --accept-note` is the only acceptance path (and still requires an interactive session).
- `--gate` is S3; do not register it.
- `slop` / `grade` are advisory in S2 (warn), not fail. `drift` / `verify-ui` nonzero → fail.
- BDD triple as the first three consecutive comments; `.js` specifiers; prettier; eslint 0 on touched files; new source files join `.peaks/lint/gate-baseline.json` after a normal (or `--rescope` for a deletion) regeneration.
- Stage only in the RD tasks; the orchestrator commits after QA (the S1 lesson: no per-slice commit gate workarounds).

## Review Focus

- **Browser absent:** a machine with designlang installed but no Chromium/system Chrome must be `blocked`, not a `pass`; Task 1 pins this.
- **Exit 0, no evidence:** a designlang that prints nothing or a non-JSON line must block (`DESIGN_RENDER_NO_EVIDENCE`), not pass; Task 3 pins it.
- **Untrusted URL:** a private-network or lookalike host must block before spawning; Task 2 pins it.
- **Orphan server:** `--start` must reap the process tree on success, failure, and timeout; Task 2 pins it with a temp server.
- **Source-only alias:** `--source-only` must never produce a pass; only `--allow-source-only --accept-note` does; Task 4 pins it.

---

### Task 1: Engine availability (t2)

**Files:**
- Create: `src/services/design/engine-status.ts`
- Test: `tests/unit/design/engine-status.test.ts`

**Interfaces:**
- Produces: `EngineUnavailableCode = 'DESIGN_ENGINE_UNAVAILABLE' | 'DESIGN_ENGINE_VERSION_UNSUPPORTED' | 'DESIGN_BROWSER_UNAVAILABLE'`; `EngineAvailability = { available: boolean; version: string | null; entryPath: string | null; browserReady: boolean; browserKind: 'bundled' | 'system-chrome' | null; codes: EngineUnavailableCode[] }`; `evaluateEngine(input): EngineAvailability`; `resolveEngine(): EngineAvailability`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/design/engine-status.test.ts
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { evaluateEngine } from '../../../src/services/design/engine-status.js';

declareDimensions('tests/unit/design/engine-status.test.ts', ['behavior', 'integration', 'render', 'a11y']);

describe('Scenario: behavior — the engine availability gate', () => {
  it('when the package and entry resolve and a browser exists, should be available', () => {
    // given: a resolved entry, a supported major, and a system chrome
    // when: the gate evaluates
    const result = evaluateEngine({ entryPath: '/x/design-extract.js', version: '13.4.1', browserKind: 'system-chrome', supportedMajor: 13 });
    // then: it is available with no codes
    expect(result.available).toBe(true);
    expect(result.codes).toEqual([]);
  });

  it('when the package or entry does not resolve, should report DESIGN_ENGINE_UNAVAILABLE', () => {
    // given: no entry path
    // when: the gate evaluates
    const result = evaluateEngine({ entryPath: null, version: null, browserKind: 'system-chrome' });
    // then: it is unavailable for the engine reason
    expect(result.available).toBe(false);
    expect(result.codes).toContain('DESIGN_ENGINE_UNAVAILABLE');
  });

  it('when the major is past the supported range, should report DESIGN_ENGINE_VERSION_UNSUPPORTED', () => {
    // given: a version from another major
    // when: the gate evaluates
    const result = evaluateEngine({ entryPath: '/x/design-extract.js', version: '14.0.0', browserKind: 'system-chrome', supportedMajor: 13 });
    // then: the version gate refuses it
    expect(result.available).toBe(false);
    expect(result.codes).toContain('DESIGN_ENGINE_VERSION_UNSUPPORTED');
  });

  it('when no browser is present, should report DESIGN_BROWSER_UNAVAILABLE and never be available', () => {
    // given: a resolved engine but no bundled or system browser
    // when: the gate evaluates
    const result = evaluateEngine({ entryPath: '/x/design-extract.js', version: '13.4.1', browserKind: null });
    // then: it is not available and names the browser
    expect(result.available).toBe(false);
    expect(result.codes).toContain('DESIGN_BROWSER_UNAVAILABLE');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/engine-status.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the pure evaluator and the thin resolvers**

- `evaluateEngine` is pure: available only when entryPath is non-null, the major of `version` equals `supportedMajor` (default 13), and `browserKind` is non-null; otherwise push each failing code in that order.
- `resolveEngine`: resolve `designlang/package.json` with `createRequire(import.meta.url)`, read `bin` and `version`, resolve the entry to an absolute path, then `detectBrowser()`.
- `detectBrowser`: bundled = a `chromium-*` directory under the platform playwright cache (`~/.cache/ms-playwright` on POSIX, `%LOCALAPPDATA%\\ms-playwright` on Windows); system = the well-known Chrome paths per platform, plus `google-chrome` / `chromium` / `chromium-browser` on PATH. Return `'bundled' | 'system-chrome' | null`. Do **not** call `designlang doctor`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/engine-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit? No — stage only.** `git add src/services/design/engine-status.ts tests/unit/design/engine-status.test.ts`.

---

### Task 2: Render URL resolution and `--start` lifecycle (t3)

**Files:**
- Create: `src/services/design/render-url.ts`
- Create: `src/services/design/render-server.ts`
- Test: `tests/unit/design/render-url.test.ts`
- Test: `tests/unit/design/render-server.test.ts`

**Interfaces:**
- Produces: `RenderUrlResult = { ok: true; url: string; source: 'flag' | 'env' | 'engine' | 'derived' } | { ok: false; code: 'DESIGN_RENDER_URL_MISSING' | 'DESIGN_URL_UNTRUSTED'; message: string }`; `resolveRenderUrl(input): RenderUrlResult`; `probeRenderUrl(url, timeoutMs?): Promise<boolean>`; `startRenderServer(input): Promise<{ ok: true; server: { url: string; stop(): Promise<void> } } | { ok: false; code: string; message: string }>`.

- [ ] **Step 1: Write the failing tests**

`render-url.test.ts`:
1. `explicitUrl` wins over env and engine.
2. `PEAKS_DESIGN_URL` wins over engine.
3. `engine.render.url` is used when non-null and trusted.
4. absent all → derived `http://127.0.0.1:<port><path>` from `engine.render`.
5. a private/lookalike host is refused with `DESIGN_URL_UNTRUSTED`.
6. no URL and no port → `DESIGN_RENDER_URL_MISSING`.
7. `probeRenderUrl` is true for a local temp server and false for a closed port.

`render-server.test.ts`:
1. start a `node -e` HTTP server command, wait for readiness, call `stop()`, and assert the port is closed and the child is gone.
2. a command that never listens returns `ok:false` with a code after the timeout and leaves no child.
3. a command that exits immediately returns `ok:false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/render-url.test.ts tests/unit/design/render-server.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the resolver and server**

- `resolveRenderUrl`: order flag > env > engine.render.url > derived; every candidate goes through `isTrustedDesignUrl(candidate, engine)`; derived uses `http://127.0.0.1:${port}${path}` with `path` default `/`. Store the chosen source.
- `probeRenderUrl`: `fetch` with an `AbortController` timeout; any HTTP response is `true`; a network error/timeout is `false`.
- `startRenderServer`: `spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', windowsHide: true })`; poll `probeRenderUrl` until the timeout; `stop()` kills the process tree (`taskkill /T /F` on Windows, `process.kill(-pid, 'SIGTERM')` then `SIGKILL` on POSIX) and waits for exit. On timeout/exited, kill and return `ok:false` with `DESIGN_RENDER_UNREACHABLE` / `DESIGN_START_COMMAND_EXITED`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the same command. Expected: PASS.

- [ ] **Step 5: Stage only.**

---

### Task 3: designlang wrappers and positive evidence (t4)

**Files:**
- Create: `src/services/design/designlang.ts`
- Test: `tests/unit/design/designlang.test.ts`

**Interfaces:**
- Produces: `DesignlangRunResult = { exitCode: number; stdout: string; stderr: string; timedOut: boolean }`; `runDesignlang(input: { entryPath: string; args: readonly string[]; timeoutMs?: number }): Promise<DesignlangRunResult>`; `DesignlangCheckKind = 'drift' | 'verify-ui' | 'slop' | 'grade'`; `buildDesignlangArgs(input): string[]`; `parseDesignlangEvidence(input): { ok: true; pages: number; raw: unknown } | { ok: false; code: 'DESIGN_RENDER_NO_EVIDENCE'; message: string }`.

- [ ] **Step 1: Write the failing tests**

1. `buildDesignlangArgs` for drift: `['drift', url, '--tokens', tokensPath, '--json']`.
2. verify-ui: `['verify-ui', url, '--brand', brandPath, '--json']`.
3. slop: `['slop', url, '--json']` (add `--brand` only when supplied).
4. grade: `['grade', url, '--format', 'json', '--out', outDir]`.
5. `runDesignlang` with a temp `.mjs` entry that prints `{"url":"x","generatedAt":"..."}` and exits 0 → exitCode 0 and stdout captured.
6. an entry that exits 1 → exitCode 1.
7. an entry that hangs → `timedOut: true` and the child is killed.
8. `parseDesignlangEvidence('drift', '{"url":"x"}')` → ok; `parseDesignlangEvidence('drift', '')` → `DESIGN_RENDER_NO_EVIDENCE`; `'not json'` → no evidence.
9. a JSON object with no keys → no evidence.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/design/designlang.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the wrappers**

- `buildDesignlangArgs` returns the exact arrays above; the page URL is the first positional.
- `runDesignlang`: `spawn(process.execPath, [entryPath, ...args], { shell: false, windowsHide: true })`; collect stdout/stderr; a `setTimeout` kills the child and marks `timedOut`.
- `parseDesignlangEvidence`: `JSON.parse(stdout.trim())`; if it fails, try the last balanced `{...}` block; accept only a non-empty object; `pages = Array.isArray(raw.pages) ? raw.pages.length : 1`. Grade reads the newest `*.grade.json` in the out dir (the caller passes the file contents or the adapter reads it — keep the parser pure and add `readGradeEvidence(outDir): Promise<unknown>`).
- For `grade`, the adapter reads `*.grade.json` after a 0 exit; no file → no evidence.

- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS.

- [ ] **Step 5: Stage only.**

---

### Task 4: G2 check matrix and CLI wiring (t5)

**Files:**
- Modify: `src/services/design/design-check.ts`
- Modify: `src/cli/commands/design-commands.ts`
- Test: `tests/unit/design/design-check-g2.test.ts`
- Modify: `tests/unit/cli/design-commands.test.ts`

**Interfaces:**
- Produces: `DesignEngineDeps = { availability: EngineAvailability; resolveUrl(): RenderUrlResult; probe(url: string): Promise<boolean>; startServer?(): Promise<...>; run(kind, input): Promise<DesignlangRunResult> }`; `checkDesign(input: CheckDesignInput, deps?: DesignEngineDeps): Promise<DesignCheckResult>` where `CheckDesignInput` extends the S1 input with `url?`, `pages?`, `start?`.
- `DesignCheckResult.checks.g2_render` becomes a union: `{status:'pass'; pages:number; evidence:string[]}` | `{status:'fail'; reason:string}` | `{status:'blocked'; code:string}` | `{status:'skipped'; reason:'explicitly-accepted'|'source-only'}`.

- [ ] **Step 1: Write the failing tests**

`design-check-g2.test.ts` with an injected `DesignEngineDeps`:
1. engine unavailable → `blocked` / `DESIGN_ENGINE_UNAVAILABLE`.
2. resolveUrl false missing → `blocked` / `DESIGN_RENDER_URL_MISSING`.
3. resolveUrl false untrusted → `blocked` / `DESIGN_URL_UNTRUSTED`.
4. probe false → `blocked` / `DESIGN_RENDER_UNREACHABLE`.
5. drift exit 1 → `fail`.
6. verify-ui exit 2 → `fail`.
7. slop exit 1 → still `pass` (advisory) with a warning.
8. drift exit 0 + JSON → `pass`; exit 0 + no JSON → `blocked` / `DESIGN_RENDER_NO_EVIDENCE`.
9. `--source-only` → `skipped(source-only)` and never `pass`.
10. `--allow-source-only --accept-note` → `pass` with `g2_render.skipped(explicitly-accepted)` (the S1 path still wins).
11. `--start` with no `startCommand` → `blocked` / `DESIGN_START_COMMAND_MISSING`.

CLI test: `design check --help` lists `--url`, `--pages`, `--start`; a check run no longer warns "S1 has no render engine"; `--source-only` still warns and cannot pass.

- [ ] **Step 2: Run the tests to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement the matrix**

- `checkDesign` keeps the S1 order (root → not-adopted → change set → surface → G1) and adds G2 after G1: if `allowSourceOnly`/`sourceOnly`, return the S1 path; otherwise resolve the engine (or use deps), resolve the URL, probe (or start), run `drift` and `verify-ui` per page, then `slop` (advisory) and `grade` (advisory, optional). Any nonzero drift/verify-ui → fail; missing evidence → blocked; all clean → pass.
- `design-commands.ts`: `design check` calls `checkDesign`; `--url`, `--pages`, `--start` are wired; remove the S1 "unused" warnings; `--source-only` sets the diagnostic; `--allow-source-only` keeps the acceptance guard.
- `--gate` still absent.

- [ ] **Step 4: Run the tests to verify they pass.** Expected: PASS.

- [ ] **Step 5: Stage only.**

---

### Task 5: Fixtures, full matrix, baseline, and docs (t6)

**Files:**
- Create: `tests/unit/design/_fake-designlang.ts` (a temp `.mjs` writer + a `DesignEngineDeps` factory)
- Modify: `tests/unit/design/design-check-g2.test.ts` (use the factory)
- Modify: `docs/superpowers/plans/2026-11-23-peaks-design-s2.md` (record the spike facts and the final interfaces)
- Regenerate: `.peaks/lint/gate-baseline.json`

- [ ] **Step 1: Add the fake-engine fixture and the remaining matrix tests**

The fixture writes a temp `.mjs` that prints a chosen JSON / exits a chosen code / sleeps, and a `fakeEngine(overrides)` that returns the `DesignEngineDeps`. Add the cases the earlier tasks did not cover: two pages (one passes, one fails), a grade file present/absent, a start-server stop reaping, and the full result shape.

- [ ] **Step 2: Run the design + CLI + guard suites**

Run: `npx vitest run --config vitest.config.ts tests/unit/design tests/unit/cli/design-commands.test.ts tests/unit/standards/file-size-cap.test.ts tests/unit/standards/scope-shadow-coverage.test.ts tests/unit/lint/silent-warning-scope-leg.test.ts tests/unit/standards/bdd-test-style-ratchet.test.ts`
Expected: PASS.

- [ ] **Step 3: Regenerate the baseline**

Run: `node .husky/peaks-gate-baseline.mjs` (or `--rescope` if a file was deleted). Confirm the diff moves no ceiling up; then re-run the four guards.

- [ ] **Step 4: Run the full unit suite and tsc**

Run: `npx vitest run --config vitest.config.ts tests/unit` and `npx tsc -p tsconfig.json --noEmit`.
Expected: 0 failures / 0 diagnostics.

- [ ] **Step 5: Stage only, then hand off to QA**

Do not commit. The orchestrator runs QA, then commits once with the full contract (the S1 lesson).

---

## Self-Review Notes

- **Spike coverage:** the plan uses the measured CLI surfaces; it does not depend on `designlang doctor` (crashes on Node 24) and does not assume bundled Chromium.
- **Spec coverage:** engine availability, dynamic URL, positive evidence, G2 matrix, and the `--start` opt-in are each a task. `--gate` and G3 stay out of S2 by design.
- **Known unknown:** the exact JSON schema of `drift` / `verify-ui` / `slop` is not captured by the spike (no browser). The parser treats it as opaque non-empty evidence; if the real shape differs, the adapter records the raw JSON and the QA can tighten it without changing the verdict logic.
- **S1 boundary:** `checkDesignSourceOnly` stays; `checkDesign` adds G2. `--allow-source-only` keeps the S1 acceptance path.

---

## Final interfaces (recorded by Task 5)

The implementation kept the Task 1–4 contracts and added the names below. Anything not listed matches its task block verbatim.

- **Task 1 (`engine-status.ts`)** — the evaluator's input is the named `EngineEvaluationInput`; `BrowserKind` and `detectBrowser()` are exported for the availability tests.
- **Task 2 (`render-url.ts`, `render-server.ts`)** — inputs are named `ResolveRenderUrlInput` / `StartRenderServerInput`; results are `RenderUrlResult` (with `RenderUrlSource`), `StartRenderServerResult` (with `StartRenderServerCode`), and `RenderServerHandle`; `DESIGN_URL_ENV_KEY` names the env var. `probeRenderUrl(url, timeoutMs = 2000)`.
- **Task 3 (`designlang.ts`)** — inputs are named `DesignlangRunInput`, `BuildDesignlangArgsInput`, `ParseDesignlangEvidenceInput`; evidence is `DesignlangEvidence`; `DEFAULT_RUN_TIMEOUT_MS` is exported and `readGradeEvidence(outDir)` reads the newest `*.grade.json`.
- **Task 4 (`design-check-g2.ts`, `design-check.ts`)** — `DesignEngineDeps.run(kind, input)` takes `DesignEngineRunInput = { args: readonly string[] }`, and the deps gain an optional `readGrade?: (outDir) => Promise<DesignlangEvidence>` so the advisory grade is injectable. The `g2_render` skipped union keeps the S1 early-result value: `'explicitly-accepted' | 'source-only' | 's2-not-implemented'` (the last is only the pre-G2 default and never a `checkDesign` outcome). `CheckDesignInput` also carries `sourceOnly?: boolean`. The G2 entry points are `evaluateG2` (the matrix) and `completeG2` (contract-root + deps wiring), with `G2Outcome` as the intermediate result.
- **Task 5 fixtures** — `tests/unit/design/_fake-designlang.ts` exports `fakeEngine(overrides)`, `writeFakeScript(name, { stdout, stderr, exitCode, sleepMs })`, `fakeStartServer(url)`, `createAdoptedApp()`, `setStartCommand(root, command)`, `runResult`, `isAlive`, `waitUntil`, and `disposeFixtures()`.
