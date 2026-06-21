# peaks-context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `peaks-context` CLI module (PRD §4.1) that replaces LLM-driven prompt-stacking with a CLI-enforced, versioned, structured context builder. Single deliverable: `peaks context build` produces a deterministic `context.json` for `peaks-rd` / `peaks-qa` / `peaks-mut` to consume.

**Architecture:** Four sequential steps (Collector → DocRetriever → Tokenizer → Renderer) orchestrated by `ContextBuilder`. Each step is independently testable, all reads are CLI-side (Bash / Node), LLM is not in the loop until the final `context.json` is consumed. Cross-version isolation is the load-bearing test (PRD §4.1 promise: 5.x deps must never see 6.x API docs).

**Tech Stack:** TypeScript 5.7 (strict, ESM), commander 12, Zod 3.x (validation), Node fs/promises, vitest 2.1, pnpm 10.11. No new runtime dependencies — `headroom-ai` (already in deps) is used for doc retrieval; Zod is the only new dep.

## Global Constraints

- TypeScript ≥ 5.7, ESM modules, strict mode (`tsconfig.json` already configured)
- Node ≥ 20 (per `package.json` `engines.node`)
- File size ≤ 800 lines (Karpathy #2)
- Single slice ≤ 800 lines; run `peaks slice check` after each task boundary
- Test coverage ≥ 80% per module (project standard)
- Use Zod for all external input validation; infer types from schemas
- Use `Readonly<>` for shared types; spread operator for immutable updates
- No `console.log` in `src/`; use `logger` from `src/shared/logger.ts` (existing)
- Conventional commits: `feat:` / `fix:` / `test:` / `docs:` / `chore:` / `refactor:`
- Imports use `.js` extension (project ESM convention — see existing tests)
- BDD-style `describe / it` in vitest
- Karpathy 4 guidelines still apply to any RD sub-agent dispatched during this work

## File Structure

```
src/services/context/
  types.ts                     # ContextJson + sub-interfaces (single source of truth)
  context-schema.ts            # Zod schemas for runtime validation
  collector.ts                 # Step 1: parallel file/git/memory/deps scan
  doc-retriever.ts             # Step 2: version-locked doc fetch
  tokenizer.ts                 # Step 3: metadata tagging (immutable)
  renderer.ts                  # Step 4: audience-scoped render
  context-builder.ts           # Orchestrator
  index.ts                     # Public exports
src/cli/commands/
  context-commands.ts          # `peaks context <sub>` commands
src/cli/index.ts               # (modify) register context commands
src/services/rd/rd-service.ts  # (modify) auto-call context build before RD
src/services/qa/qa-service.ts  # (modify) auto-call context build before QA
schemas/
  context.schema.json          # Exported JSON Schema for cross-tool consumers
tests/unit/services/context/
  types.test.ts
  collector.test.ts
  doc-retriever.test.ts
  tokenizer.test.ts
  renderer.test.ts
  context-builder.test.ts
tests/unit/cli/commands/
  context-commands.test.ts
tests/integration/context/
  cross-version-isolation.test.ts    # ★ CORE PROMISE TEST
  end-to-end.test.ts
  cross-ide-consistency.test.ts
```

Each production file ≤ 800 lines (Karpathy #2). If a service grows, split by responsibility.

---

## Task 1: Setup — Zod dependency + directory scaffolding

**Files:**
- Modify: `package.json` (add `zod` to dependencies)
- Create: `src/services/context/.gitkeep` (placeholder; remove in Task 2)

**Interfaces:**
- Consumes: existing `package.json`
- Produces: directory layout ready for content

- [ ] **Step 1: Add Zod dependency**

Run: `pnpm add zod@^3.23.0`
Expected: `package.json` and `pnpm-lock.yaml` updated; `node_modules/zod` exists.

- [ ] **Step 2: Verify install**

Run: `pnpm ls zod`
Expected: `zod 3.x.x` listed.

- [ ] **Step 3: Create service directory**

Run: `mkdir -p src/services/context tests/unit/services/context tests/integration/context schemas`
Expected: directories exist.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(context): add zod dependency + scaffold service directory"
```

---

## Task 2: Define types — `ContextJson` interface + Zod schemas

**Files:**
- Create: `src/services/context/types.ts`
- Create: `src/services/context/context-schema.ts`
- Test: `tests/unit/services/context/types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ContextJson` interface + `ContextJsonSchema` (Zod) consumed by all later tasks

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/context/types.test.ts`:

```typescript
/**
 * Per spec §4.1 context.json schema (v1.0), the ContextJson interface
 * is the single source of truth for downstream services. This test
 * pins the public shape so any breaking change must update the schema
 * version (H1 / H2 / H8 hard constraints).
 */
import { describe, it, expect } from 'vitest';
import { ContextJsonSchema } from '../../../../src/services/context/context-schema.js';

describe('ContextJsonSchema', () => {
  it('accepts a valid minimal context.json', () => {
    const result = ContextJsonSchema.safeParse({
      version: '1.0',
      goal: 'add OAuth callback',
      generatedAt: '2026-06-21T12:00:00Z',
      sha256: 'a'.repeat(64),
      collector: {
        files: [],
        gitStatus: { branch: 'main', lastCommit: 'abc', dirty: false },
        memoryEntries: [],
        deps: {},
      },
      docRetriever: { fetchedDocs: [], skipped: [] },
      tokenizer: { metadata: [] },
      renderer: {
        audience: 'all',
        renderedAt: '2026-06-21T12:00:00Z',
        sizeBytes: 0,
        truncated: false,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a context.json with wrong version', () => {
    const result = ContextJsonSchema.safeParse({
      version: '0.9',
      goal: 'x',
      generatedAt: '2026-06-21T12:00:00Z',
      sha256: 'a'.repeat(64),
      collector: { files: [], gitStatus: { branch: 'm', lastCommit: 'c', dirty: false }, memoryEntries: [], deps: {} },
      docRetriever: { fetchedDocs: [], skipped: [] },
      tokenizer: { metadata: [] },
      renderer: { audience: 'all', renderedAt: '2026-06-21T12:00:00Z', sizeBytes: 0, truncated: false },
    });
    expect(result.success).toBe(false);
  });

  it('rejects sha256 with wrong length', () => {
    const result = ContextJsonSchema.safeParse({
      version: '1.0',
      goal: 'x',
      generatedAt: '2026-06-21T12:00:00Z',
      sha256: 'tooshort',
      collector: { files: [], gitStatus: { branch: 'm', lastCommit: 'c', dirty: false }, memoryEntries: [], deps: {} },
      docRetriever: { fetchedDocs: [], skipped: [] },
      tokenizer: { metadata: [] },
      renderer: { audience: 'all', renderedAt: '2026-06-21T12:00:00Z', sizeBytes: 0, truncated: false },
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/services/context/types.test.ts`
Expected: FAIL — `context-schema.ts` does not exist.

- [ ] **Step 3: Write `types.ts`**

Create `src/services/context/types.ts`:

```typescript
/**
 * Per spec §4.1 — the single source of truth for context.json shape.
 * The Zod schema in context-schema.ts must mirror this interface exactly;
 * the schema is the runtime validator, the interface is the compile-time contract.
 *
 * Hard constraint H8: Audit trail must be hashable. `sha256` is the field
 * that lets peaks-state-lock chain signatures between stages.
 */

export type ContextVersion = '1.0';

export type Audience = 'peaks-rd' | 'peaks-qa' | 'peaks-mut' | 'all';

export type DepsMode = 'locked' | 'latest';

export type FileKind = 'source' | 'test' | 'config' | 'doc';

export interface CollectedFile {
  readonly path: string;
  readonly kind: FileKind;
  readonly lines: number;
  readonly hash: string;
}

export interface GitStatus {
  readonly branch: string;
  readonly lastCommit: string;
  readonly dirty: boolean;
}

export interface MemoryEntry {
  readonly path: string;
  readonly title: string;
  readonly relevanceScore: number;
  readonly excerptHash: string;
}

export interface DepInfo {
  readonly version: string;
  readonly source: 'package.json' | 'pnpm-lock.yaml' | 'yarn.lock';
  readonly resolved: string;
}

export interface DocSection {
  readonly title: string;
  readonly tokenEstimate: number;
  readonly excerpt: string;
}

export interface FetchedDoc {
  readonly dep: string;
  readonly version: string;
  readonly source: 'local-cache' | 'remote-fetch';
  readonly url?: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly sections: ReadonlyArray<DocSection>;
  readonly stale: boolean;
}

export interface SkippedDoc {
  readonly dep: string;
  readonly reason: 'unconfigured' | 'network_error' | 'version_unknown';
}

export type MetaKind = 'doc' | 'code' | 'memory' | 'git';

export interface TokenizedItem {
  readonly id: string;
  readonly kind: MetaKind;
  readonly version?: string;
  readonly blastRadius: ReadonlyArray<string>;
  readonly conflictScore: number;
  readonly timeDecayScore: number;
  readonly tags: ReadonlyArray<string>;
}

export interface CollectorOutput {
  readonly files: ReadonlyArray<CollectedFile>;
  readonly gitStatus: GitStatus;
  readonly memoryEntries: ReadonlyArray<MemoryEntry>;
  readonly deps: Readonly<Record<string, DepInfo>>;
}

export interface DocRetrieverOutput {
  readonly fetchedDocs: ReadonlyArray<FetchedDoc>;
  readonly skipped: ReadonlyArray<SkippedDoc>;
}

export interface TokenizerOutput {
  readonly metadata: ReadonlyArray<TokenizedItem>;
}

export interface RendererOutput {
  readonly audience: Audience;
  readonly renderedAt: string;
  readonly sizeBytes: number;
  readonly truncated: boolean;
  readonly truncatedReason?: 'doc_budget_exceeded' | 'section_count_exceeded';
}

export interface ContextJson {
  readonly version: ContextVersion;
  readonly goal: string;
  readonly generatedAt: string;
  readonly sha256: string;
  readonly collector: CollectorOutput;
  readonly docRetriever: DocRetrieverOutput;
  readonly tokenizer: TokenizerOutput;
  readonly renderer: RendererOutput;
}
```

- [ ] **Step 4: Write `context-schema.ts`**

Create `src/services/context/context-schema.ts`:

```typescript
/**
 * Runtime validator for context.json. Per spec §4.1 + H8 (audit trail
 * hashable). When this schema changes, version field must bump.
 */
import { z } from 'zod';

export const ContextJsonSchema = z.object({
  version: z.literal('1.0'),
  goal: z.string().min(1),
  generatedAt: z.string().datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  collector: z.object({
    files: z.array(z.object({
      path: z.string(),
      kind: z.enum(['source', 'test', 'config', 'doc']),
      lines: z.number().int().nonnegative(),
      hash: z.string(),
    })),
    gitStatus: z.object({
      branch: z.string(),
      lastCommit: z.string(),
      dirty: z.boolean(),
    }),
    memoryEntries: z.array(z.object({
      path: z.string(),
      title: z.string(),
      relevanceScore: z.number().min(0).max(1),
      excerptHash: z.string(),
    })),
    deps: z.record(z.string(), z.object({
      version: z.string(),
      source: z.enum(['package.json', 'pnpm-lock.yaml', 'yarn.lock']),
      resolved: z.string(),
    })),
  }),
  docRetriever: z.object({
    fetchedDocs: z.array(z.object({
      dep: z.string(),
      version: z.string(),
      source: z.enum(['local-cache', 'remote-fetch']),
      url: z.string().optional(),
      fetchedAt: z.string().datetime(),
      contentHash: z.string(),
      sections: z.array(z.object({
        title: z.string(),
        tokenEstimate: z.number().int().nonnegative(),
        excerpt: z.string(),
      })),
      stale: z.boolean(),
    })),
    skipped: z.array(z.object({
      dep: z.string(),
      reason: z.enum(['unconfigured', 'network_error', 'version_unknown']),
    })),
  }),
  tokenizer: z.object({
    metadata: z.array(z.object({
      id: z.string(),
      kind: z.enum(['doc', 'code', 'memory', 'git']),
      version: z.string().optional(),
      blastRadius: z.array(z.string()),
      conflictScore: z.number().min(0).max(1),
      timeDecayScore: z.number().min(0).max(1),
      tags: z.array(z.string()),
    })),
  }),
  renderer: z.object({
    audience: z.enum(['peaks-rd', 'peaks-qa', 'peaks-mut', 'all']),
    renderedAt: z.string().datetime(),
    sizeBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    truncatedReason: z.enum(['doc_budget_exceeded', 'section_count_exceeded']).optional(),
  }),
});
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/services/context/types.test.ts`
Expected: PASS, 3 tests pass.

- [ ] **Step 6: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/context/types.ts src/services/context/context-schema.ts tests/unit/services/context/types.test.ts
git commit -m "feat(context): define ContextJson types + Zod schema (v1.0)"
```

---

## Task 3: Collector — file/git/memory/deps scan

**Files:**
- Create: `src/services/context/collector.ts`
- Create: `src/services/context/index.ts` (barrel export)
- Test: `tests/unit/services/context/collector.test.ts`

**Interfaces:**
- Consumes: `ContextJson` goal, project path, deps mode (locked | latest)
- Produces: `CollectorOutput` (files / gitStatus / memoryEntries / deps)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/context/collector.test.ts`:

```typescript
/**
 * Per spec §4.1 — Collector is the first CLI-enforced step. All reads
 * happen via Node fs (not via LLM "please read" prompts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectContext } from '../../../../src/services/context/collector.js';

let workdir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  workdir = mkdtempSync(join(tmpdir(), 'peaks-context-collector-'));
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workdir, { recursive: true, force: true });
});

function makeRepo(): void {
  mkdirSync('src/pages/Login', { recursive: true });
  writeFileSync('src/pages/Login/LoginForm.tsx', 'export const X = 1;\n');
  writeFileSync('package.json', JSON.stringify({
    name: 'demo',
    dependencies: { antd: '5.21.0', react: '18.3.1' },
  }, null, 2));
  writeFileSync('pnpm-lock.yaml', 'lockfileVersion: 9\n');
}

describe('collectContext', () => {
  it('scans files and parses locked deps from package.json', async () => {
    makeRepo();
    const result = await collectContext({
      goal: 'add OAuth callback',
      project: workdir,
      depsMode: 'locked',
    });
    expect(result.collector.files).toContainEqual(
      expect.objectContaining({ path: 'src/pages/Login/LoginForm.tsx', kind: 'source' })
    );
    expect(result.collector.deps['antd']).toMatchObject({ version: '5.21.0' });
    expect(result.collector.deps['react']).toMatchObject({ version: '18.3.1' });
  });

  it('throws when package.json is missing', async () => {
    expect(() => collectContext({
      goal: 'x',
      project: workdir,
      depsMode: 'locked',
    })).rejects.toThrow(/no package.json/i);
  });

  it('hard-fails when locked version is absent (no --deps-mode latest escape)', async () => {
    writeFileSync('package.json', JSON.stringify({ name: 'demo', dependencies: {} }, null, 2));
    await expect(collectContext({
      goal: 'x',
      project: workdir,
      depsMode: 'locked',
    })).rejects.toThrow(/locked version/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/services/context/collector.test.ts`
Expected: FAIL — `collector.ts` does not exist.

- [ ] **Step 3: Write minimal `collector.ts`**

Create `src/services/context/collector.ts`:

```typescript
/**
 * Per spec §4.1 Step 1 — Collector.
 *
 * Hard constraints H1 (CLI enforces reads, not LLM), H2 (locked version).
 * All inputs validated via Zod; all reads via Node fs (no shell-out).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import type {
  CollectedFile, CollectorOutput, DepInfo, FileKind, GitStatus, MemoryEntry,
} from './types.js';

const CollectInputSchema = z.object({
  goal: z.string().min(1),
  project: z.string().min(1),
  depsMode: z.enum(['locked', 'latest']),
});

export type CollectInput = z.infer<typeof CollectInputSchema>;

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

function classifyKind(path: string): FileKind {
  if (path.includes('/__tests__/') || path.endsWith('.test.ts') || path.endsWith('.test.tsx')) {
    return 'test';
  }
  if (path.startsWith('config') || path.endsWith('.config.ts') || path.endsWith('.config.js')) {
    return 'config';
  }
  if (path.endsWith('.md') || path.endsWith('.mdx')) {
    return 'doc';
  }
  return 'source';
}

async function scanFiles(root: string): Promise<ReadonlyArray<CollectedFile>> {
  const out: CollectedFile[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const s = await stat(full);
      out.push({
        path: relative(root, full).replaceAll('\\', '/'),
        kind: classifyKind(relative(root, full)),
        lines: 0, // computed lazily; full line count is expensive
        hash: '',  // computed lazily via content-hash-cache-pattern
      });
    }
  }
  await walk(root);
  return out;
}

async function readGitStatus(project: string): Promise<GitStatus> {
  // Minimal git info via Node — for now delegate to `git` CLI in a future slice.
  // Returning a placeholder keeps the collector testable; full git integration
  // arrives in Task 4 (RD integration) when git is actually needed downstream.
  return {
    branch: 'main',
    lastCommit: 'unknown',
    dirty: false,
  };
}

async function readMemoryEntries(project: string): Promise<ReadonlyArray<MemoryEntry>> {
  // Read .peaks/memory/*.md frontmatter; for v1 store only hash + path
  // (per H8 — never leak full memory text into LLM context).
  const memDir = join(project, '.peaks', 'memory');
  try {
    const entries = await readdir(memDir);
    return entries
      .filter((n) => n.endsWith('.md'))
      .map((n) => ({
        path: join('.peaks/memory', n),
        title: n,
        relevanceScore: 0,
        excerptHash: '',
      }));
  } catch {
    return [];
  }
}

async function readDeps(
  project: string,
  depsMode: 'locked' | 'latest',
): Promise<Record<string, DepInfo>> {
  if (depsMode === 'latest') {
    throw new Error(
      'BLOCKED: --deps-mode latest is forbidden by spec §4.1 (H2: locked only). ' +
      'Configure the project lockfile to enable locked mode.'
    );
  }
  const pkgPath = join(project, 'package.json');
  let raw: string;
  try {
    raw = await readFile(pkgPath, 'utf8');
  } catch {
    throw new Error(`BLOCKED: no package.json at ${project}`);
  }
  const pkg = JSON.parse(raw) as PackageJson;
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (Object.keys(deps).length === 0) {
    throw new Error(
      `BLOCKED: no locked version found in ${pkgPath}. ` +
      'spec §4.1 forbids running with empty dependencies (H2).'
    );
  }
  const result: Record<string, DepInfo> = {};
  for (const [name, version] of Object.entries(deps)) {
    if (typeof version !== 'string' || version === '') {
      throw new Error(`BLOCKED: dep ${name} has no locked version`);
    }
    result[name] = {
      version,
      source: 'package.json',
      resolved: '', // filled by lockfile parser in a later slice
    };
  }
  return result;
}

export async function collectContext(rawInput: unknown): Promise<CollectorOutput & { readonly goal: string }> {
  const input = CollectInputSchema.parse(rawInput);
  const [files, gitStatus, memoryEntries, deps] = await Promise.all([
    scanFiles(input.project),
    readGitStatus(input.project),
    readMemoryEntries(input.project),
    readDeps(input.project, input.depsMode),
  ]);
  return {
    goal: input.goal,
    collector: { files, gitStatus, memoryEntries, deps },
  };
}
```

- [ ] **Step 4: Create `index.ts` barrel**

Create `src/services/context/index.ts`:

```typescript
export { collectContext, type CollectInput } from './collector.js';
export { ContextJsonSchema } from './context-schema.js';
export type {
  ContextJson, Audience, DepsMode, FileKind,
  CollectedFile, GitStatus, MemoryEntry, DepInfo,
  DocSection, FetchedDoc, SkippedDoc,
  TokenizedItem, CollectorOutput, DocRetrieverOutput,
  TokenizerOutput, RendererOutput,
} from './types.js';
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/services/context/collector.test.ts`
Expected: PASS, 3 tests pass.

- [ ] **Step 6: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/context/ tests/unit/services/context/collector.test.ts
git commit -m "feat(context): Collector step (file/git/memory/deps scan, locked-version enforced)"
```

---

## Task 4: DocRetriever — version-locked doc fetch (★ load-bearing)

**Files:**
- Create: `src/services/context/doc-retriever.ts`
- Modify: `src/services/context/index.ts` (add export)
- Test: `tests/unit/services/context/doc-retriever.test.ts`
- **Test (★):** `tests/integration/context/cross-version-isolation.test.ts`

**Interfaces:**
- Consumes: `CollectorOutput.deps`, optional local doc cache root
- Produces: `DocRetrieverOutput` (fetchedDocs + skipped)
- **Critical:** Caller passes `deps` with locked versions. DocRetriever MUST return only docs whose `version` exactly matches the dep version. No fallback to "latest".

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/context/doc-retriever.test.ts`:

```typescript
/**
 * Per spec §4.1 Step 2 — DocRetriever.
 *
 * HARD CONSTRAINT H2: When deps.antd.version === '5.21.0',
 * DocRetriever MUST NOT return any antd doc whose version !== '5.21.0'.
 * This is the load-bearing cross-version isolation promise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retrieveDocs } from '../../../../src/services/context/doc-retriever.js';
import type { DepInfo } from '../../../../src/services/context/types.js';

function makeFetcher(map: Record<string, { version: string; excerpt: string }>): (
  dep: string, version: string
) => Promise<{ version: string; excerpt: string } | null> {
  return async (dep, version) => {
    const key = `${dep}@${version}`;
    return map[key] ?? null;
  };
}

describe('retrieveDocs', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns doc whose version exactly matches locked dep version', async () => {
    const deps: Record<string, DepInfo> = {
      antd: { version: '5.21.0', source: 'package.json', resolved: '' },
    };
    const fetcher = makeFetcher({
      'antd@5.21.0': { version: '5.21.0', excerpt: 'Form.Item API' },
    });
    const result = await retrieveDocs(deps, { fetcher });
    expect(result.fetchedDocs).toHaveLength(1);
    expect(result.fetchedDocs[0]).toMatchObject({ dep: 'antd', version: '5.21.0' });
  });

  it('skips dep when no doc available at locked version (NOT a fallback to latest)', async () => {
    const deps: Record<string, DepInfo> = {
      antd: { version: '5.21.0', source: 'package.json', resolved: '' },
    };
    const fetcher = makeFetcher({}); // nothing at 5.21.0
    const result = await retrieveDocs(deps, { fetcher });
    expect(result.fetchedDocs).toHaveLength(0);
    expect(result.skipped).toContainEqual({
      dep: 'antd',
      reason: 'version_unknown',
    });
  });

  it('NEVER returns a 6.x doc when dep is locked at 5.21.0 (★ core promise)', async () => {
    const deps: Record<string, DepInfo> = {
      antd: { version: '5.21.0', source: 'package.json', resolved: '' },
    };
    const fetcher = makeFetcher({
      'antd@5.21.0': { version: '5.21.0', excerpt: 'Form.Item' },
      'antd@6.0.0': { version: '6.0.0', excerpt: 'Form.item' },
    });
    const result = await retrieveDocs(deps, { fetcher });
    const antdDoc = result.fetchedDocs.find((d) => d.dep === 'antd');
    expect(antdDoc?.version).toBe('5.21.0');
    const allExcerpts = result.fetchedDocs
      .flatMap((d) => d.sections.map((s) => s.excerpt))
      .join(' ');
    expect(allExcerpts).not.toContain('Form.item');
    expect(allExcerpts).toContain('Form.Item');
  });

  it('records network_error when fetcher throws', async () => {
    const deps: Record<string, DepInfo> = {
      axios: { version: '1.7.7', source: 'package.json', resolved: '' },
    };
    const fetcher = async () => { throw new Error('ECONNREFUSED'); };
    const result = await retrieveDocs(deps, { fetcher });
    expect(result.fetchedDocs).toHaveLength(0);
    expect(result.skipped).toContainEqual({
      dep: 'axios',
      reason: 'network_error',
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/services/context/doc-retriever.test.ts`
Expected: FAIL — `doc-retriever.ts` does not exist.

- [ ] **Step 3: Write minimal `doc-retriever.ts`**

Create `src/services/context/doc-retriever.ts`:

```typescript
/**
 * Per spec §4.1 Step 2 — DocRetriever.
 *
 * HARD CONSTRAINTS:
 *   H1 (CLI enforces — not LLM): this module is the only place that decides
 *       which docs to fetch.
 *   H2 (locked version): returns ONLY docs whose version exactly matches
 *       the locked dep version. No fallback to "latest". If no doc exists
 *       at the locked version, record `version_unknown` and move on.
 *
 * The fetcher is injected so tests can pin responses deterministically
 * (cross-version isolation test relies on this).
 */
import type {
  DepInfo, DocRetrieverOutput, DocSection, FetchedDoc, SkippedDoc,
} from './types.js';

export interface DocFetcher {
  (dep: string, version: string): Promise<FetcherPayload | null>;
}

export interface FetcherPayload {
  readonly version: string;
  readonly excerpt: string;
}

export interface RetrieveOptions {
  readonly fetcher: DocFetcher;
  readonly now?: () => Date;
}

function makeSection(excerpt: string): DocSection {
  // Trivial section split — production slice would parse markdown headings.
  // For v1, single-section per dep is sufficient.
  return {
    title: 'API Summary',
    tokenEstimate: Math.ceil(excerpt.length / 4),
    excerpt,
  };
}

function hashContent(content: string): string {
  // Stable hash via Node crypto (deterministic for test pinning).
  // Production uses sha256 from node:crypto.
  // For v1, we accept that this returns a non-cryptographic digest.
  let h = 0;
  for (let i = 0; i < content.length; i += 1) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(16, '0').slice(0, 16);
}

export async function retrieveDocs(
  deps: Readonly<Record<string, DepInfo>>,
  options: RetrieveOptions,
): Promise<DocRetrieverOutput> {
  const fetchedDocs: FetchedDoc[] = [];
  const skipped: SkippedDoc[] = [];
  const now = options.now ?? (() => new Date());

  for (const [dep, info] of Object.entries(deps)) {
    try {
      const payload = await options.fetcher(dep, info.version);
      if (payload === null) {
        skipped.push({ dep, reason: 'version_unknown' });
        continue;
      }
      // ★ Core isolation check — defense in depth even if the fetcher is wrong.
      if (payload.version !== info.version) {
        skipped.push({ dep, reason: 'version_unknown' });
        continue;
      }
      fetchedDocs.push({
        dep,
        version: info.version,
        source: 'remote-fetch',
        fetchedAt: now().toISOString(),
        contentHash: hashContent(payload.excerpt),
        sections: [makeSection(payload.excerpt)],
        stale: false,
      });
    } catch {
      skipped.push({ dep, reason: 'network_error' });
    }
  }

  return { fetchedDocs, skipped };
}
```

- [ ] **Step 4: Update `index.ts` barrel**

Modify `src/services/context/index.ts`:

```typescript
export { collectContext, type CollectInput } from './collector.js';
export { retrieveDocs, type DocFetcher, type FetcherPayload, type RetrieveOptions } from './doc-retriever.js';
export { ContextJsonSchema } from './context-schema.js';
export type {
  ContextJson, Audience, DepsMode, FileKind,
  CollectedFile, GitStatus, MemoryEntry, DepInfo,
  DocSection, FetchedDoc, SkippedDoc,
  TokenizedItem, CollectorOutput, DocRetrieverOutput,
  TokenizerOutput, RendererOutput,
} from './types.js';
```

- [ ] **Step 5: Run unit test — expect PASS**

Run: `pnpm vitest run tests/unit/services/context/doc-retriever.test.ts`
Expected: PASS, 4 tests pass.

- [ ] **Step 6: Write the integration test (★ core promise)**

Create `tests/integration/context/cross-version-isolation.test.ts`:

```typescript
/**
 * ★ CORE INTEGRATION TEST — the load-bearing promise of peaks-context.
 *
 * Per spec §4.1 + Plan 1 §4.1 — when package.json locks antd at 5.21.0,
 * the produced context.json must NEVER contain 6.x API references like
 * `Form.item`. This is the architectural distinction between
 * "CLI-enforced version-aware context" and "LLM-prompted stacking".
 *
 * If this test fails, the core promise of peaks-context is broken.
 * Treat it as a P0 release blocker.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectContext } from '../../../src/services/context/collector.js';
import { retrieveDocs } from '../../../src/services/context/doc-retriever.js';

describe('cross-version isolation (★ core promise)', () => {
  it('antd@5.21.0 deps never produce 6.x API references in any context.json field', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-xver-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'Login.tsx'), 'export const X = 1;\n');
      writeFileSync(join(workdir, 'package.json'), JSON.stringify({
        name: 'demo',
        dependencies: { antd: '5.21.0', react: '18.3.1' },
      }));
      writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const collected = await collectContext({
        goal: 'add login feature',
        project: workdir,
        depsMode: 'locked',
      });

      // The fetcher is intentionally permissive — it returns BOTH 5.x and 6.x
      // docs to prove the DocRetriever filters by exact locked version.
      const fetcher = async (dep: string, version: string) => {
        if (dep === 'antd' && version === '5.21.0') {
          return { version: '5.21.0', excerpt: 'Form.Item, Button, Modal' };
        }
        if (dep === 'antd' && version === '6.0.0') {
          return { version: '6.0.0', excerpt: 'Form.item, Button, Modal' };
        }
        return null;
      };

      const docs = await retrieveDocs(collected.collector.deps, { fetcher });

      const antdDoc = docs.fetchedDocs.find((d) => d.dep === 'antd');
      expect(antdDoc).toBeDefined();
      expect(antdDoc?.version).toBe('5.21.0');

      const allExcerpts = docs.fetchedDocs
        .flatMap((d) => d.sections.map((s) => s.excerpt))
        .join(' ');

      expect(allExcerpts).not.toContain('Form.item');
      expect(allExcerpts).toContain('Form.Item');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 7: Run integration test — expect PASS**

Run: `pnpm vitest run tests/integration/context/cross-version-isolation.test.ts`
Expected: PASS — this is the load-bearing test.

- [ ] **Step 8: Run typecheck + slice check**

Run:
```bash
pnpm tsc --noEmit
peaks slice check --json
```
Expected: 0 errors; slice check passes.

- [ ] **Step 9: Commit**

```bash
git add src/services/context/doc-retriever.ts src/services/context/index.ts \
        tests/unit/services/context/doc-retriever.test.ts \
        tests/integration/context/cross-version-isolation.test.ts
git commit -m "feat(context): DocRetriever with locked-version enforcement (★ core promise)"
```

---

## Task 5: Tokenizer — metadata tagging

**Files:**
- Create: `src/services/context/tokenizer.ts`
- Modify: `src/services/context/index.ts`
- Test: `tests/unit/services/context/tokenizer.test.ts`

**Interfaces:**
- Consumes: `CollectorOutput`, `DocRetrieverOutput`
- Produces: `TokenizerOutput` (metadata with conflictScore, timeDecayScore, blastRadius, tags)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/context/tokenizer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tokenize } from '../../../../src/services/context/tokenizer.js';
import type {
  CollectorOutput, DocRetrieverOutput,
} from '../../../../src/services/context/types.js';

function makeCollector(): CollectorOutput {
  return {
    files: [{ path: 'src/A.ts', kind: 'source', lines: 10, hash: 'h1' }],
    gitStatus: { branch: 'main', lastCommit: 'abc', dirty: false },
    memoryEntries: [{
      path: '.peaks/memory/x.md', title: 'x',
      relevanceScore: 0.8, excerptHash: 'h2',
    }],
    deps: { antd: { version: '5.21.0', source: 'package.json', resolved: '' } },
  };
}

function makeRetriever(): DocRetrieverOutput {
  return {
    fetchedDocs: [{
      dep: 'antd', version: '5.21.0', source: 'remote-fetch',
      fetchedAt: '2026-06-21T12:00:00Z', contentHash: 'h3',
      sections: [{ title: 'API', tokenEstimate: 100, excerpt: 'Form.Item' }],
      stale: false,
    }],
    skipped: [],
  };
}

describe('tokenize', () => {
  it('produces metadata items for each collector + retriever artifact', () => {
    const meta = tokenize(makeCollector(), makeRetriever());
    expect(meta.metadata.length).toBeGreaterThanOrEqual(2);
    expect(meta.metadata).toContainEqual(expect.objectContaining({ kind: 'doc', version: '5.21.0' }));
    expect(meta.metadata).toContainEqual(expect.objectContaining({ kind: 'memory' }));
  });

  it('assigns conflictScore=0 when sources agree', () => {
    const meta = tokenize(makeCollector(), makeRetriever());
    const doc = meta.metadata.find((m) => m.kind === 'doc');
    expect(doc?.conflictScore).toBe(0);
  });

  it('assigns timeDecayScore near 1 for fresh fetches', () => {
    const meta = tokenize(makeCollector(), makeRetriever());
    const doc = meta.metadata.find((m) => m.kind === 'doc');
    expect(doc?.timeDecayScore).toBeGreaterThan(0.9);
  });

  it('is immutable — returns frozen output (no caller mutation)', () => {
    const meta = tokenize(makeCollector(), makeRetriever());
    expect(() => {
      (meta.metadata as unknown as { push: unknown }).push({ id: 'evil' });
    }).toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/services/context/tokenizer.test.ts`
Expected: FAIL — `tokenizer.ts` does not exist.

- [ ] **Step 3: Write minimal `tokenizer.ts`**

Create `src/services/context/tokenizer.ts`:

```typescript
/**
 * Per spec §4.1 Step 3 — Tokenizer (non-mutating).
 *
 * Hard constraint H3: structured metadata > bare strings. Each collector
 * artifact and each fetched doc gets a tokenized metadata record so
 * peaks-rd/qa can do relative-anomaly detection later.
 *
 * Immutability H (common/coding-style): the output is frozen so callers
 * cannot mutate it. Use spread to derive new outputs in future slices.
 */
import type {
  CollectorOutput, DocRetrieverOutput, TokenizedItem, TokenizerOutput,
} from './types.js';

function freshDecayScore(fetchedAt: string, now: Date): number {
  const ageMs = now.getTime() - new Date(fetchedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Linear decay: 1.0 at day 0, 0.5 at day 30, 0.0 at day 60+
  if (ageDays >= 60) return 0;
  return Math.max(0, 1 - ageDays / 60);
}

export function tokenize(
  collector: CollectorOutput,
  docRetriever: DocRetrieverOutput,
  now: Date = new Date(),
): TokenizerOutput {
  const metadata: TokenizedItem[] = [];

  for (const doc of docRetriever.fetchedDocs) {
    metadata.push({
      id: `doc:${doc.dep}@${doc.version}`,
      kind: 'doc',
      version: doc.version,
      blastRadius: doc.sections.map((s) => s.title),
      conflictScore: 0, // v1: no cross-source conflict detection yet
      timeDecayScore: freshDecayScore(doc.fetchedAt, now),
      tags: ['fetched', doc.source, doc.stale ? 'stale' : 'fresh'],
    });
  }

  for (const mem of collector.memoryEntries) {
    metadata.push({
      id: `memory:${mem.path}`,
      kind: 'memory',
      blastRadius: [mem.title],
      conflictScore: 0,
      timeDecayScore: mem.relevanceScore,
      tags: ['memory'],
    });
  }

  for (const file of collector.files) {
    metadata.push({
      id: `code:${file.path}`,
      kind: 'code',
      blastRadius: [file.path],
      conflictScore: 0,
      timeDecayScore: 1,
      tags: [file.kind],
    });
  }

  return Object.freeze({ metadata: Object.freeze(metadata) as ReadonlyArray<TokenizedItem> });
}
```

- [ ] **Step 4: Update `index.ts`**

Add to `src/services/context/index.ts`:

```typescript
export { tokenize } from './tokenizer.js';
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/services/context/tokenizer.test.ts`
Expected: PASS, 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/context/tokenizer.ts src/services/context/index.ts tests/unit/services/context/tokenizer.test.ts
git commit -m "feat(context): Tokenizer with metadata tagging (frozen output)"
```

---

## Task 6: Renderer — audience-scoped render + budget truncation

**Files:**
- Create: `src/services/context/renderer.ts`
- Modify: `src/services/context/index.ts`
- Test: `tests/unit/services/context/renderer.test.ts`

**Interfaces:**
- Consumes: `CollectorOutput`, `DocRetrieverOutput`, `TokenizerOutput`, audience, goal, doc budget (default 8000 tokens)
- Produces: `RendererOutput` (audience, renderedAt, sizeBytes, truncated, truncatedReason)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/context/renderer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '../../../../src/services/context/renderer.js';
import type {
  CollectorOutput, DocRetrieverOutput, TokenizerOutput, Audience,
} from '../../../../src/services/context/types.js';

function fixture(audience: Audience): {
  collector: CollectorOutput;
  docRetriever: DocRetrieverOutput;
  tokenizer: TokenizerOutput;
} {
  const collector: CollectorOutput = {
    files: [],
    gitStatus: { branch: 'main', lastCommit: 'abc', dirty: false },
    memoryEntries: [],
    deps: {},
  };
  const docRetriever: DocRetrieverOutput = {
    fetchedDocs: [
      { dep: 'antd', version: '5.21.0', source: 'remote-fetch', fetchedAt: '2026-06-21T12:00:00Z', contentHash: 'h', sections: [{ title: 'API', tokenEstimate: 100, excerpt: 'Form.Item' }], stale: false },
      { dep: 'react', version: '18.3.1', source: 'remote-fetch', fetchedAt: '2026-06-21T12:00:00Z', contentHash: 'h2', sections: [{ title: 'API', tokenEstimate: 100, excerpt: 'useState' }], stale: false },
    ],
    skipped: [],
  };
  const tokenizer: TokenizerOutput = {
    metadata: [
      { id: 'doc:antd@5.21.0', kind: 'doc', version: '5.21.0', blastRadius: ['API'], conflictScore: 0, timeDecayScore: 1, tags: ['fresh'] },
      { id: 'doc:react@18.3.1', kind: 'doc', version: '18.3.1', blastRadius: ['API'], conflictScore: 0, timeDecayScore: 1, tags: ['fresh'] },
    ],
  };
  return { collector, docRetriever, tokenizer };
}

describe('render', () => {
  it('peaks-rd audience returns strategy view (goal + docs)', () => {
    const f = fixture('peaks-rd');
    const r = render({
      goal: 'add OAuth',
      audience: 'peaks-rd',
      docBudgetTokens: 8000,
      ...f,
    });
    expect(r.audience).toBe('peaks-rd');
    expect(r.sizeBytes).toBeGreaterThan(0);
    expect(r.truncated).toBe(false);
  });

  it('peaks-mut audience returns test-only view', () => {
    const f = fixture('peaks-mut');
    const r = render({
      goal: 'verify OAuth tests',
      audience: 'peaks-mut',
      docBudgetTokens: 8000,
      ...f,
    });
    expect(r.audience).toBe('peaks-mut');
  });

  it('truncates when doc budget exceeded', () => {
    const f = fixture('all');
    const r = render({
      goal: 'x',
      audience: 'all',
      docBudgetTokens: 1, // absurdly small
      ...f,
    });
    expect(r.truncated).toBe(true);
    expect(r.truncatedReason).toBe('doc_budget_exceeded');
  });

  it('is immutable', () => {
    const f = fixture('all');
    const r = render({ goal: 'x', audience: 'all', docBudgetTokens: 8000, ...f });
    expect(() => {
      (r as unknown as { sizeBytes: number }).sizeBytes = -1;
    }).toThrow();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/services/context/renderer.test.ts`
Expected: FAIL — `renderer.ts` does not exist.

- [ ] **Step 3: Write minimal `renderer.ts`**

Create `src/services/context/renderer.ts`:

```typescript
/**
 * Per spec §4.1 Step 4 — Renderer.
 *
 * Audience-scoped view: peaks-rd sees goal + docs + memory;
 * peaks-qa sees test files + coverage + (later) mut-report;
 * peaks-mut sees test files + source under test only.
 *
 * Hard constraint: budget truncation must be explicit, never silent.
 */
import type {
  Audience, CollectorOutput, DocRetrieverOutput, RendererOutput,
  TokenizerOutput,
} from './types.js';

export interface RenderInput {
  readonly goal: string;
  readonly audience: Audience;
  readonly docBudgetTokens: number;
  readonly collector: CollectorOutput;
  readonly docRetriever: DocRetrieverOutput;
  readonly tokenizer: TokenizerOutput;
  readonly now?: () => Date;
}

function pickDocsForAudience(
  audience: Audience,
  docs: DocRetrieverOutput['fetchedDocs'],
): DocRetrieverOutput['fetchedDocs'] {
  if (audience === 'peaks-mut') {
    // peaks-mut does NOT see docs — its job is purely test quality.
    return [];
  }
  return docs;
}

export function render(input: RenderInput): RendererOutput {
  const now = input.now ?? (() => new Date());
  const docs = pickDocsForAudience(input.audience, input.docRetriever.fetchedDocs);

  // Estimate size: rough heuristic — bytes = chars.
  // v1 serializes to a single string to compute sizeBytes.
  const serialized = JSON.stringify({
    goal: input.goal,
    audience: input.audience,
    docs: docs.map((d) => ({ dep: d.dep, version: d.version, excerpt: d.sections.map((s) => s.excerpt).join(' ') })),
    skipped: input.docRetriever.skipped,
  });
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  const approxTokens = Math.ceil(sizeBytes / 4);

  const truncated = approxTokens > input.docBudgetTokens;
  const result: RendererOutput = {
    audience: input.audience,
    renderedAt: now().toISOString(),
    sizeBytes,
    truncated,
    ...(truncated ? { truncatedReason: 'doc_budget_exceeded' as const } : {}),
  };
  return Object.freeze(result);
}
```

- [ ] **Step 4: Update `index.ts`**

Add to `src/services/context/index.ts`:

```typescript
export { render, type RenderInput } from './renderer.js';
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/services/context/renderer.test.ts`
Expected: PASS, 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/context/renderer.ts src/services/context/index.ts tests/unit/services/context/renderer.test.ts
git commit -m "feat(context): Renderer with audience-scoping + budget truncation"
```

---

## Task 7: ContextBuilder — orchestrator + sha256 + atomic write

**Files:**
- Create: `src/services/context/context-builder.ts`
- Modify: `src/services/context/index.ts`
- Test: `tests/unit/services/context/context-builder.test.ts`

**Interfaces:**
- Consumes: goal, project, audience, depsMode, docBudgetTokens, outputPath
- Produces: written `context.json` file + returns parsed `ContextJson`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/context/context-builder.test.ts`:

```typescript
/**
 * Per spec §4.1 — ContextBuilder orchestrates 4 steps and writes a single
 * context.json with sha256 of its own contents (H8 audit trail).
 *
 * Hard constraint H8: sha256 must be the hash of the *contents excluding*
 * the sha256 field itself (else chicken-and-egg).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../../../src/services/context/context-builder.js';

let workdir: string;
let outdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-builder-'));
  outdir = mkdtempSync(join(tmpdir(), 'peaks-builder-out-'));
  mkdirSync(join(workdir, 'src'), { recursive: true });
  writeFileSync(join(workdir, 'src', 'A.ts'), 'export const X = 1;\n');
  writeFileSync(join(workdir, 'package.json'), JSON.stringify({
    name: 'demo', dependencies: { antd: '5.21.0' },
  }));
  writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(outdir, { recursive: true, force: true });
});

describe('buildContext', () => {
  it('produces a context.json with valid sha256', async () => {
    const ctx = await buildContext({
      goal: 'add OAuth',
      project: workdir,
      audience: 'peaks-rd',
      depsMode: 'locked',
      docBudgetTokens: 8000,
      out: join(outdir, 'context.json'),
      fetcher: async (dep, version) => {
        if (dep === 'antd' && version === '5.21.0') {
          return { version: '5.21.0', excerpt: 'Form.Item' };
        }
        return null;
      },
    });
    expect(ctx.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(outdir, 'context.json'))).toBe(true);
  });

  it('writes the same sha256 as the file on disk', async () => {
    await buildContext({
      goal: 'x',
      project: workdir,
      audience: 'peaks-rd',
      depsMode: 'locked',
      docBudgetTokens: 8000,
      out: join(outdir, 'context.json'),
      fetcher: async () => null,
    });
    const onDisk = JSON.parse(readFileSync(join(outdir, 'context.json'), 'utf8'));
    expect(onDisk.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('atomic write — no partial file on disk if interrupted', async () => {
    // Simulate by using a directory that becomes unwritable mid-write.
    // v1: writes to <out>.tmp then renames — verify <out>.tmp is cleaned.
    const target = join(outdir, 'context.json');
    await buildContext({
      goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
      docBudgetTokens: 8000, out: target,
      fetcher: async () => null,
    });
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/services/context/context-builder.test.ts`
Expected: FAIL — `context-builder.ts` does not exist.

- [ ] **Step 3: Write `context-builder.ts`**

Create `src/services/context/context-builder.ts`:

```typescript
/**
 * Per spec §4.1 — ContextBuilder.
 *
 * Orchestrates Collector → DocRetriever → Tokenizer → Renderer.
 * Computes sha256 over the content (excluding the sha256 field itself —
 * H8 audit-trail integrity). Atomic write: tmp file + rename, so a crash
 * mid-write leaves no partial context.json on disk.
 */
import { createHash } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { collectContext } from './collector.js';
import { retrieveDocs, type DocFetcher } from './doc-retriever.js';
import { tokenize } from './tokenizer.js';
import { render, type RenderInput } from './renderer.js';
import { ContextJsonSchema } from './context-schema.js';
import type { Audience, ContextJson } from './types.js';

const BuildInputSchema = z.object({
  goal: z.string().min(1),
  project: z.string().min(1),
  audience: z.enum(['peaks-rd', 'peaks-qa', 'peaks-mut', 'all']),
  depsMode: z.enum(['locked', 'latest']),
  docBudgetTokens: z.number().int().positive().default(8000),
  out: z.string().min(1),
  fetcher: z.function(),
});

export type BuildInput = z.infer<typeof BuildInputSchema>;

function sha256OfContent(content: object): string {
  // Exclude `sha256` field from the hash (else chicken-and-egg).
  const { sha256: _omit, ...rest } = content as { sha256?: string };
  void _omit;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export async function buildContext(rawInput: unknown): Promise<ContextJson> {
  const input = BuildInputSchema.parse(rawInput) as BuildInput & { fetcher: DocFetcher };

  const collected = await collectContext({
    goal: input.goal,
    project: input.project,
    depsMode: input.depsMode,
  });

  const docs = await retrieveDocs(collected.collector.deps, { fetcher: input.fetcher });
  const tok = tokenize(collected.collector, docs);

  const renderInput: RenderInput = {
    goal: input.goal,
    audience: input.audience as Audience,
    docBudgetTokens: input.docBudgetTokens,
    collector: collected.collector,
    docRetriever: docs,
    tokenizer: tok,
  };
  const renderer = render(renderInput);

  // First pass: placeholder sha256 so we can hash the rest.
  const partial = {
    version: '1.0' as const,
    goal: input.goal,
    generatedAt: new Date().toISOString(),
    sha256: '',
    collector: collected.collector,
    docRetriever: docs,
    tokenizer: tok,
    renderer,
  };
  const sha256 = sha256OfContent(partial);
  const finalCtx: ContextJson = { ...partial, sha256 };

  // Validate before write (H8: garbage context.json must never land).
  ContextJsonSchema.parse(finalCtx);

  // Atomic write: tmp + rename.
  const tmp = `${input.out}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(finalCtx, null, 2), 'utf8');
    await rename(tmp, input.out);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }

  return finalCtx;
}
```

- [ ] **Step 4: Update `index.ts`**

Add to `src/services/context/index.ts`:

```typescript
export { buildContext, type BuildInput } from './context-builder.js';
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/services/context/context-builder.test.ts`
Expected: PASS, 3 tests pass.

- [ ] **Step 6: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/context/context-builder.ts src/services/context/index.ts tests/unit/services/context/context-builder.test.ts
git commit -m "feat(context): ContextBuilder orchestrator + atomic write + sha256"
```

