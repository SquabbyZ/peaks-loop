import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSop } from '../../sop/sop-service.js';
import { SOP_ID_PATTERN } from '../../sop/sop-types.js';
import { registerSop, SopRegisterError } from '../../sop/sop-registry-service.js';
import type { GuardContext, GuardRunResult } from '../types.js';
import {
  combineProbes,
  fail,
  missingSourceFiles,
  pass,
  probe,
  requireBaselineRow
} from './_shared.js';

const VALID_ID = 'guard-demo';

function registryPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'sops', 'registry.json');
}

/**
 * Behavioural probe of the SOP id guard and the lint-before-register ordering.
 *
 * The previous version listed five SOP files and passed if any of them
 * mentioned "sop", "gate" or "register" — every file in the list is named
 * `sop-*.ts`, so the check could not fail.
 *
 * Here the real `initSop` / `registerSop` path runs against a tmp project:
 * path-traversal and reserved ids must be refused, and a manifest that fails
 * lint must stop the registration BEFORE `registry.json` is written. The
 * positive control (a clean manifest DOES register) is what makes the negative
 * assertion mean something.
 */
export async function runJ09Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const root = mkdtempSync(join(tmpdir(), 'cbl-J09-'));
  try {
    const patternRejects = ['a.b', 'a/b', '../escape', 'Bad-Id', ''].every(
      (id) => !SOP_ID_PATTERN.test(id)
    );
    const patternAccepts = ['demo', 'my-sop', 'a', 'sop2'].every((id) => SOP_ID_PATTERN.test(id));

    const reservedRefused: string[] = [];
    for (const id of ['peaks-x', 'peaks']) {
      try {
        await initSop({ id, projectRoot: root, apply: true });
      } catch (e) {
        if (/reserved/i.test((e as Error).message)) reservedRefused.push(id);
      }
    }

    let traversalRefused = false;
    try {
      await initSop({ id: '../escape', projectRoot: root, apply: true });
    } catch (e) {
      traversalRefused = /invalid sop id|pattern|kebab/i.test((e as Error).message);
    }

    // Positive control: a real SOP initialises and registers cleanly.
    let cleanRegisters = false;
    let registerError = '';
    try {
      await initSop({ id: VALID_ID, projectRoot: root, apply: true });
      const reg = await registerSop({ id: VALID_ID, projectRoot: root });
      cleanRegisters = reg.applied === true && existsSync(registryPath(root));
    } catch (e) {
      registerError = `${(e as Error).name}: ${(e as Error).message.slice(0, 140)}`;
    }

    // Negative control: break the manifest so lint must fail, then register.
    let dirtyRefused = false;
    let dirtyCode = 'none';
    rmSync(registryPath(root), { force: true });
    const manifestPath = join(root, '.peaks', 'sops', VALID_ID, 'sop.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      manifest['id'] = 'not-the-directory-id';
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } else {
      mkdirSync(join(root, '.peaks', 'sops', VALID_ID), { recursive: true });
      writeFileSync(
        manifestPath,
        JSON.stringify({ id: 'not-the-directory-id', name: 'x', phases: ['p'], gates: [] })
      );
    }
    try {
      await registerSop({ id: VALID_ID, projectRoot: root });
    } catch (e) {
      dirtyCode = e instanceof SopRegisterError ? e.code : (e as Error).name;
      dirtyRefused = dirtyCode === 'SOP_INVALID';
    }
    const wroteRegistryDespiteLintFailure = existsSync(registryPath(root));

    const result = combineProbes([
      probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
      probe(patternRejects, 'SOP_ID_PATTERN rejects dots, slashes, traversal and empty ids'),
      probe(patternAccepts, 'SOP_ID_PATTERN accepts lowercase kebab ids'),
      probe(
        reservedRefused.length === 2,
        `reserved ids are refused (refused: ${reservedRefused.join(',') || 'none'})`
      ),
      probe(traversalRefused, "initSop refuses '../escape'"),
      probe(
        cleanRegisters,
        `a clean SOP registers and writes registry.json${registerError ? ` [${registerError}]` : ''}`
      ),
      probe(
        dirtyRefused,
        `a manifest that fails lint is refused with SOP_INVALID (saw ${dirtyCode})`
      ),
      probe(
        !wroteRegistryDespiteLintFailure,
        'lint failure halts registration before registry.json is written'
      )
    ]);

    const artifact = row.sourceFiles[0] ?? 'src/services/sop/sop-service.ts';
    if (result.ok) return pass(ctx, artifact);
    return fail(
      ctx,
      artifact,
      'SOP ids are pattern-guarded and lintSop() gates registerSop()',
      result.detail,
      'J09 invariant broken: the SOP id guard or the lint-before-register ordering no longer holds'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
