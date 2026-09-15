import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';
import { combineProbes, fail, missingSourceFiles, pass, probe, requireBaselineRow } from './_shared.js';

const SKILL_DIR = ['skills', 'peaks-content'];
const SKILL_MD = [...SKILL_DIR, 'SKILL.md'];

/**
 * The content stages the skill must still declare, each anchored on the bee
 * that implements it. "draft" appearing anywhere in the file is not evidence;
 * `bee-content-draft` disappearing means the stage is gone.
 */
const STAGES: ReadonlyArray<string> = ['draft', 'edit', 'publish', 'archive'];

/** Specifiers that would mean the skill reached into peaks-code domain logic. */
const FORBIDDEN_SPECIFIER = /(^|[./\\])peaks-code([/\\]|$)|(^|\/)src\/(services|cli)\//;

function walk(dir: string, out: string[] = []): ReadonlyArray<string> {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

/**
 * Behavioural probe of the content-pipeline boundary.
 *
 * The previous version read the skill plus three unrelated files and passed if
 * three of the five words draft/edit/tone/publish/archive appeared anywhere —
 * and it counted "tone" (a GATE in the skill) as a STAGE.
 *
 * Here the skill's declared stages are anchored on the bees that implement
 * them, and every file under the skill directory is scanned for a specifier
 * that would reach into peaks-code internals.
 */
export async function runJ13Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const skillAbs = join(ctx.projectRoot, ...SKILL_MD);
  const body = existsSync(skillAbs) ? readFileSync(skillAbs, 'utf8') : '';
  const absentStages = STAGES.filter((stage) => !body.includes(`bee-content-${stage}`));
  const toneGatePresent = body.includes('Tone gate');

  const files = walk(join(ctx.projectRoot, ...SKILL_DIR));
  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const spec = /(?:from|import|require\()\s*['"]([^'"]+)['"]/.exec(line);
      if (spec !== null && FORBIDDEN_SPECIFIER.test(spec[1]!)) {
        offenders.push(`${file.replace(/\\/g, '/')} → ${spec[1]!}`);
      }
    }
  }

  const result = combineProbes([
    probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
    probe(body.length > 0, 'the peaks-content skill file is readable'),
    probe(absentStages.length === 0, `every content stage is anchored on its bee (missing: ${absentStages.join(',') || 'none'})`),
    probe(toneGatePresent, 'the tone gate is still declared between draft and edit'),
    probe(files.length > 0, `the skill directory is non-empty (${String(files.length)} files)`),
    probe(offenders.length === 0, `no skill file imports peaks-code internals (${offenders.join('; ') || 'none'})`)
  ]);

  const artifact = row.sourceFiles[0] ?? 'skills/peaks-content/SKILL.md';
  if (result.ok) return pass(ctx, artifact);
  return fail(
    ctx,
    artifact,
    'peaks-content declares its four stages and imports no peaks-code internals',
    result.detail,
    'J13 invariant broken: the content pipeline stages or the peaks-code boundary changed'
  );
}
