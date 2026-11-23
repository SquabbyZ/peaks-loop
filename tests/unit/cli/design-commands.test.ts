import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { runDesignInit, runDesignStatus } from '../../../src/cli/commands/design-commands.js';

declareDimensions('tests/unit/cli/design-commands.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-cli-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { react: '19.0.0' } }),
    'utf8'
  );
  writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
  return root;
}

describe('Scenario: render — JSON envelopes', () => {
  it('when init succeeds, should print an ok envelope with the written files', async () => {
    // given: a frontend app and a captured io sink
    // when: init runs as JSON
    // then: the envelope names the command and the files
    const root = makeApp();
    const { io, captured } = makeCapturedIo();
    await runDesignInit({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as {
      ok: boolean;
      command: string;
      data: { written: string[] };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('design.init');
    expect(parsed.data.written).toContain(join('design', 'contract.md'));
  });

  it('when status runs on a missing contract, should report adopted false', async () => {
    // given: a frontend app with no contract and a captured io sink
    // when: status runs
    // then: the envelope reports not adopted
    const root = makeApp();
    const { io, captured } = makeCapturedIo();
    await runDesignStatus({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as { data: { adopted: boolean } };
    expect(parsed.data.adopted).toBe(false);
  });
});
