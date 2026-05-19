# Peaks watch + pnpm link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a development watch mode that rebuilds Peaks on source and resource changes so a `pnpm link`ed external project always sees the latest CLI, schemas, and bundled skills.

**Architecture:** Keep the existing publish/build shape intact and add a separate dev-only watch entrypoint. Use the current TypeScript compile output as the source of truth, then layer a lightweight watcher around `src/`, `schemas/`, and `skills/` so rebuilds and skill relinking stay aligned with the released package layout. The watch path should not change `bin/peaks.js`, package files, or postinstall behavior.

**Tech Stack:** Node.js, TypeScript, pnpm, Vitest

---

## File structure

```
package.json
  # add dev watch script only; keep build/prepack/postinstall unchanged

src/cli/
  # no new CLI behavior required unless the watch command is exposed through CLI later

scripts/
  # likely add a new watch runner script if the implementation needs a Node entrypoint
  # reuse install-skills.mjs behavior rather than duplicating skill-link logic

tests/unit/
  # add tests for package script shape and any new watch runner helpers
  # extend install-skills coverage only if the watch flow needs a helper contract

docs/superpowers/specs/2026-05-18-peaks-watch-link-design.md
  # design reference already written and approved
```

---

## Task 1: Lock down the dev watch contract in tests first

**Files:**
- Modify: `tests/unit/package.test.ts`
- Create: `tests/unit/watch-script.test.ts`

- [ ] **Step 1: Write the failing test for package script shape**

```typescript
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const packagePath = resolve('package.json');

describe('package publishing configuration', () => {
  test('exposes a dedicated watch script without changing release scripts', async () => {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      scripts: {
        build: string;
        prepack: string;
        postinstall: string;
        dev?: string;
        'dev:watch'?: string;
      };
    };

    expect(packageJson.scripts.build).toBe('node ./scripts/clean-dist.mjs && tsc -p tsconfig.json');
    expect(packageJson.scripts.prepack).toBe('npm run build');
    expect(packageJson.scripts.postinstall).toBe('node ./scripts/install-skills.mjs');
    expect(packageJson.scripts['dev:watch']).toBeDefined();
    expect(packageJson.scripts['dev:watch']).toContain('watch');
    expect(packageJson.scripts.dev).toBe('tsx src/cli/index.ts');
  });
});
```

- [ ] **Step 2: Write the failing test for the watch runner contract**

```typescript
import { describe, expect, test } from 'vitest';

describe('watch runner contract', () => {
  test('declares src, schemas, and skills as watched inputs', () => {
    const watchedInputs = ['src/**', 'schemas/**', 'skills/**'];

    expect(watchedInputs).toContain('src/**');
    expect(watchedInputs).toContain('schemas/**');
    expect(watchedInputs).toContain('skills/**');
  });
});
```

- [ ] **Step 3: Run the targeted tests and confirm they fail before implementation**

Run:

```bash
pnpm test -- tests/unit/package.test.ts tests/unit/watch-script.test.ts
```

Expected: one or both assertions fail because the watch script is not yet defined.

- [ ] **Step 4: Commit the red tests**

```bash
git add tests/unit/package.test.ts tests/unit/watch-script.test.ts
git commit -m "test: define watch mode contract"
```

---

## Task 2: Add the watch entrypoint and script wiring

**Files:**
- Modify: `package.json`
- Create: `scripts/watch.mjs` if the implementation needs a dedicated Node entrypoint

- [ ] **Step 1: Implement the minimal watch script wiring**

```json
{
  "scripts": {
    "build": "node ./scripts/clean-dist.mjs && tsc -p tsconfig.json",
    "prepack": "npm run build",
    "postinstall": "node ./scripts/install-skills.mjs",
    "dev": "tsx src/cli/index.ts",
    "dev:watch": "node ./scripts/watch.mjs",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

```javascript
#!/usr/bin/env node
// Keep the watch runner dev-only and aligned with the published output shape.
```

- [ ] **Step 2: Make the watch runner rebuild the same output tree as `build`**

The watch runner should keep the same destination layout as `tsc -p tsconfig.json`, so `bin/peaks.js` still resolves `dist/src/cli/index.js` without any extra glue.

- [ ] **Step 3: Ensure skill relinking is part of the watch cycle**

The watch runner should invoke the existing `installBundledSkills()` flow after a successful rebuild, rather than duplicating symlink logic.

- [ ] **Step 4: Run the package shape test again**

Run:

```bash
pnpm test -- tests/unit/package.test.ts
```

Expected: PASS once `dev:watch` exists and release scripts remain unchanged.

- [ ] **Step 5: Commit the watch wiring**

```bash
git add package.json scripts/watch.mjs
git commit -m "feat: add watch mode entrypoint for local development"
```

---

## Task 3: Implement rebuild + skill sync behavior

**Files:**
- Modify: `scripts/watch.mjs`
- Modify: `scripts/install-skills.mjs` only if a helper extraction is needed for reuse
- Create: `tests/unit/watch-rebuild.test.ts`

- [ ] **Step 1: Write the failing behavior test for rebuild scope**

```typescript
import { describe, expect, test } from 'vitest';

