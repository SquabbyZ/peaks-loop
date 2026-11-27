// tests/unit/design/component-capabilities.test.ts
//
// S4.0 — the paved road's optional `componentCapabilities` section, read by
// `peaks design capabilities` and validated fail-closed. The fixture at
// `tests/fixtures/design/fidelity/` is the shared target for S4.1 and S4.2:
// a real component library (Button/Card/Field + ui.css + a page using them).
// `tests/fixtures/design/audit/three-page-tree/` is the backward-compatibility
// witness: a contract written before the section exists must still read.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  registerDesignCapabilitiesCommand,
  runDesignCapabilities
} from '../../../src/cli/commands/design-capabilities-command.js';
import { registerDesignCommands } from '../../../src/cli/commands/design-commands.js';
import {
  readComponentCapabilities,
  validateComponentCapabilities,
  type ComponentCapabilities
} from '../../../src/services/design/component-capabilities.js';

declareDimensions('tests/unit/design/component-capabilities.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design');
const FIDELITY = join(FIXTURES, 'fidelity');
const LEGACY = join(FIXTURES, 'audit', 'three-page-tree');

const roots: string[] = [];
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  savedExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** A throwaway project root whose `design/paved-road.json` is exactly `json`. */
function writeRoad(json: string): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-capabilities-'));
  roots.push(root);
  mkdirSync(join(root, 'design'), { recursive: true });
  writeFileSync(join(root, 'design', 'paved-road.json'), json, 'utf8');
  return root;
}

type Envelope = {
  ok: boolean;
  command: string;
  code?: string;
  data: {
    declared: boolean;
    componentCount: number;
    capabilities: ComponentCapabilities | null;
  };
};

describe('Scenario: render — the JSON envelope reports the manifest summary', () => {
  it('when the fixture manifest is declared, should report every component and its count', () => {
    // given: the fidelity fixture with three declared components
    // when: the capabilities command runs as JSON
    // then: the envelope carries the count and the enumerated values
    const { io, captured } = makeCapturedIo();
    runDesignCapabilities({ project: FIDELITY, json: true }, io);
    const parsed = JSON.parse(captured.text()) as Envelope;
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('design.capabilities');
    expect(parsed.data.declared).toBe(true);
    expect(parsed.data.componentCount).toBe(3);
    expect(parsed.data.capabilities?.Button?.props.variant).toEqual([
      'primary',
      'secondary',
      'ghost'
    ]);
    expect(parsed.data.capabilities?.Field?.tokens).toBeUndefined();
  });

  it('when the paved road predates the section, should report capabilities null', () => {
    // given: a contract written before componentCapabilities existed
    // when: the capabilities command runs as JSON
    // then: it reports no declaration rather than an empty manifest
    const { io, captured } = makeCapturedIo();
    runDesignCapabilities({ project: LEGACY, json: true }, io);
    const parsed = JSON.parse(captured.text()) as Envelope;
    expect(parsed.ok).toBe(true);
    expect(parsed.data.declared).toBe(false);
    expect(parsed.data.componentCount).toBe(0);
    expect(parsed.data.capabilities).toBeNull();
  });
});

describe('Scenario: behavior — the validator refuses what it cannot decide', () => {
  it('when a manifest declares enumerated props, should accept it unchanged', () => {
    // given: a valid manifest naming a declared entrypoint
    // when: the section is validated
    // then: the verdict carries the same capability
    const verdict = validateComponentCapabilities(
      { Button: { entrypoint: '@/ui/button', props: { variant: ['primary', 'ghost'] } } },
      ['@/ui/button']
    );
    expect(verdict).toEqual({
      ok: true,
      capabilities: {
        Button: { entrypoint: '@/ui/button', props: { variant: ['primary', 'ghost'] } }
      }
    });
  });

  it('when the section is absent, should read as no filtering at all', () => {
    // given: both spellings of "no section"
    // when: each is validated
    // then: the verdict is ok with capabilities null
    expect(validateComponentCapabilities(undefined, ['@/ui/button'])).toEqual({
      ok: true,
      capabilities: null
    });
    expect(validateComponentCapabilities(null, ['@/ui/button'])).toEqual({
      ok: true,
      capabilities: null
    });
  });

  it('when an entrypoint is not declared, should refuse with the unknown-entrypoint code', () => {
    // given: a capability naming a module the paved road does not declare
    // when: the section is validated
    // then: it is refused by name instead of being accepted
    const verdict = validateComponentCapabilities(
      { Button: { entrypoint: '@/ui/link', props: {} } },
      ['@/ui/button']
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? null : verdict.failure.code).toBe('DESIGN_CAPABILITIES_UNKNOWN_ENTRYPOINT');
    expect(verdict.ok ? '' : verdict.failure.message).toContain('@/ui/link');
  });

  it('when a prop value is not a string array, should refuse with the invalid code', () => {
    // given: a prop whose allowed values are a bare string
    // when: the section is validated
    // then: it is refused rather than coerced into a list
    const verdict = validateComponentCapabilities(
      { Button: { entrypoint: '@/ui/button', props: { variant: 'primary' } } },
      ['@/ui/button']
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? null : verdict.failure.code).toBe('DESIGN_CAPABILITIES_INVALID');
    expect(verdict.ok ? '' : verdict.failure.message).toContain('props.variant');
  });

  it('when an entry carries an unknown key, should refuse instead of guessing', () => {
    // given: a component entry with a misspelled field
    // when: the section is validated
    // then: the unknown key is named
    const verdict = validateComponentCapabilities(
      { Button: { entrypoint: '@/ui/button', props: {}, variant: ['primary'] } },
      ['@/ui/button']
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? null : verdict.failure.code).toBe('DESIGN_CAPABILITIES_INVALID');
    expect(verdict.ok ? '' : verdict.failure.message).toContain('variant');
  });
});