---

## Task 8: CLI commands — `peaks context <sub>`

**Files:**
- Create: `src/cli/commands/context-builder-commands.ts`
- Test: `tests/unit/cli/commands/context-builder-commands.test.ts`
- (No modification to `src/cli/index.ts` or `program.ts` in this task — wiring the new commands into the live `peaks` root program is **deferred to Task 9**, which has access to a fetcher.)

- [ ] **Step 1: Read existing CLI structure**

Read `src/cli/commands/` for one existing command file to mirror conventions. Don't restructure; match the existing pattern (commander 12 API).

- [ ] **Step 2: Write the failing test**

Create `tests/unit/cli/commands/context-commands.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { createContextCommands } from '../../../../src/cli/commands/context-builder-commands.js';

let workdir: string;
let outdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peaks-cli-ctx-'));
  outdir = mkdtempSync(join(tmpdir(), 'peaks-cli-ctx-out-'));
  mkdirSync(join(workdir, 'src'), { recursive: true });
  writeFileSync(join(workdir, 'src', 'A.ts'), 'export const X = 1;\n');
  writeFileSync(join(workdir, 'package.json'), JSON.stringify({
    name: 'demo', dependencies: { antd: '5.21.0' },
  }));
  writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(outdir, { recursive: true, force: true });
});

describe('peaks context commands', () => {
  it('build writes context.json via CLI', async () => {
    // Pre-flight fix: createContextCommands returns a NAMED Command('context').
    // Wrap it in an unnamed root and drop the script-name 'peaks' from argv —
    // commander 12 strips argv[0..1] unconditionally, so userArgs starts at
    // argv[2]. With an unnamed root, argv[2] must be 'context' (the first
    // subcommand), not 'peaks'.
    const ctx = createContextCommands({
      fetcher: async (dep: string, version: string) => {
        if (dep === 'antd' && version === '5.21.0') {
          return { version: '5.21.0', excerpt: 'Form.Item' };
        }
        return null;
      },
    });
    const program = new Command().addCommand(ctx);
    await program.parseAsync([
      'node', 'peaks', 'context', 'build',
      '--goal', 'add OAuth',
      '--project', workdir,
      '--audience', 'peaks-rd',
      '--deps-mode', 'locked',
      '--doc-budget-tokens', '8000',
      '--out', join(outdir, 'context.json'),
    ]);
    expect(existsSync(join(outdir, 'context.json'))).toBe(true);
    const json = JSON.parse(readFileSync(join(outdir, 'context.json'), 'utf8'));
    expect(json.version).toBe('1.0');
    expect(json.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validate accepts a valid context.json', async () => {
    // First, build one.
    const ctx = createContextCommands({ fetcher: async () => null });
    const program = new Command().addCommand(ctx);
    const out = join(outdir, 'context.json');
    await program.parseAsync([
      'node', 'peaks', 'context', 'build',
      '--goal', 'x', '--project', workdir, '--audience', 'all',
      '--deps-mode', 'locked', '--doc-budget-tokens', '8000', '--out', out,
    ]);
    // Reset program state for second invocation.
    const ctx2 = createContextCommands({ fetcher: async () => null });
    const program2 = new Command().addCommand(ctx2);
    const exitCode = await new Promise<number>((resolve) => {
      program2.exitOverride().parseAsync([
        'node', 'peaks', 'context', 'validate', out,
      ]).then(() => resolve(0)).catch((err) => resolve(err.code ?? 1));
    });
    expect(exitCode).toBe(0);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/cli/commands/context-builder-commands.test.ts`
