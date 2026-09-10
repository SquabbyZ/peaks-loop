// tests/unit/cli/commands/best-practice-scan-command.test.ts
//
// The D3 honesty fix, driven through commander against a MOCKED scan
// orchestrator. Two seams are exercised, and they must not be confused:
//
//   - synthetic path  — the built-in stub lookups (the production v1 default,
//                       reproduced here by calling the REAL orchestrator with
//                       no injected lookup) must refuse: no recommendation, no
//                       comparison table, no catch gate, exit non-zero.
//   - injected path   — a caller-injected real lookup must still render the
//                       full table, gate it, and exit 0. The fixture for this
//                       is built by calling the REAL orchestrator with an
//                       injected lookup, so the `synthetic` flag under test is
//                       the one the orchestrator actually produces.
//
// Dimensions covered:
//   - render:      refusal text / full table on stdout, --json envelope
//   - behavior:    --intent requirement, the intent handed to the scan
//   - a11y:        exit codes and the human-facing skip statement
//   - integration: the on-disk skip record / artifact

import { Command } from 'commander';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { registerBestPracticeScanCommand } from '../../../../src/cli/commands/best-practice-scan-command.js';
import { scanBestPractice } from '../../../../src/services/best-practice/scan-orchestrator.js';

declareDimensions('tests/unit/cli/commands/best-practice-scan-command.test.ts', [
  'render',
  'behavior',
  'a11y',
  'integration',
]);

vi.mock('../../../../src/services/best-practice/scan-orchestrator.js', () => ({
  scanBestPractice: vi.fn(),
}));

const scanMock = vi.mocked(scanBestPractice);
const realOrchestrator = await vi.importActual<
  typeof import('../../../../src/services/best-practice/scan-orchestrator.js')
>('../../../../src/services/best-practice/scan-orchestrator.js');

const INTENT = 'add a caching layer';
const STDIN_SEAM = 'PEAKS_BEST_PRACTICE_STDIN';

let projectRoot: string;
let exitBefore: typeof process.exitCode;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'bps-command-'));
  scanMock.mockReset();
  exitBefore = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = exitBefore;
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

async function runCli(args: readonly string[]): Promise<ReturnType<typeof makeCapturedIo>['captured']> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerBestPracticeScanCommand(program, io);
  await program.parseAsync(['best-practice-scan', ...args], { from: 'user' });
  return captured;
}

/** A synthetic result, produced by the REAL orchestrator's stub chain. */
function syntheticScan() {
  return realOrchestrator.scanBestPractice({
    intent: INTENT,
    language: 'typescript',
    projectRoot,
    io: makeCapturedIo().io,
  });
}

/** A real result, produced by the REAL orchestrator with an injected lookup. */
function injectedLookupScan() {
  return realOrchestrator.scanBestPractice({
    intent: INTENT,
    language: 'typescript',
    projectRoot,
    io: makeCapturedIo().io,
    context7Lookup: async () => ({
      ok: true,
      results: [
        { title: 'Caching best practices', url: 'https://docs.example.com/cache', snippet: 'real fragment A' },
        { title: 'Cache invalidation', url: 'https://docs.example.com/cache-2', snippet: 'real fragment B' },
      ],
    }),
  });
}

describe('render — refusal for a synthetic scan', () => {
  it('when the scan is synthetic, should print the skip statement and no recommendation table', async () => {
    // given: the stub chain answers (no injected lookup) — a synthetic scan
    scanMock.mockResolvedValue(await syntheticScan());

    // when: the command runs non-interactively
    const captured = await runCli(['--intent', INTENT, '--project', projectRoot, '--lang', 'typescript']);

    // then: no fabricated presentation survives — no ★, no recommendation, no table, no gate
    const out = captured.text();
    expect(out).toContain('SKIPPED — synthetic (stub) lookup');
    expect(out).toContain('No real documentation lookup was performed.');
    expect(out).not.toContain('★');
    expect(out).not.toContain('方案 A');
    expect(out).not.toContain('| **技术组合(通俗)** |');
    expect(out).not.toContain('LLM 推荐');
    expect(out).not.toContain('接受方案 A');
    expect(out).not.toContain('catch-gate outcome');
  });
});

