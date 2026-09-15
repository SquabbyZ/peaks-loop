import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGINS } from '../../doctor/doctor-service/plugin-registry.js';
import { proposeFromDoctor } from '../../openspec/openspec-propose-from-doctor-service.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import { combineProbes, fail, missingSourceFiles, pass, probe, requireBaselineRow } from './_shared.js';

const CHECKS_DIR = ['src', 'services', 'doctor', 'doctor-service', 'checks'];
const LEGACY_SHIM = ['src', 'services', 'doctor', 'doctor-service.ts'];
const FROZEN_CLOCK = (): string => '2020-01-01T00:00:00.000Z';

/** Strip block + line comments so only executable lines remain. */
function executableLines(source: string): ReadonlyArray<string> {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
}

/**
 * Constructs a re-export-only shim must not contain. `export * from` /
 * `export { a, b } from` / `export type { ... }` are the only allowed forms;
 * anything below means logic moved back into the legacy path.
 */
const FORBIDDEN_SHIM_PATTERNS: ReadonlyArray<RegExp> = [
  /\bfunction\b/,
  /\breturn\b/,
  /\bif\s*\(/,
  /\bfor\s*\(/,
  /\bwhile\s*\(/,
  /\bconst\s+\w+\s*=/,
  /=>\s*\{/
];

/**
 * Behavioural probe of "doctor checks live under a code-driven fixed-registry
 * tree, and each openspec change is generated from a real doctor finding".
 *
 * The previous version listed doctor/audit/openspec files and passed if any of
 * them mentioned "doctor", "audit", "openspec" or "health" — `doctor-service.ts`
 * satisfies that from its own filename.
 */
export async function runJ11Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const checksDirAbs = join(ctx.projectRoot, ...CHECKS_DIR);
  const checkFiles = existsSync(checksDirAbs) ? readdirSync(checksDirAbs).filter((f) => f.endsWith('.ts')) : [];
  const pluginIds = PLUGINS.map((p) => p.name);
  const uniquePluginIds = new Set(pluginIds);

  const shimAbs = join(ctx.projectRoot, ...LEGACY_SHIM);
  const shimSource = existsSync(shimAbs) ? readFileSync(shimAbs, 'utf8') : '';
  const shimLines = executableLines(shimSource);
  const shimLogic = shimLines.filter((line) => FORBIDDEN_SHIM_PATTERNS.some((re) => re.test(line)));
  const shimReexports = /export\s+(\*|\{[\s\S]*?\}|type\s*\{[\s\S]*?\})\s*from\s*'/.test(shimSource);
  const shimIsReexportOnly = shimLines.length > 0 && shimLogic.length === 0 && shimReexports;

  const root = mkdtempSync(join(tmpdir(), 'cbl-J11-'));
  try {
    const finding = { id: 'L3:l3-memory-health', rule: 'r', detail: 'd', severity: 'fail' as const };
    const first = proposeFromDoctor({ projectRoot: root, finding, clock: FROZEN_CLOCK });
    const second = proposeFromDoctor({ projectRoot: root, finding, clock: FROZEN_CLOCK });
    const proposalMentionsFinding = existsSync(first.proposalPath)
      ? readFileSync(first.proposalPath, 'utf8').includes(finding.id)
      : false;

    const result = combineProbes([
      probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
      probe(checkFiles.length > 0 && PLUGINS.length === checkFiles.length, `the plugin registry enumerates every check module (${String(PLUGINS.length)} plugins / ${String(checkFiles.length)} checks)`),
      probe(uniquePluginIds.size === PLUGINS.length, `plugin ids are unique (${String(uniquePluginIds.size)}/${String(PLUGINS.length)})`),
      probe(
        shimIsReexportOnly,
        `the legacy doctor-service.ts shim holds no logic (${String(shimLines.length)} executable lines, ${String(shimLogic.length)} with logic${shimLogic.length > 0 ? `: ${shimLogic.slice(0, 3).join(' | ')}` : ''})`
      ),
      probe(
        first.changeId === '2020-01-01-fix-l3-l3-memory-health',
        `the change id is derived from the doctor finding (${first.changeId})`
      ),
      probe(first.created === true, 'the first proposal is created'),
      probe(proposalMentionsFinding, 'the proposal names the originating finding id'),
      probe(second.created === false, 'regenerating from the same finding is idempotent (created=false)')
    ]);

    const artifact = row.sourceFiles[0] ?? 'src/services/doctor/doctor-service/index.ts';
    if (result.ok) return pass(ctx, artifact);
    return fail(
      ctx,
      artifact,
      'doctor checks are a code-driven fixed-registry tree and openspec changes come from real findings',
      result.detail,
      'J11 invariant broken: the doctor check registry or the finding-to-change conversion no longer holds'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