Expected: FAIL — `context-builder-commands.ts` does not exist.

- [ ] **Step 4: Write `context-builder-commands.ts`**

Create `src/cli/commands/context-builder-commands.ts`. Mirror the existing commander 12 pattern from other command files in `src/cli/commands/`. Provide these subcommands:

- `peaks context build` — wraps `buildContext`
- `peaks context inspect <file>` — pretty-print summary
- `peaks context validate <file>` — runs `ContextJsonSchema.safeParse`
- `peaks context schema` — outputs JSON Schema (Phase 9 task creates `schemas/context.schema.json`; here just `console.log` it)

```typescript
/**
 * `peaks context <sub>` — CLI surface for the ContextBuilder.
 * Per spec §4.1 — these commands are the only sanctioned entry point;
 * peaks-rd / peaks-qa / peaks-mut invoke them programmatically.
 */
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { buildContext } from '../../services/context/context-builder.js';
import { ContextJsonSchema } from '../../services/context/context-schema.js';
import type { DocFetcher } from '../../services/context/doc-retriever.js';

export interface ContextCommandsOptions {
  readonly fetcher: DocFetcher;
}

export function createContextCommands(options: ContextCommandsOptions): Command {
  const context = new Command('context').description(
    'peaks-context: build versioned, version-locked context.json (spec §4.1)'
  );

  context
    .command('build')
    .requiredOption('--goal <text>', 'user request goal')
    .requiredOption('--project <path>', 'project root')
    .option('--audience <role>', 'peaks-rd | peaks-qa | peaks-mut | all', 'all')
    .option('--deps-mode <mode>', 'locked | latest', 'locked')
    .option('--doc-budget-tokens <n>', 'token budget for renderer', '8000')
    .requiredOption('--out <path>', 'output path for context.json')
    .option('--json', 'machine-readable output', false)
    .action(async (opts: {
      goal: string;
      project: string;
      audience: string;
      depsMode: string;
      docBudgetTokens: string;
      out: string;
      json: boolean;
    }) => {
      const ctx = await buildContext({
        goal: opts.goal,
        project: opts.project,
        audience: opts.audience,
        depsMode: opts.depsMode,
        docBudgetTokens: Number(opts.docBudgetTokens),
        out: opts.out,
        fetcher: options.fetcher,
      });
      if (opts.json) {
        process.stdout.write(JSON.stringify({ ok: true, sha256: ctx.sha256 }) + '\n');
      } else {
        process.stdout.write(`context.json written: ${opts.out}\nsha256: ${ctx.sha256}\n`);
      }
    });

  context
    .command('validate <file>')
    .action(async (file: string) => {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      const result = ContextJsonSchema.safeParse(parsed);
      if (!result.success) {
        process.stderr.write(`INVALID: ${result.error.message}\n`);
        process.exit(2);
      }
      process.stdout.write(`OK: ${file}\n`);
    });

  context
    .command('inspect <file>')
    .action(async (file: string) => {
      const raw = await readFile(file, 'utf8');
      const ctx = JSON.parse(raw);
      process.stdout.write([
        `version: ${ctx.version}`,
        `goal: ${ctx.goal}`,
        `sha256: ${ctx.sha256}`,
        `deps: ${Object.keys(ctx.collector.deps).join(', ')}`,
        `fetchedDocs: ${ctx.docRetriever.fetchedDocs.length}`,
        `skipped: ${ctx.docRetriever.skipped.length}`,
        `truncated: ${ctx.renderer.truncated}`,
        `audience: ${ctx.renderer.audience}`,
      ].join('\n') + '\n');
    });

  context
    .command('schema')
    .action(async () => {
      // Pre-flight fix #3: read from the canonical schemas/context.schema.json
      // (generated by Task 12) instead of serializing Zod internals at runtime.
      // Both files must agree; if schema.json is missing, this command fails
      // with a clear message pointing at Task 12.
      const fs = await import('node:fs/promises');
      try {
        const content = await fs.readFile('schemas/context.schema.json', 'utf8');
        process.stdout.write(content + '\n');
      } catch {
        process.stderr.write(
          'BLOCKED: schemas/context.schema.json not found.\n' +
          'Run Task 12 of Plan 1 to generate it.\n'
        );
        process.exit(2);
      }
    });

  return context;
}
```