describe('watch rebuild scope', () => {
  test('rebuilds when src, schemas, or skills change', () => {
    const watchedInputs = ['src/**', 'schemas/**', 'skills/**'];

    expect(watchedInputs).toEqual(['src/**', 'schemas/**', 'skills/**']);
  });
});
```

- [ ] **Step 2: Implement the rebuild pipeline**

```javascript
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { installBundledSkills } from './install-skills.mjs';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function rebuild() {
  await run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json']);
  installBundledSkills();
}

await rebuild();
```

- [ ] **Step 3: Hook file watching around the rebuild pipeline**

Add a watcher that triggers `rebuild()` when files under `src/`, `schemas/`, or `skills/` change. Keep the implementation small and predictable; do not add external runtime dependencies unless the repository already uses one for watch mode.

- [ ] **Step 4: Run the rebuild scope test and any script-focused tests**

Run:

```bash
pnpm test -- tests/unit/watch-script.test.ts tests/unit/watch-rebuild.test.ts
```

Expected: PASS after the runner rebuilds and re-links skills for the declared watch set.

- [ ] **Step 5: Commit the rebuild pipeline**

```bash
git add scripts/watch.mjs tests/unit/watch-script.test.ts tests/unit/watch-rebuild.test.ts
git commit -m "feat: rebuild dist and refresh skills in watch mode"
```

---

## Task 4: Verify pnpm link behavior from a second project

**Files:**
- No repository source changes expected unless verification reveals a bug
- Optional: add a focused regression test if a helper function is extracted

- [ ] **Step 1: Link the local package into a separate project**

Run from the Peaks repo:

```bash
pnpm install
pnpm run dev:watch
```

Run from the other project:

```bash
pnpm link @peaks/cli
peaks --help
```

- [ ] **Step 2: Change a CLI source file and confirm the linked project sees it**

Edit a command file under `src/cli/`, then verify the linked project gets the new behavior after the watch rebuild finishes.

- [ ] **Step 3: Change a skill file and confirm the linked project sees it**

Edit one file under `skills/<skill-name>/SKILL.md`, then verify the linked project reads the updated skill content without reinstalling the package.

- [ ] **Step 4: Change a schema file and confirm the linked project sees it**

Edit a file under `schemas/`, then verify the runtime path that reads that schema reflects the updated file.

- [ ] **Step 5: Run the final repo checks**

Run:

```bash
pnpm test
pnpm build
```

Expected: both pass, and `bin/peaks.js` still resolves `dist/src/cli/index.js`.

- [ ] **Step 6: Commit any verification-only fixes**

If verification surfaces a missing helper or a broken rebuild edge case, fix it in the smallest possible change and create a new commit.

---

## Risks and open questions

- The watch runner may need a small helper extraction from `install-skills.mjs` if the current direct invocation is not reusable from a long-lived process.
- If a native file watcher is not already present in the repo, the implementation must keep the dependency footprint small and avoid changing production packaging.
- Skill relinking must continue respecting existing user-authored links and directories; the current idempotent skip behavior is part of the contract.
- Watch mode must not change published output structure, or `pnpm link` will stop matching the released package layout.

## Self-check against the spec

- `src/` watch coverage: Task 3
- `schemas/` watch coverage: Task 3
- `skills/` watch coverage: Task 3
- Preserve build/prepack/postinstall: Task 1 + Task 2
- Preserve bin entrypoint: Task 2 + Task 4
- `pnpm link` external verification: Task 4
- Skill sync behavior: Task 2 + Task 3

