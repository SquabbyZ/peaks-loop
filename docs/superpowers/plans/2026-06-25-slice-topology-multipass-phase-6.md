<!--
Extracted from: 2026-06-25-slice-topology-multipass.md (1626-line original, split on 2026-06-25 post Wave 1)
Section: Phase 6: Integration + Final Verification
Original lines: 1490-1590
This file is part of the slice-topology-multipass plan split.
See the index at ./2026-06-25-slice-topology-multipass.md for navigation.
-->

## Phase 6: Integration + Final Verification

### Task 20: End-to-end integration test against peaks-cli real codebase

**Files:**
- Create: `tests/integration/slice-topology-e2e.test.ts`

- [ ] **Step 1: Write e2e test that runs `MultiPassOrchestrator.decompose()` against `src/services/config/` and asserts v2 output structure**

```typescript
import { describe, it, expect } from 'vitest';
import { decompose } from '../../../src/services/slice/multi-pass-orchestrator.js';

describe('slice-topology e2e', () => {
  it('produces v2 output for peaks-cli config service', async () => {
    const result = await decompose(
      'e2e-test',
      'Split config-service into smaller modules',
      process.cwd(),
      { granularity: 'both' }
    );
    expect(result.schemaVersion).toBe('v2');
    expect(result.passes.length).toBeGreaterThanOrEqual(1);
  }, { timeout: 30000 });
});
```

- [ ] **Step 2: Run test, verify PASS** (may take 5-30s due to file I/O)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/slice-topology-e2e.test.ts
git commit --author="SquabbyZ <601709253@qq.com>" -m "test(integration): e2e for slice topology multi-pass"
```

### Task 21: Mutation probes (3 total, per peaks-cli Plan 4 convention)

**Files:**
- Modify: existing tests to include mutation probe assertions

- [ ] **Step 1: Probe A** — comment out `cross-pass-edge-merger.ts` type-shares detection. Assert ≥ 1 integration test fails. Revert.

- [ ] **Step 2: Probe B** — change `granularity-decider.ts` `>` to `>=`. Assert ≥ 1 fixture test fails. Revert.

- [ ] **Step 3: Probe C** — remove `llm-arbitrator.ts` cache lookup. Assert cache-hit latency test fails. Revert.

- [ ] **Step 4: Document probe results** in `.peaks/_runtime/<sid>/audit/mutation-probes-<rid>.md`

- [ ] **Step 5: Commit probe docs**

```bash
git add .peaks/_runtime/.../mutation-probes-*.md
git commit --author="SquabbyZ <601709253@qq.com>" -m "test(audit): 3 mutation probes pass for slice-topology-multipass"
```

### Task 22: CHANGELOG + standards update + PR

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `.peaks/standards/` (if any slice-decompose reference exists)

- [ ] **Step 1: Add CHANGELOG entry under next version (e.g., 2.10.0)**

```markdown
## 2.10.0 (2026-06-25)

### Added

- **Multi-pass slice decomposition** (`peaks slice decompose --granularity=service|file|both|auto`): produces a v2 hierarchical topology that supports peaks-solo fan-out RD. v2 schema is breaking vs v1; v1 remains readable via SchemaRouter.
- **Audit + Goal primitive**: 6-dim audit + goal proposal between human need expression and autonomous LLM execution.
- **Final Review primitive**: 4-dim business review at delivery (functional completeness, problem resolution, no new bugs, existing functionality intact).
- **Handoff frontmatter schema**: YAML frontmatter for structured fields + markdown body for prose.
- **New skills**: `peaks-slice-decompose`, `peaks-audit`, `peaks-final-review`.
- **Updated skills**: `peaks-solo` (audit + final review gates), `peaks-rd` (v2 reading + frontmatter writing), `peaks-qa` (frontmatter reading), `peaks-prd` (multi-pass AC), `peaks-sc` (decompose reference).
```

- [ ] **Step 2: Push feature branch to origin**

```bash
git push -u origin feature/slice-topology-multipass
```

- [ ] **Step 3: Open PR against develop** (GitHub CLI if available)

```bash
gh pr create --base develop --head feature/slice-topology-multipass \
  --title "feat: slice topology multi-pass + 10/90 paradigm" \
  --body "Implements add-slice-topology-multipass spec (openspec/changes/add-slice-topology-multipass/). 10% human / 90% LLM autonomous workflow foundation."
```

- [ ] **Step 4: Commit any final docs**

```bash
git add CHANGELOG.md
git commit --author="SquabbyZ <601709253@qq.com>" -m "docs(changelog): v2.10.0 entry for slice-topology-multipass"
git push
```

---