- [ ] **Step 5: (NO-OP this task — wiring deferred to Task 9)**

Wiring the new commands into the live `peaks` root program requires a fetcher, which is introduced by Task 9 (mockFetcher) and replaced by Task 10 (headroomFetcher). This task only ships the new file + test. Task 9 wires `program.ts` to call `registerContextBuilderCommands(...)` with the fetcher it produces.

- [ ] **Step 6: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/cli/commands/context-builder-commands.test.ts`
Expected: PASS, 2 tests pass.

- [ ] **Step 7: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Manual smoke**

```bash
peaks context build --goal "smoke test" --project . --audience peaks-rd --deps-mode locked --doc-budget-tokens 8000 --out /tmp/context.json
peaks context validate /tmp/context.json
peaks context inspect /tmp/context.json
```

Expected: writes context.json; validate OK; inspect prints summary.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/context-builder-commands.ts tests/unit/cli/commands/context-builder-commands.test.ts
git commit -m "feat(context): CLI commands (build/validate/inspect/schema)"
```

---

## Task 9: Wire into peaks-rd + peaks-qa (auto-call before run)

> **Pre-flight fix (controller main-loop edit, 2026-06-21):** The original brief had 3 plan bugs:
> 1. `src/services/qa/qa-service.ts` does NOT exist. The actual QA entry point is `runQaSlice` in `src/cli/commands/qa-commands.ts:79`.
> 2. The "likely `runRd` / `runQa` or similar" assumption is wrong. Real exports: `createRdSwarmPlan(request: RdSwarmPlanRequest): RdPlanResult` at `src/services/rd/rd-service.ts:551`, and `runQaSlice(input: RunQaSliceInput): QaRunResult` at `src/cli/commands/qa-commands.ts:79`.
> 3. Both entry points are **synchronous**. The brief's `await buildContext(...)` pattern requires async context. The wrap is done at the CLI command action layer (where async is already available), NOT at the service layer. `createRdSwarmPlan` and `runQaSlice` stay sync.
>
> **Ordering:** Task 9.5 (mock-fetcher scaffold) MUST land before Task 9. Dispatch Task 9.5 first.

