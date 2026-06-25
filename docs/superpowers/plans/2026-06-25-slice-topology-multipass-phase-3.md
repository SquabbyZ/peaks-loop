<!--
Extracted from: 2026-06-25-slice-topology-multipass.md (1626-line original, split on 2026-06-25 post Wave 1)
Section: Phase 3: CLI Integration
Original lines: 1140-1211
This file is part of the slice-topology-multipass plan split.
See the index at ./2026-06-25-slice-topology-multipass.md for navigation.
-->

## Phase 3: CLI Integration

### Task 10: Add --granularity flag to peaks slice decompose

**Files:**
- Modify: `src/cli/commands/slice-decompose.ts`

- [ ] **Step 1: Locate existing CLI command, identify flag pattern**

Run: `grep -n "granularity\|--granularity" src/cli/commands/slice-decompose.ts`

- [ ] **Step 2: Write failing test for --granularity=both**

```typescript
// tests/integration/cli-slice-decompose.test.ts (or extend existing)
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('peaks slice decompose --granularity', () => {
  it('accepts --granularity=both', () => {
    const result = execSync('peaks slice decompose --rid test --granularity=both --json', { encoding: 'utf8' });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Add flag definition + handler in slice-decompose.ts**

```typescript
.option('--granularity <value>', 'service | file | both | auto', 'both')
.action(async (rid, options) => {
  const valid = ['service', 'file', 'both', 'auto'];
  if (!valid.includes(options.granularity)) throw new Error(`Invalid --granularity: ${options.granularity}`);
  // call multi-pass-orchestrator.decompose(rid, prd, root, { granularity: options.granularity })
});
```

- [ ] **Step 4: Run test, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/slice-decompose.ts tests/integration/
git commit --author="SquabbyZ <601709253@qq.com>" -m "feat(cli): add --granularity flag to peaks slice decompose"
```

### Task 11: peaks slice pick / plan use SchemaRouter

**Files:**
- Modify: `src/services/slice/slice-pick-service.ts`
- Modify: `src/services/slice/slice-plan-service.ts`

- [ ] **Step 1: Locate existing read of decomposition JSON file**

Run: `grep -n "readFileSync\|JSON.parse" src/services/slice/slice-pick-service.ts`

- [ ] **Step 2: Replace raw JSON.parse with `readResult()`**

- [ ] **Step 3: Update tests for SchemaRouter behavior** (v1 still works, v2 works)

- [ ] **Step 4: Run tests, verify PASS**

- [ ] **Step 5: Commit**

```bash
git add src/services/slice/slice-pick-service.ts src/services/slice/slice-plan-service.ts tests/
git commit --author="SquabbyZ <601709253@qq.com>" -m "refactor(slice): peaks slice pick/plan use SchemaRouter for v1/v2"
```

---

