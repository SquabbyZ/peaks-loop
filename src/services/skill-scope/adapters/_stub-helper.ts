/**
 * Shared `makeStubAdapter` helper for the 5 non-shipped IDEs (Trae, Cursor,
 * Codex, Qoder, Tongyi Lingma).
 *
 * Each stub adapter:
 * 1. Implements `SkillScopeAdapter` with `supported: false`.
 * 2. In `applyScope`, ALWAYS writes the companion source-of-truth
 *    `.peaks/scope/<ide>-skills.json` first, then returns a NOT_SUPPORTED
 *    ApplyResult (the test contract asserts the source-of-truth is on disk
 *    even when the adapter can't apply it natively).
 * 3. In `showScope`, reads from the companion source-of-truth file.
 * 4. In `resetScope`, removes the companion source-of-truth file.
 * 5. In `detect`, returns 0.0 (the stub does not actually probe).
 *
 * The TODO comment in each stub file points at the follow-up slice (025.2+).
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import type {
  ApplyResult,
  ApplyScopeInput,
  ResetScopeInput,
  ResetScopeResult,
  ShowScopeResult,
  SkillScopeAdapter,
} from '../types.js';
import { ideCompanionFilePath, removeIfExists, scopeFilePath, writeJsonAtomic } from '../source-of-truth.js';

/**
 * IDE-id -> companion source-of-truth shape. The companion file is a
 * parallel record so the user can see "this is what would have applied"
 * even when the IDE doesn't support a real implementation.
 */
export interface StubSourceOfTruth {
  readonly ide: string;
  readonly generatedAt: string;
  readonly strict: boolean;
  readonly allowlist: readonly string[];
  readonly denylist: readonly string[];
  readonly todoRef: string;
  readonly notes: string;
}

async function writeStubCompanion(
  ide: string,
  input: ApplyScopeInput,
  todoRef: string
): Promise<string> {
  const file = ideCompanionFilePath(input.projectRoot, ide);
  const data: StubSourceOfTruth = {
    ide,
    generatedAt: input.sourceConfig.generatedAt,
    strict: input.strict,
    allowlist: input.allowlist,
    denylist: input.denylist,
    todoRef,
    notes:
      `Stub source-of-truth for ${ide}. The real config format has not yet been researched. ` +
      `This file is written so the user's intent is captured and can be ported when ` +
      `the follow-up slice (${todoRef}) lands.`,
  };
  await writeJsonAtomic(file, data);
  return file;
}

async function readStubCompanion(ide: string, projectRoot: string): Promise<unknown> {
  const file = ideCompanionFilePath(projectRoot, ide);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * The factory: every stub is a thin wrapper around this function. The
 * `applyScope` implementation ALWAYS writes the source-of-truth, then
 * returns a NOT_SUPPORTED ApplyResult (NOT a thrown error — the contract
 * for stub adapters is "return ok:false, notSupported:true" so the CLI
 * can keep going and surface the error to the user).
 */
export function makeStubAdapter(
  ide: SkillScopeAdapter['ide'],
  todoRef: string,
  displayName: string
): SkillScopeAdapter {
  const ideStr = String(ide);
  return {
    ide,
    supported: false,
    async detect(): Promise<number> {
      // Stubs never "win" detection; they return 0.0 so the registry falls
      // back to the shipped adapter (Claude Code).
      return 0.0;
    },
    async applyScope(input: ApplyScopeInput): Promise<ApplyResult> {
      // 1. Always write the source-of-truth first.
      const companion = await writeStubCompanion(ideStr, input, todoRef);
      // 2. Always write the canonical .peaks/scope/skills.json too.
      const canonical = scopeFilePath(input.projectRoot);
      await writeJsonAtomic(canonical, input.sourceConfig);
      // 3. Surface NOT_SUPPORTED with a clear, IDE-named message.
      const message =
        `${displayName} (${ideStr}) config format not yet researched — ${todoRef} follow-up. ` +
        `Source-of-truth written to ${companion}.`;
      return {
        ide,
        ok: false,
        writtenFiles: [companion, canonical],
        usedShadowStub: false,
        notSupported: true,
        error: { code: 'NOT_SUPPORTED', message },
      };
    },
    async showScope(projectRoot: string): Promise<ShowScopeResult> {
      const native = await readStubCompanion(ideStr, projectRoot);
      return { source: null, native, ide };
    },
    async resetScope(input: ResetScopeInput): Promise<ResetScopeResult> {
      const removed: string[] = [];
      const companion = ideCompanionFilePath(input.projectRoot, ideStr);
      if (await removeIfExists(companion)) removed.push(companion);
      // Also remove the canonical source-of-truth on reset.
      const canonical = scopeFilePath(input.projectRoot);
      if (await removeIfExists(canonical)) removed.push(canonical);
      return { ide, removedFiles: removed };
    },
  };
}