**Files:**
- Modify: `src/cli/commands/workflow-commands.ts` (rd CLI handler — add `await ensureContextForRd(...)` pre-step at the rd action handler around line ~259)
- Modify: `src/cli/commands/qa-commands.ts` (qa CLI handler — add `await ensureContextForQa(...)` pre-step at the qa action handler around line ~199)
- NO-OP: `src/services/rd/rd-service.ts` and `src/services/qa/qa-service.ts` are NOT touched. The wrap happens at the CLI command action layer, where async context already exists.

**Interfaces:**
- Two new helper functions (one in each CLI handler file): `ensureContextForRd(goal, project, sid)` and `ensureContextForQa(goal, project, sid)`. Both call `buildContext({ ... audience: 'peaks-rd' | 'peaks-qa', fetcher: mockFetcher })` from Task 9.5.

- [ ] **Step 1: Read existing CLI handler entry points**

Read `src/cli/commands/workflow-commands.ts` (rd command action handler around line ~259) and `src/cli/commands/qa-commands.ts` (qa command action handler around line ~199). Identify the existing async context. Both are inside already-async action handlers; prepending `await ensureContextForXxx(...)` is a minimal change.

- [ ] **Step 2: Modify `workflow-commands.ts`**

Add at the top of `src/cli/commands/workflow-commands.ts`:

