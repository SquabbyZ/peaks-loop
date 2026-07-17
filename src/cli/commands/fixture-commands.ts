/**
 * v2.14.0 G1 AC-1.4 — `peaks fixture capture` CLI surface.
 *
 * Producer-side CLI for the G1 fixture-replay anti-fake-green test
 * suite. Captures a real envelope artifact from
 * `.peaks/_runtime/<sid>/<role>/<envelope>` and writes a sanitized +
 * checksummed fixture pair (body + `fixture.meta.json`) into
 * `tests/fixtures/replay/`. Two sub-modes:
 *
 *   peaks fixture capture --from-rid <historical-rid> \
 *                        --sid <sid> --envelope <kind> \
 *                        --out tests/fixtures/replay
 *
 *   peaks fixture capture --variant-from <captured-fixture-path> \
 *                        --variant <edge-case> \
 *                        --out tests/fixtures/replay
 *
 * Why a CLI (not just a service function):
 *   - AC-1.4 mandates the CLI as the producer. A1.4 honesty test:
 *     every fixture under `tests/fixtures/replay/` MUST have a
 *     `producer: 'peaks-fixture-capture-cli'` in its `fixture.meta.json`
 *     and a `capturedAt` timestamp within a window where the CLI was
 *     invoked.
 *   - Dogfood: this CLI is itself used by the v2.14.0 release prep to
 *     rebuild the fixture set. Reviewers can replay the exact
 *     command from the meta to regenerate any fixture.
 *
 * File budget: ≤ 200 lines (Karpathy §2).
 */
import { Command } from 'commander';
import { resolve } from 'node:path';
import {
  captureDerivedVariant,
  captureHistoricalFixture,
  EDGE_CASE_VARIANTS,
  ENVELOPE_KINDS,
  type EdgeCaseVariant,
  type EnvelopeKind
} from '../../services/fixture/index.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

type CaptureOptions = {
  fromRid?: string;
  sid?: string;
  envelope?: string;
  variantFrom?: string;
  variant?: string;
  out?: string;
  fixtureId?: string;
  json?: boolean;
};

function isEnvelopeKind(v: string): v is EnvelopeKind {
  return (ENVELOPE_KINDS as ReadonlyArray<string>).includes(v);
}

function isEdgeCaseVariant(v: string): v is EdgeCaseVariant {
  return (EDGE_CASE_VARIANTS as ReadonlyArray<string>).includes(v);
}

export function registerFixtureCommands(program: Command, io: ProgramIO): void {
  const fixture = program
    .command('fixture')
    .description('Fixture capture + replay support (v2.14.0 G1 anti-fake-green)');

  addJsonOption(
    fixture
      .command('capture')
      .description('Capture a real envelope artifact as a replay fixture. Sanitizes secrets, computes SHA-256, writes fixture.meta.json.')
      .option('--from-rid <rid>', 'historical rid to capture (requires --sid + --envelope)')
      .option('--sid <sid>', 'session id under .peaks/_runtime/<sid>/', 'default')
      .option('--envelope <kind>', `envelope kind: ${ENVELOPE_KINDS.join(' | ')}`)
      .option('--variant-from <path>', 'parent fixture path (derived-variant mode)')
      .option('--variant <edge-case>', `edge case: ${EDGE_CASE_VARIANTS.join(' | ')}`)
      .option('--out <dir>', 'output dir', 'tests/fixtures/replay')
      .option('--fixture-id <id>', 'override the fixtureId (auto-derived from rid/variant otherwise)')
  ).action((options: CaptureOptions) => {
    const out = resolve(process.cwd(), options.out ?? 'tests/fixtures/replay');

    // Mode 1: derived-variant
    if (options.variantFrom !== undefined || options.variant !== undefined) {
      if (options.variantFrom === undefined || options.variant === undefined) {
        printResult(io,
          fail('fixture.capture', 'VARIANT_ARGS_REQUIRED',
            '--variant-from and --variant must be supplied together',
            {}, ['Rerun with both --variant-from <path> --variant <edge-case>']),
          options.json);
        process.exitCode = 1;
        return;
      }
      if (!isEdgeCaseVariant(options.variant)) {
        printResult(io,
          fail('fixture.capture', 'VARIANT_UNKNOWN',
            `unknown variant '${options.variant}'`,
            { knownVariants: EDGE_CASE_VARIANTS },
            [`Use one of: ${EDGE_CASE_VARIANTS.join(', ')}`]),
          options.json);
        process.exitCode = 1;
        return;
      }
      const fixtureId = options.fixtureId
        ?? deriveVariantFixtureId(options.variantFrom, options.variant);
      try {
        const captured = captureDerivedVariant({
          mode: 'derived-variant',
          parentFixturePath: resolve(process.cwd(), options.variantFrom),
          variant: options.variant,
          fixtureId,
          outDir: out
        });
        printResult(io,
          ok('fixture.capture', { mode: 'derived-variant', ...captured }),
          options.json);
      } catch (err: unknown) {
        printResult(io,
          fail('fixture.capture', 'CAPTURE_FAILED',
            err instanceof Error ? err.message : String(err),
            {}, ['Verify the parent fixture path exists']),
          options.json);
        process.exitCode = 1;
      }
      return;
    }

    // Mode 2: historical
    if (options.fromRid === undefined || options.envelope === undefined) {
      printResult(io,
        fail('fixture.capture', 'CAPTURE_ARGS_REQUIRED',
          'Either --variant-from/--variant OR --from-rid/--envelope must be supplied',
          { envelopeKinds: ENVELOPE_KINDS, edgeCases: EDGE_CASE_VARIANTS },
          ['Rerun with --from-rid <rid> --envelope <kind>', 'OR --variant-from <path> --variant <edge-case>']),
        options.json);
      process.exitCode = 1;
      return;
    }
    if (!isEnvelopeKind(options.envelope)) {
      printResult(io,
        fail('fixture.capture', 'ENVELOPE_UNKNOWN',
          `unknown envelope kind '${options.envelope}'`,
          { knownKinds: ENVELOPE_KINDS },
          [`Use one of: ${ENVELOPE_KINDS.join(', ')}`]),
        options.json);
      process.exitCode = 1;
      return;
    }
    const fixtureId = options.fixtureId ?? deriveHistoricalFixtureId(options.fromRid, options.envelope);
    try {
      const captured = captureHistoricalFixture({
        mode: 'historical',
        sessionId: options.sid ?? 'default',
        envelopeKind: options.envelope,
        fixtureId,
        outDir: out,
        requireSource: true
      });
      printResult(io,
        ok('fixture.capture', { mode: 'historical', ...captured }),
        options.json);
    } catch (err: unknown) {
      printResult(io,
        fail('fixture.capture', 'CAPTURE_FAILED',
          err instanceof Error ? err.message : String(err),
          {}, ['Verify --sid / --envelope point to an existing session artifact']),
        options.json);
      process.exitCode = 1;
    }
  });
}

function deriveHistoricalFixtureId(rid: string, envelope: EnvelopeKind): string {
  return `${rid}-${envelope}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
}

function deriveVariantFixtureId(parentPath: string, variant: EdgeCaseVariant): string {
  const base = parentPath.replace(/\.(md|json)$/, '').split(/[/\\]/).pop() ?? 'parent';
  return `${base}--${variant}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80);
}
