import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCapabilityMapping, resolveCoverageSummaryPath } from '../../openspec/coverage-evidence-reader.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import { combineProbes, fail, missingSourceFiles, pass, probe, requireBaselineRow } from './_shared.js';

const COVERAGE_REL = ['coverage', 'coverage-summary.json'];
const OPENSPEC_REL = ['openspec', 'coverage-summary.json'];

function writeJson(root: string, parts: ReadonlyArray<string>, body: unknown): void {
  const abs = join(root, ...parts);
  mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(abs, JSON.stringify(body));
}

const PROPOSAL_WITH_MAPPING = [
  '# change',
  '',
  '## Capability Mapping',
  '',
  '| capability | source | test anchor |',
  '| --- | --- | --- |',
  '| runner | src/services/capability-guard-runner/runner.ts | tests/unit/capability-guard-runner/runner.test.ts |',
  '',
  '## Next section',
  'trailing prose'
].join('\n');

/**
 * Behavioural probe of the fixed coverage-summary discovery order.
 *
 * The previous version listed three openspec files and passed if any of them
 * mentioned "Capability Mapping" AND "coverage" — the string "coverage" appears
 * in `coverage-evidence-reader.ts` from its own filename.
 *
 * Here the real resolver is driven against a tmp project where BOTH candidate
 * files exist, then only the second, then neither. Only a resolver that honours
 * the documented order can produce `coverage/` → `openspec/` → missing.
 */
export async function runJ15Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const root = mkdtempSync(join(tmpdir(), 'cbl-J15-'));
  try {
    const both = join(root, ...COVERAGE_REL);
    const fallback = join(root, ...OPENSPEC_REL);
    writeJson(root, COVERAGE_REL, { total: { lines: { pct: 100 } } });
    writeJson(root, OPENSPEC_REL, { total: { lines: { pct: 0 } } });

    const first = await resolveCoverageSummaryPath({ projectRoot: root });
    rmSync(both, { force: true });
    const second = await resolveCoverageSummaryPath({ projectRoot: root });
    rmSync(fallback, { force: true });
    const neither = await resolveCoverageSummaryPath({ projectRoot: root });

    const proposalPath = join(root, 'proposal.md');
    writeFileSync(proposalPath, PROPOSAL_WITH_MAPPING);
    const withBlock = await parseCapabilityMapping(proposalPath);
    writeFileSync(proposalPath, '# change\n\n## Other section\n');
    const withoutBlock = await parseCapabilityMapping(proposalPath);

    const triedPaths = !neither.ok && neither.error.code === 'missing' ? neither.error.triedPaths : [];

    const result = combineProbes([
      probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
      probe(
        first.ok && first.value.replace(/\\/g, '/').endsWith('/coverage/coverage-summary.json'),
        `with both summaries present the c8 wrapper default wins (${first.ok ? first.value : first.error.code})`
      ),
      probe(
        second.ok && second.value.replace(/\\/g, '/').endsWith('/openspec/coverage-summary.json'),
        `with only the openspec summary present the override is used (${second.ok ? second.value : second.error.code})`
      ),
      probe(!neither.ok && neither.error.code === 'missing', `with neither summary present resolution fails (${neither.ok ? 'resolved' : neither.error.code})`),
      probe(
        triedPaths.length === 2 &&
          triedPaths[0]!.replace(/\\/g, '/').endsWith('/coverage/coverage-summary.json') &&
          triedPaths[1]!.replace(/\\/g, '/').endsWith('/openspec/coverage-summary.json'),
        `the tried-path list reports the fixed order (${triedPaths.join(' | ') || 'none'})`
      ),
      probe(withBlock.present && withBlock.rows.length === 1, `a ## Capability Mapping block parses to one row (present=${String(withBlock.present)} rows=${String(withBlock.rows.length)})`),
      probe(!withoutBlock.present && withoutBlock.rows.length === 0, 'a proposal without the block is reported as absent, not guessed')
    ]);

    const artifact = row.sourceFiles[0] ?? 'src/services/openspec/coverage-evidence-reader.ts';
    if (result.ok) return pass(ctx, artifact);
    return fail(
      ctx,
      artifact,
      'coverage-summary discovery order is coverage/ then openspec/, and the Capability Mapping block is parsed not guessed',
      result.detail,
      'J15 invariant broken: the coverage evidence discovery order or the Capability Mapping parse changed'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