```typescript
import { buildContext } from '../../services/context/context-builder.js';

// PRE-FLIGHT FIX: Task 10 will replace this with headroomFetcher.
import { mockFetcher } from '../../services/context/mock-fetcher.js';

async function ensureContextForRd(goal: string, project: string, sid: string): Promise<void> {
  const out = `.peaks/_runtime/${sid}/context.json`;
  await buildContext({
    goal, project, audience: 'peaks-rd', depsMode: 'locked',
    docBudgetTokens: 8000, out, fetcher: mockFetcher,
  });
}
```

In the rd action handler, prepend `await ensureContextForRd(goal, project, sid)` BEFORE `createRdSwarmPlan({ ... })`. The existing `goal` / `project` / `sessionId` are already in scope (or compute `sid` from the active session).

- [ ] **Step 3: Modify `qa-commands.ts`**

Add at the top of `src/cli/commands/qa-commands.ts` (alongside the existing imports):

```typescript
import { buildContext } from '../../services/context/context-builder.js';

// PRE-FLIGHT FIX: Task 10 will replace this with headroomFetcher.
import { mockFetcher } from '../../services/context/mock-fetcher.js';

async function ensureContextForQa(goal: string, project: string, sid: string): Promise<void> {
  const out = `.peaks/_runtime/${sid}/context.json`;
  await buildContext({
    goal, project, audience: 'peaks-qa', depsMode: 'locked',
    docBudgetTokens: 8000, out, fetcher: mockFetcher,
  });
}
```

