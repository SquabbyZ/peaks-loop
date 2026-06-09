# QA Test Cases: 003-2026-06-04-solo-step-0-7-resume

- session: 2026-06-04-session-b60252
- rid: 003-2026-06-04-solo-step-0-7-resume
- type: refactor

## Test cases

```ts
// TC-1: fresh session, no .peaks/<sid>/ → "fresh"
test('fresh session: no .peaks/<sid>/ → "fresh"', () => {
  const result = execFileSync('bash', [SCRIPT, '2026-06-04-session-aaaaaa', tmpRoot]).toString().trim();
  expect(result).toBe('fresh');
});

// TC-2: empty .peaks/<sid>/ → "fresh"
test('fresh session: .peaks/<sid>/ exists but empty → "fresh"', () => {
  mkdirSync(join(tmpRoot, '2026-06-04-session-aaaaaa'), { recursive: true });
  const result = execFileSync('bash', [SCRIPT, '2026-06-04-session-aaaaaa', tmpRoot]).toString().trim();
  expect(result).toBe('fresh');
});

// TC-3: PRD handed-off, no RD → "resume:rd-planning"
test('PRD handed-off, no RD → "resume:rd-planning"', () => {
  writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
  const result = execFileSync('bash', [SCRIPT, '2026-06-04-session-aaaaaa', tmpRoot]).toString().trim();
  expect(result).toBe('resume:rd-planning');
});

// TC-4: RD qa-handoff, no QA → "resume:qa-validation"
test('RD qa-handoff, no QA → "resume:qa-validation"', () => {
  writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
  writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'qa-handoff');
  const result = execFileSync('bash', [SCRIPT, '2026-06-04-session-aaaaaa', tmpRoot]).toString().trim();
  expect(result).toBe('resume:qa-validation');
});

// TC-5: QA verdict-issued, no TXT → "resume:txt-handoff"
test('QA verdict-issued, no TXT → "resume:txt-handoff"', () => {
  writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
  writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'qa-handoff');
  writeArtifact('2026-06-04-session-aaaaaa/qa/requests/001.md', 'verdict-issued');
  const result = execFileSync('bash', [SCRIPT, '2026-06-04-session-aaaaaa', tmpRoot]).toString().trim();
  expect(result).toBe('resume:txt-handoff');
});

// TC-6: TXT handoff present → "complete"
test('TXT handoff present → "complete"', () => {
  writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
  writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'qa-handoff');
  writeArtifact('2026-06-04-session-aaaaaa/qa/requests/001.md', 'verdict-issued');
  writeArtifact('2026-06-04-session-aaaaaa/txt/handoff.md', 'complete');
  const result = execFileSync('bash', [SCRIPT, '2026-06-04-session-aaaaaa', tmpRoot]).toString().trim();
  expect(result).toBe('complete');
});

// TC-7: in-flight RD: state=running → in-flight marker
test('in-flight RD: state=running → in-flight marker', () => {
  writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
  writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'running');
  const result = execFileSync('bash', [SCRIPT, '2026-06-04-session-aaaaaa', tmpRoot]).toString().trim();
  expect(result).toBe('in-flight:running');
});

// TC-8: determinism: same fixture twice → same classification
test('determinism: same fixture twice → same classification', () => {
  writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
  writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'qa-handoff');
  const first = execFileSync('bash', [SCRIPT, '2026-06-04-session-aaaaaa', tmpRoot]).toString().trim();
  const second = execFileSync('bash', [SCRIPT, '2026-06-04-session-aaaaaa', tmpRoot]).toString().trim();
  expect(first).toBe(second);
});
```

## Test case summary

| TC | Description | Method | Result | Evidence |
|----|-------------|--------|--------|----------|
| TC-1 | Fresh session: no .peaks/<sid>/ | `execFileSync` bash script | pass | "fresh" |
| TC-2 | Empty .peaks/<sid>/ | `execFileSync` bash script | pass | "fresh" |
| TC-3 | PRD handed-off, no RD | `execFileSync` bash script | pass | "resume:rd-planning" |
| TC-4 | RD qa-handoff, no QA | `execFileSync` bash script | pass | "resume:qa-validation" |
| TC-5 | QA verdict-issued, no TXT | `execFileSync` bash script | pass | "resume:txt-handoff" |
| TC-6 | TXT handoff present | `execFileSync` bash script | pass | "complete" |
| TC-7 | In-flight RD: state=running | `execFileSync` bash script | pass | "in-flight:running" |
| TC-8 | Determinism | 2x `execFileSync` bash script | pass | identical outputs |

## Mandatory validation gates

- **unit tests**: `pnpm vitest run` → 1772/1772 pass + 5 skipped (per the test report)
- **API validation**: N/A — no API surface change
- **browser E2E**: N/A — `frontendOnly=true` for this repo but no user-visible behavior change
- **security check**: see `.peaks/2026-06-04-session-b60252/qa/security-findings.md` (verdict: pass, 0 CRITICAL/HIGH/MEDIUM, 1 LOW)
- **performance check**: see `.peaks/2026-06-04-session-b60252/qa/performance-findings.md` (verdict: N/A)
- **validation report path**: `.peaks/2026-06-04-session-b60252/qa/test-reports/003-2026-06-04-solo-step-0-7-resume.md`

## Regression matrix

| Surface | Test | Result | Evidence |
|---|---|---|---|
| Fresh session | TC-1 | pass | "fresh" |
| Empty .peaks | TC-2 | pass | "fresh" |
| PRD handed-off | TC-3 | pass | "resume:rd-planning" |
| RD qa-handoff | TC-4 | pass | "resume:qa-validation" |
| QA verdict-issued | TC-5 | pass | "resume:txt-handoff" |
| Complete workflow | TC-6 | pass | "complete" |
| In-flight RD | TC-7 | pass | "in-flight:running" |
| Determinism | TC-8 | pass | identical outputs |
| typecheck | full | pass | 0 errors |
| Full vitest suite | full | pass | 1772/1772 + 5 skipped |
| Manual dogfood (3 scenarios) | manual | pass | all expected classifications |

## Verdict

**overall: pass** (8/8 test cases pass, 0 CRITICAL/HIGH/MEDIUM security findings, 0 perf surface, no regression)