describe('Scenario: integration — the reader crosses the filesystem boundary', () => {
  it('when the fixture contract is read from disk, should return its manifest', () => {
    // given: the fidelity fixture's design root
    // when: the reader runs
    // then: every declared component is present with its entrypoint
    const verdict = readComponentCapabilities(join(FIDELITY, 'design'));
    expect(verdict.ok).toBe(true);
    const capabilities = verdict.ok ? verdict.capabilities : null;
    expect(Object.keys(capabilities ?? {})).toEqual(['Button', 'Card', 'Field']);
    expect(capabilities?.Card?.entrypoint).toBe('@/components/ui/card');
  });

  it('when an existing contract has no capabilities section, should return null', () => {
    // given: the three-page-tree contract, written before this section existed
    // when: the reader runs
    // then: absence is ok and nothing is filtered
    const verdict = readComponentCapabilities(join(LEGACY, 'design'));
    expect(verdict).toEqual({ ok: true, capabilities: null });
  });

  it('when paved-road.json is not valid JSON, should refuse by name', () => {
    // given: a contract file that cannot be parsed
    // when: the reader runs
    // then: the malformed file is refused instead of read as absent
    const root = writeRoad('{ "componentCapabilities": ');
    const verdict = readComponentCapabilities(join(root, 'design'));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? null : verdict.failure.code).toBe('DESIGN_CAPABILITIES_INVALID');
  });
});

describe('Scenario: a11y — the refusal is visible to a human', () => {
  it('when a prop value is not a string array, should exit 1 and name the code', () => {
    // given: a manifest whose prop allowed-values are a bare string
    // when: the command runs as JSON
    // then: the envelope fails with a named code and exit 1
    const root = writeRoad(
      JSON.stringify({
        componentEntrypoints: ['@/components/ui/button'],
        componentCapabilities: {
          Button: { entrypoint: '@/components/ui/button', props: { variant: 'primary' } }
        }
      })
    );
    const { io, captured } = makeCapturedIo();
    runDesignCapabilities({ project: root, json: true }, io);
    const parsed = JSON.parse(captured.text()) as Envelope;
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('DESIGN_CAPABILITIES_INVALID');
    expect(process.exitCode).toBe(1);
  });

  it('when the refusal is printed as text, should name the code on stderr', () => {
    // given: a capability naming an entrypoint the contract does not declare
    // when: the command runs without --json
    // then: stderr carries the code and the offending entrypoint
    const root = writeRoad(
      JSON.stringify({
        componentEntrypoints: ['@/components/ui/button'],
        componentCapabilities: { Button: { entrypoint: '@/components/ui/link', props: {} } }
      })
    );
    const { io, captured } = makeCapturedIo();
    runDesignCapabilities({ project: root }, io);
    expect(captured.stderrText()).toContain('DESIGN_CAPABILITIES_UNKNOWN_ENTRYPOINT');
    expect(captured.stderrText()).toContain('@/components/ui/link');
    expect(process.exitCode).toBe(1);
  });

  it('when design commands register, should expose capabilities with --project and --json', () => {
    // given: the design command group and the registrar that attaches to it
    // when: both run in the program's order
    // then: the new read-only command and both flags are listed
    const program = new Command();
    const { io } = makeCapturedIo();
    registerDesignCommands(program, io);
    registerDesignCapabilitiesCommand(program, io);
    const design = program.commands.find((command) => command.name() === 'design');
    const capabilities = design?.commands.find((command) => command.name() === 'capabilities');
    expect(capabilities).toBeDefined();
    const help = capabilities?.helpInformation() ?? '';
    expect(help).toContain('--project <path>');
    expect(help).toContain('--json');
  });
});
