import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  registerDesignAuditCommand,
  runDesignAudit
} from '../../../src/cli/commands/design-audit-command.js';
import { MAX_SOURCE_BYTES } from '../../../src/services/design/file-cap.js';

declareDimensions('tests/unit/cli/design-audit-commands.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const roots: string[] = [];
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  savedExitCode = process.exitCode;
});
afterEach(() => {
  process.exitCode = savedExitCode;
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** A writable copy of a fixture tree: the command writes into `design/`. */
function copyTree(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-audit-'));
  roots.push(root);
  cpSync(join(FIXTURES, name), root, { recursive: true });
  return root;
}

function auditCommand(): Command {
  const program = new Command();
  registerDesignAuditCommand(program.command('design'), makeCapturedIo().io);
  const design = program.commands[0];
  const audit = design?.commands.find((command) => command.name() === 'audit');
  if (audit === undefined) throw new Error('design audit is not registered');
  return audit;
}

type Envelope = {
  ok: boolean;
  command: string;
  code?: string;
  data: {
    contract: unknown;
    state: unknown;
    pages: Array<{ path: string; score: number; dimensions: unknown[] }>;
    topFixes: unknown[];
    unmeasured: unknown[];
    verdict: string;
  };
};

describe('Scenario: render — the audit command exposes its flags and envelope', () => {
  it('when the command help renders, should list project, rid and json', () => {
    // given: the registered design audit command
    // when: its help is rendered
    // then: the three documented flags appear
    const help = auditCommand().helpInformation();
    expect(help).toContain('--project <path>');
    expect(help).toContain('--rid <rid>');
    expect(help).toContain('--json');
  });

  it('when the audit runs as JSON, should print the stable envelope data', async () => {
    // given: a copy of the three-page fixture and a captured sink
    // when: the audit runs with --json
    // then: the envelope carries exactly the documented data keys
    const root = copyTree('three-page-tree');
    const { io, captured } = makeCapturedIo();
    await runDesignAudit({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as Envelope;
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('design.audit');
    expect(Object.keys(parsed.data).sort()).toEqual([
      'contract',
      'dimensions',
      'knownGaps',
      'overall',
      'pages',
      'scope',
      'state',
      'topFixes',
      'unmeasured',
      'verdict'
    ]);
    expect(parsed.data.verdict).toBe('findings');
    expect(parsed.data.pages).toHaveLength(3);
  });
});

describe('Scenario: behavior — findings never fail, a missing contract does', () => {
  it('when the tree has findings, should exit zero because the audit is advisory', async () => {
    // given: the fixture whose worst page is 80
    // when: the audit runs
    // then: it exits 0 and still reports hard findings
    const root = copyTree('three-page-tree');
    const { io } = makeCapturedIo();
    await runDesignAudit({ project: root, json: true }, io);
    expect(process.exitCode).toBe(0);
  });

  it('when the UI tree has no contract, should exit 2 with the named reason', async () => {
    // given: a `.tsx` tree without `design/`
    // when: the audit runs
    // then: it refuses with DESIGN_AUDIT_CONTRACT_MISSING and exit 2
    const root = copyTree('no-contract-tree');
    const { io, captured } = makeCapturedIo();
    await runDesignAudit({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as Envelope;
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_AUDIT_CONTRACT_MISSING');
    expect(process.exitCode).toBe(2);
  });

  it('when the contract is past the byte cap, should exit 2 with the named reason', async () => {
    // given: a fixture copy whose tokens.json is one byte past the cap
    // when: the audit runs as JSON
    // then: it refuses with DESIGN_AUDIT_CONTRACT_TOO_LARGE and exit 2
    const root = copyTree('three-page-tree');
    writeFileSync(join(root, 'design', 'tokens.json'), 'x'.repeat(MAX_SOURCE_BYTES + 1), 'utf8');
    const { io, captured } = makeCapturedIo();
    await runDesignAudit({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as Envelope;
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_AUDIT_CONTRACT_TOO_LARGE');
    expect(process.exitCode).toBe(2);
  });

  it('when the tree is not a UI project, should exit 0 with no score and no pass', async () => {
    // given: a `.ts`-only tree with no contract
    // when: the audit runs
    // then: the verdict is not-a-ui-project and it is not a clean pass
    const root = copyTree('non-ui-tree');
    const { io, captured } = makeCapturedIo();
    await runDesignAudit({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as Envelope;
    expect(parsed.ok).toBe(true);
    expect(parsed.data.verdict).toBe('not-a-ui-project');
    expect(parsed.data.pages).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it('when the only UI files are a shipped example, should not refuse for a missing contract', async () => {
    // given: a tree whose only `.tsx`/`.css` files are under `examples/`
    // when: the audit runs
    // then: it is not a UI project — an example tree is not the product UI
    const root = copyTree('non-ui-examples-tree');
    const { io, captured } = makeCapturedIo();
    await runDesignAudit({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as Envelope;
    expect(parsed.ok).toBe(true);
    expect(parsed.data.verdict).toBe('not-a-ui-project');
    expect(parsed.data.pages).toEqual([]);
    expect(process.exitCode).toBe(0);
  });
});

describe('Scenario: integration — only the non-JSON path writes the pair', () => {
  it('when --json is given, should write nothing', async () => {
    // given: a writable copy of the fixture tree
    // when: the audit runs as JSON
    // then: no audit file appears under design/
    const root = copyTree('three-page-tree');
    const { io } = makeCapturedIo();
    await runDesignAudit({ project: root, json: true }, io);
    expect(existsSync(join(root, 'design', 'audit.md'))).toBe(false);
    expect(existsSync(join(root, 'design', 'audit-r7.md'))).toBe(false);
  });

  it('when --rid is given without --json, should write the named pair', async () => {
    // given: a writable copy of the fixture tree and a rid
    // when: the audit runs as text
    // then: audit-r7.md and audit-r7.json exist
    const root = copyTree('three-page-tree');
    const { io } = makeCapturedIo();
    await runDesignAudit({ project: root, rid: 'r7', json: false }, io);
    expect(existsSync(join(root, 'design', 'audit-r7.md'))).toBe(true);
    expect(existsSync(join(root, 'design', 'audit-r7.json'))).toBe(true);
    expect(process.exitCode).toBe(0);
  });
});

describe('Scenario: a11y — the text path tells the person where the report landed', () => {
  it('when the audit runs without --json, should name the written report', async () => {
    // given: a writable fixture tree and a rid
    // when: the audit runs as text
    // then: stdout names design/audit-r7.md so the next step is obvious
    const root = copyTree('three-page-tree');
    const { io, captured } = makeCapturedIo();
    await runDesignAudit({ project: root, rid: 'r7', json: false }, io);
    expect(captured.text()).toContain('design/audit-r7.md');
  });
});