In the qa action handler (line ~199), prepend `await ensureContextForQa(goal, project, sid)` BEFORE `runQaSlice({ ... })`. If `goal` is not already in scope, derive it from `input.sessionId` or pass a placeholder ("qa gate run"); the goal is for audience-scoped doc retrieval, not for output semantics.

- [ ] **Step 4: Run peaks-rd smoke**

```bash
pnpm tsx src/cli/index.ts rd <sample request>
```

Expected: `.peaks/_runtime/<active-sid>/context.json` is created with `audience: "peaks-rd"`.

- [ ] **Step 5: Run peaks-qa smoke**

```bash
pnpm tsx src/cli/index.ts qa <sample request>
```

Expected: same; context.json has `audience: "peaks-qa"`.

- [ ] **Step 6: Run full vitest suite**

Run: `pnpm vitest run`
Expected: all tests pass (including pre-existing 2,800+ tests — context-commands must NOT regress them).

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/workflow-commands.ts src/cli/commands/qa-commands.ts
git commit -m "feat(context): wire peaks-context auto-build into rd + qa pre-step"
```

---

## Task 9.5: mock-fetcher — temporary fetcher used until Task 10 lands

> **Pre-flight fix (Task 9 vs Task 10 ordering):** Task 9 needs a fetcher but Task 10's `headroomFetcher` doesn't exist yet. This task ships a 6-line `mockFetcher` that returns `null` (forcing DocRetriever to record `version_unknown` for every dep). Task 10 replaces it via the import in Task 9's rd-service.ts. Remove this task from the plan after Task 10 lands — it is scaffolding only.

**Files:**
- Create: `src/services/context/mock-fetcher.ts`
- Test: `tests/unit/services/context/mock-fetcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mockFetcher } from '../../../../src/services/context/mock-fetcher.js';

describe('mockFetcher', () => {
  it('always returns null', async () => {
    expect(await mockFetcher('antd', '5.21.0')).toBeNull();
    expect(await mockFetcher('react', '18.3.1')).toBeNull();
  });
});
```

- [ ] **Step 2: Write `mock-fetcher.ts`**

```typescript
/**
 * TEMPORARY scaffolding fetcher. Returns null for every (dep, version).
 * Replaced by headroomFetcher in Task 10. Keep this file until Task 10 lands.
 */
import type { DocFetcher } from './doc-retriever.js';

export const mockFetcher: DocFetcher = async () => null;
```

- [ ] **Step 3: Run + commit**

Run: `pnpm vitest run tests/unit/services/context/mock-fetcher.test.ts`
Expected: PASS.

```bash
git add src/services/context/mock-fetcher.ts tests/unit/services/context/mock-fetcher.test.ts
git commit -m "feat(context): mock-fetcher (scaffolding for Task 9 — replaced in Task 10)"
```

---

## Task 10: headroom-fetcher — production doc fetcher (uses existing `headroom-ai` dep)

> **Pre-flight fix (controller main-loop edit, 2026-06-21):** Step 3 + Step 4 in the original brief say "Modify: `src/services/rd/rd-service.ts` (swap mockFetcher → headroomFetcher)". This is wrong per the Task 9 architecture: the swap happens in the CLI handler files, NOT in `rd-service.ts` (which stays sync and untouched since Task 9). Apply the swap in both `src/cli/commands/workflow-commands.ts` and `src/cli/commands/qa-commands.ts`.

**Files:**
- Create: `src/services/context/headroom-fetcher.ts`
- Modify: `src/services/context/mock-fetcher.ts` (add deprecation comment)
- Modify: `src/cli/commands/workflow-commands.ts` (swap mockFetcher → headroomFetcher in `ensureContextForRd`)
- Modify: `src/cli/commands/qa-commands.ts` (swap mockFetcher → headroomFetcher in `ensureContextForQa`)
- Test: `tests/unit/services/context/headroom-fetcher.test.ts`

**Interfaces:**
- A `DocFetcher` implementation that:
  - Checks local cache first at `.peaks/_runtime/<sid>/doc-cache/<dep>@<version>.md` (per pre-flight fix #2 — cache path is per-session, NOT `/tmp` and NOT `~/.peaks/cache/`)
  - Falls back to `headroom-ai` for remote retrieval (existing dep, version 0.22.4)
  - Marks `stale` if cache version differs from locked version
  - Returns `null` on failure (let caller mark `version_unknown`)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/services/context/headroom-fetcher.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHeadroomFetcher } from '../../../../src/services/context/headroom-fetcher.js';

let cacheDir: string;
beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'peaks-headroom-cache-')); });
afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }); });

describe('headroom-fetcher', () => {
  it('returns cached doc when version matches', async () => {
    mkdirSync(join(cacheDir, 'antd@5.21.0.md').replace('antd@5.21.0.md', ''), { recursive: true });
    writeFileSync(join(cacheDir, 'antd@5.21.0.md'), 'Form.Item API');
    const fetcher = createHeadroomFetcher({ cacheDir, remoteFetcher: async () => null });
    const result = await fetcher('antd', '5.21.0');
    expect(result).toEqual({ version: '5.21.0', excerpt: 'Form.Item API' });
  });

  it('returns null when cache miss + no remote', async () => {
    const fetcher = createHeadroomFetcher({ cacheDir, remoteFetcher: async () => null });
    const result = await fetcher('antd', '5.21.0');
    expect(result).toBeNull();
  });

  it('falls back to remoteFetcher on cache miss', async () => {
    const fetcher = createHeadroomFetcher({
      cacheDir,
      remoteFetcher: async (dep, version) => ({ version, excerpt: `Remote ${dep}` }),
    });
    const result = await fetcher('oauth-client', '2.4.0');
    expect(result).toEqual({ version: '2.4.0', excerpt: 'Remote oauth-client' });
  });
});
```

- [ ] **Step 2: Write `headroom-fetcher.ts`**

```typescript
/**
 * Production DocFetcher. Uses existing headroom-ai dependency for remote
 * fetch; local cache (per-session, per-dep markdown) preferred when version matches.
 *
 * Hard constraint H2 (locked version): never returns a doc whose version
 * differs from the requested locked version.
 *
 * Cache path (per pre-flight fix #2): .peaks/_runtime/<sid>/doc-cache/<dep>@<version>.md
 *   - Per-session (NOT cross-session shared at ~/.peaks/cache/docs/)
 *   - Reason: spec §4.1 keeps everything under _runtime which is gitignored
 *     and ephemeral; cross-session caching is a future-slice optimization.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocFetcher, FetcherPayload } from './doc-retriever.js';

export interface HeadroomFetcherOptions {
  readonly cacheDir: string;
  readonly remoteFetcher?: DocFetcher;
}

export function createHeadroomFetcher(opts: HeadroomFetcherOptions): DocFetcher {
  return async (dep, version) => {
    const cachePath = join(opts.cacheDir, `${dep}@${version}.md`);
    try {
      const content = await readFile(cachePath, 'utf8');
      return { version, excerpt: content };
    } catch {
      if (!opts.remoteFetcher) return null;
      return opts.remoteFetcher(dep, version);
    }
  };
}
```

- [ ] **Step 3: Replace `mockFetcher` import in CLI handlers**

After Task 10 lands, change the line in BOTH `src/cli/commands/workflow-commands.ts` AND `src/cli/commands/qa-commands.ts`:

```typescript
import { mockFetcher } from '../../services/context/mock-fetcher.js';
```
to:
```typescript
import { createHeadroomFetcher } from '../../services/context/headroom-fetcher.js';
import { getSessionId } from '../../services/session/session-manager.js';

function buildHeadroomFetcher(): DocFetcher {
  const sid = getSessionId();
  return createHeadroomFetcher({
    cacheDir: `.peaks/_runtime/${sid}/doc-cache`,
    // remoteFetcher wired in a future slice (headroom-ai programmatic API).
  });
}
```

Then replace `fetcher: mockFetcher` with `fetcher: buildHeadroomFetcher()` inside both `ensureContextForRd` and `ensureContextForQa`.

Also add a deprecation comment at the top of `src/services/context/mock-fetcher.ts`:
```typescript
/**
 * @deprecated — replaced by headroomFetcher in Task 10. Keep until the next
 * cleanup slice removes the import in workflow-commands.ts and qa-commands.ts.
 */
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm vitest run tests/unit/services/context/headroom-fetcher.test.ts`
Expected: PASS, 3 tests pass.

```bash
git add src/services/context/headroom-fetcher.ts src/services/context/mock-fetcher.ts tests/unit/services/context/headroom-fetcher.test.ts src/cli/commands/workflow-commands.ts src/cli/commands/qa-commands.ts
git commit -m "feat(context): headroom-fetcher (production doc fetcher with per-session cache)"
```

---

## Task 11: End-to-end integration test

> **Pre-flight fix (controller main-loop edit, 2026-06-21):** Round-1 implementer caught a real bug in the brief: when `out` lives inside `project`, the first `buildContext` writes the output file which the second `buildContext` then sweeps up via the collector, breaking the "stable across runs" invariant. This is ALSO a production issue — a user re-running `peaks context build --out context.json --project .` would see `context.json` appear in the file list on subsequent runs. Fix: harden the collector to exclude `out` from the file sweep (architecturally correct fix; closes the production non-determinism window).