describe('behavior — the intent is required and reaches the scan', () => {
  it('when --intent is omitted, should fail with INTENT_REQUIRED and never scan', async () => {
    // given: no --intent flag
    // when: the command runs
    const captured = await runCli(['--project', projectRoot, '--json']);

    // then: it fails loudly instead of falling back to the project path
    expect(captured.text()).toContain('"code": "BEST_PRACTICE_SCAN_INTENT_REQUIRED"');
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('when --intent is given, should hand the intent (not the project path) to the scan', async () => {
    // given: a synthetic scan stub
    scanMock.mockResolvedValue(await syntheticScan());

    // when: the command runs with an intent
    await runCli(['--intent', INTENT, '--project', projectRoot, '--lang', 'typescript']);

    // then: the scan received the business goal as its intent
    expect(scanMock).toHaveBeenCalledTimes(1);
    const scanArgs = scanMock.mock.calls[0]?.[0];
    expect(scanArgs?.intent).toBe(INTENT);
    expect(scanArgs?.intent).not.toBe(projectRoot);
    expect(scanArgs?.projectRoot).toBe(projectRoot);
  });
});

describe('a11y — exit codes for the synthetic refusal', () => {
  it('when the scan is synthetic, should exit non-zero and name the code on stderr', async () => {
    // given: a synthetic scan
    scanMock.mockResolvedValue(await syntheticScan());

    // when: the command runs
    const captured = await runCli(['--intent', INTENT, '--project', projectRoot, '--lang', 'typescript']);

    // then: an automated caller cannot read this as satisfied
    expect(process.exitCode).toBe(1);
    expect(captured.stderrText()).toContain('BEST_PRACTICE_SCAN_SYNTHETIC_LOOKUP');
  });

  it('when the scan is synthetic with --json, should emit a skipped envelope marking Step 2.5', async () => {
    // given: a synthetic scan
    scanMock.mockResolvedValue(await syntheticScan());

    // when: the command runs with --json
    const captured = await runCli(['--intent', INTENT, '--project', projectRoot, '--lang', 'typescript', '--json']);

    // then: the envelope is ok:false with the synthetic skip recorded
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain('"code": "BEST_PRACTICE_SCAN_SYNTHETIC_LOOKUP"');
    expect(captured.text()).toContain('"synthetic": true');
    expect(captured.text()).toContain('"step25": "skipped-synthetic-lookup"');
  });
});

describe('integration — the skip is recorded, a real lookup still renders', () => {
  it('when the scan is synthetic, should record the skip under the intent slug', async () => {
    // given: a synthetic scan
    scanMock.mockResolvedValue(await syntheticScan());
    const artifactPath = join(projectRoot, 'best-practice', `${new Date().toISOString().slice(0, 10)}-add-a-caching-layer.md`);

    // when: the command runs
    await runCli(['--intent', INTENT, '--project', projectRoot, '--lang', 'typescript']);

    // then: the reason is on disk (the fire-and-forget caller discards stdout)
    expect(existsSync(artifactPath)).toBe(true);
    const written = readFileSync(artifactPath, 'utf8');
    expect(written).toContain('SKIPPED — synthetic (stub) lookup');
    expect(written).not.toContain('★');
  });

  it('when a real lookup answers, should render the full gated table and exit 0', async () => {
    // given: a real scan (injected lookup) and empty stdin so the gate auto-accepts
    const realScan = await injectedLookupScan();
    expect(realScan.synthetic).toBe(false);
    scanMock.mockResolvedValue(realScan);
    withEnv(STDIN_SEAM, '');
    const artifactPath = join(projectRoot, 'best-practice', `${new Date().toISOString().slice(0, 10)}-add-a-caching-layer.md`);

    // when: the command runs
    const captured = await runCli(['--intent', INTENT, '--project', projectRoot, '--lang', 'typescript']);

    // then: the full table, the recommendation, the gate and a 0 exit code are all still there
    const out = captured.text();
    expect(process.exitCode).toBe(0);
    expect(out).toContain('# Best-Practice Scan — add a caching layer');
    expect(out).toContain('**方案 A ★**');
    expect(out).toContain('| **LLM 推荐** |');
    expect(out).toContain('fragments: 2');
    expect(out).toContain('⚠️ 任何跟你真实业务不一样,改 — LLM 推荐可能错。');
    expect(out).toContain('catch-gate outcome: accept');
    expect(out).not.toContain('SKIPPED');
    expect(readFileSync(artifactPath, 'utf8')).toContain('**方案 A ★**');
  });
});