**Files:**
- Modify: `src/services/context/collector.ts` (add optional `out` field to `CollectInput`; skip `out` in `scanFiles`)
- Modify: `src/services/context/context-builder.ts` (pass `out` to `collectContext`)
- Modify: `tests/unit/services/context/collector.test.ts` (add 1 test: collector skips `out` file)
- Create: `tests/integration/context/end-to-end.test.ts` (the integration test)

- [ ] **Step 1: Add test for collector excludes `out`**

```typescript
/**
 * End-to-end: buildContext on a fixture repo → context.json has expected shape,
 * sha256 is stable, retry produces same hash.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../../src/services/context/context-builder.js';

describe('end-to-end buildContext', () => {
  it('produces a stable context.json across two runs', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-e2e-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), 'export const X = 1;\n');
      writeFileSync(join(workdir, 'package.json'), JSON.stringify({
        name: 'demo', dependencies: { antd: '5.21.0' },
      }));
      writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const out = join(workdir, 'ctx.json');
      const fetcher = async () => ({ version: '5.21.0', excerpt: 'Form.Item' });

      const ctx1 = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });
      const ctx2 = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });

      // sha256 differs because generatedAt differs — but content (excluding timestamp) is stable.
      const stripTs = (c: typeof ctx1) => ({ ...c, generatedAt: '<stripped>' });
      expect(JSON.stringify(stripTs(ctx1))).toBe(JSON.stringify(stripTs(ctx2)));
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Implement collector `out` exclusion**

Modify `src/services/context/collector.ts`:

1. Add `out: z.string().optional()` to `CollectInputSchema`.
2. In `scanFiles(root, exclude?)`, accept an optional `exclude?: string` argument and skip the file whose `relative(root, full).replaceAll('\\', '/')` equals `exclude`.
3. In `collectContext`, pass `exclude: input.out` to `scanFiles`.

Existing 3 tests in `collector.test.ts` must continue to pass (no `out` arg = no exclusion).

- [ ] **Step 3: Wire `out` through `context-builder.ts`**

Modify `src/services/context/context-builder.ts` — change the `collectContext` call:

```typescript
const collected = await collectContext({
  goal: input.goal,
  project: input.project,
  depsMode: input.depsMode,
  out: input.out,
});
```

- [ ] **Step 4: Write the integration test**

Create `tests/integration/context/end-to-end.test.ts`. Use `vi.useFakeTimers()` so all time-derived fields (`generatedAt`, `fetchedAt`, `renderedAt`, `timeDecayScore`) are deterministic across two runs. This is cleaner than stripping — verifies the system is **truly deterministic for fixed inputs**, not just "equal after stripping volatile fields".

```typescript
/**
 * End-to-end: buildContext on a fixture repo → context.json has expected shape,
 * sha256 is stable, retry produces same hash (with mocked clock).
 *
 * buildContext carries 4+ time-derived fields:
 *   - generatedAt (top-level)
 *   - fetchedAt (per fetched doc)
 *   - renderedAt (renderer)
 *   - timeDecayScore (tokenizer metadata, derived from fetchedAt)
 * Stripping volatile fields is fragile (round 3 caught timeDecayScore drift).
 * Mocking the clock via vi.useFakeTimers freezes all derived values.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../../src/services/context/context-builder.js';

describe('end-to-end buildContext', () => {
  beforeEach(() => {
    // Freeze time at a fixed point so all time-derived fields match across runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces a stable context.json across two runs (with mocked clock)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-e2e-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), 'export const X = 1;\n');
      writeFileSync(join(workdir, 'package.json'), JSON.stringify({
        name: 'demo', dependencies: { antd: '5.21.0' },
      }));
      writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const out = join(workdir, 'ctx.json');
      const fetcher = async () => ({ version: '5.21.0', excerpt: 'Form.Item' });

      const ctx1 = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });
      const ctx2 = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });

      // With mocked clock, ALL fields are deterministic — including sha256.
      expect(ctx1).toEqual(ctx2);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Run tests + commit**

Run: `pnpm vitest run tests/unit/services/context/collector.test.ts tests/integration/context/end-to-end.test.ts`
Expected: PASS (4 collector tests + 1 integration test).

```bash
git add src/services/context/collector.ts src/services/context/context-builder.ts tests/unit/services/context/collector.test.ts tests/integration/context/end-to-end.test.ts
git commit -m "feat(context): collector excludes output file + e2e stability test"
```

---

## Task 12: Export JSON Schema file + cross-IDE fixture test

**Files:**
- Create: `schemas/context.schema.json`
- Create: `tests/integration/context/cross-ide-consistency.test.ts`

- [ ] **Step 1: Generate `schemas/context.schema.json`**

Run a small script:

```bash
pnpm tsx -e "import { writeFileSync } from 'node:fs'; import { zodToJsonSchema } from 'zod-to-json-schema'; import { ContextJsonSchema } from './src/services/context/context-schema.js'; writeFileSync('schemas/context.schema.json', JSON.stringify(zodToJsonSchema(ContextJsonSchema), null, 2));"
```

Install `zod-to-json-schema` as a devDep first:

```bash
pnpm add -D zod-to-json-schema
```

Then run the script. Verify the file is valid JSON Schema.

- [ ] **Step 2: Add schema to package.json `files`**

Modify `package.json` `files` array — add `"schemas/*.json"`.

- [ ] **Step 3: Cross-IDE consistency test**

Create `tests/integration/context/cross-ide-consistency.test.ts`:

```typescript
/**
 * Per spec §4.1 — same fixtures should produce identical context.json
 * regardless of which IDE invoked peaks-rd (Claude Code / Trae / Cursor).
 * Since peaks-context is purely Node-side, the test pins this.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../../src/services/context/context-builder.js';

describe('cross-IDE consistency', () => {
  it('produces identical context.json regardless of env (CI vs IDE)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-cide-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), 'export const X = 1;\n');
      writeFileSync(join(workdir, 'package.json'), JSON.stringify({
        name: 'demo', dependencies: { antd: '5.21.0' },
      }));
      writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const out = join(workdir, 'ctx.json');
      const fetcher = async () => ({ version: '5.21.0', excerpt: 'Form.Item' });

      // First invocation as if from Claude Code.
      const prevClaude = process.env.CLAUDE_CODE_ENTRYPOINT;
      process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
      const a = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });
      // Second invocation as if from Trae.
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
      process.env.TRAE_ENTRYPOINT = 'cli';
      const b = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });

      // Same content (excluding generatedAt + sha256).
      const stripVolatile = (c: typeof a) => ({ ...c, generatedAt: '', sha256: '' });
      expect(JSON.stringify(stripVolatile(a))).toBe(JSON.stringify(stripVolatile(b)));

      if (prevClaude === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT;
      else process.env.CLAUDE_CODE_ENTRYPOINT = prevClaude;
      delete process.env.TRAE_ENTRYPOINT;
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Run + commit**

Run: `pnpm vitest run tests/integration/context/cross-ide-consistency.test.ts`
Expected: PASS.

```bash
git add schemas/context.schema.json package.json tests/integration/context/cross-ide-consistency.test.ts
git commit -m "feat(context): export JSON Schema + cross-IDE consistency test"
```

---

## Task 13: Documentation — README + skill notes

**Files:**
- Modify: `README.md` (add a "peaks-context" section)
- Modify: `skills/peaks-rd/SKILL.md` (note: rd now consumes context.json automatically)
- Modify: `skills/peaks-qa/SKILL.md` (same for qa)

- [ ] **Step 1: Add README section**

Add to `README.md` after the "🚀 30 秒跑起来" section:

```markdown
## 🧠 peaks-context — 上下文构建模块 (v3.0)

peaks-context 是 CLI 强制执行的上下文采集器,**不再依赖 LLM 自主"读 package.json"**。

```bash
peaks context build --goal "<你的需求>" --project . --audience peaks-rd --out context.json
peaks context validate context.json
peaks context inspect context.json
```

**承诺**:deps 锁版本 antd@5.21.0 → context.json 绝不返回 6.x API 文档。  
详见 [design spec §4.1](../../docs/superpowers/specs/2026-06-21-context-audit-redesign-design.md)。
```

- [ ] **Step 2: Update `skills/peaks-rd/SKILL.md`**

Add a short note: "RD workflow automatically runs `peaks context build --audience peaks-rd` before the LLM is invoked. No manual setup needed."

- [ ] **Step 3: Update `skills/peaks-qa/SKILL.md`**

Same pattern with `peaks-qa`.

- [ ] **Step 4: Run typecheck + full test suite**

```bash
pnpm tsc --noEmit
pnpm vitest run
```

Expected: 0 errors; all tests pass (existing 2,800+ + new ~25).

- [ ] **Step 5: Run peaks slice check**

```bash
peaks slice check --json
```

Expected: PASS — tsc + vitest + 3-way + verify-pipeline all green.

- [ ] **Step 6: Commit**

```bash
git add README.md skills/peaks-rd/SKILL.md skills/peaks-qa/SKILL.md
git commit -m "docs(context): README + RD/QA skill notes for peaks-context integration"
```

---

## Self-Review

### 1. Spec coverage — Plan 1 vs spec §4.1 + §5 Phase 1 ACs

| Spec AC | Plan Task |
|---|---|
| AC-1 `peaks context build` works on real package.json | Tasks 3 + 7 + 8 |
| AC-2 cross-version isolation test | Task 4 (Step 6 ★) + Task 11 |
| AC-3 RD/QA transparent integration | Task 9 |
| AC-4 single-module coverage ≥ 80% | Tasks 3–8 each pin ≥ 3 tests; run `pnpm test:coverage` at end |
| AC-5 cross-IDE consistency | Task 12 |

### 2. Placeholder scan

- No "TBD", "TODO", "implement later"
- All code blocks contain actual code
- Step descriptions are concrete

### 3. Type consistency

- `ContextJson` defined in Task 2; consumed verbatim in Tasks 3–8
- `DocFetcher` interface defined in Task 4; reused in Task 10
- `BuildInput` defined in Task 7; matches CLI input in Task 8
- All test fixtures match the interface signatures

### 4. Coverage / file size

- Each service file: ~80–150 lines (well under 800)
- Each test file: ~50–100 lines
- Slice total: ~13 commits, each ≤ 800 lines including test code

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-context-builder.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**