/**
 * `src/services/standards/standards-constitution.ts`
 *
 * The constitution write plan: which instruction files the standards writer
 * owns, what goes in them, and how a hand-written file is protected.
 *
 * THE PROTECTION RULE — one rule, two files. A file that already exists is
 * never overwritten:
 *   - `standards init` writes it only when it is absent (`O_EXCL`).
 *   - `standards update` appends the managed standards block to a file that
 *     has none, leaves a file whose managed block already matches, and asks
 *     for a review when the managed block differs.
 *   - `standards migrate --from-claude-rules` scaffolds the files only when
 *     they are absent.
 * So a hand-written `CLAUDE.md` survives all three; only the managed block is
 * ever appended to it.
 *
 * `isInsidePath` moved here from `project-standards-service.ts` so the
 * write-target guard and the plan builder live in one module — and so this
 * module depends on `project-standards-service.ts` for TYPES only, which
 * keeps the import graph acyclic at runtime.
 */
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { isExpectedFsMiss } from '../../shared/fs-utils.js';
import type { ProjectScripts } from './project-scripts.js';
import {
  AGENTS_MD_FILENAME,
  CLAUDE_MD_FILENAME,
  renderAgentsMd,
  renderClaudeMdPointer
} from './standards-render-agents.js';
import { renderManagedStandardsIndex } from './standards-render-common.js';
import type { StandardsLanguage, StandardsWriteStatus } from './project-standards-service.js';

/** Which instruction files the standards writer owns for one project. */
export type StandardsConstitution = {
  /** The shared cross-tool body file. */
  readonly bodyFile: string;
  /**
   * The IDE-native file that imports the body, or `null` when the IDE reads
   * the body file directly and needs no pointer.
   */
  readonly pointerFile: string | null;
};

/**
 * The default shape: both files.
 *
 * `AGENTS.md` is read natively by 20+ coding agents; `CLAUDE.md` is what
 * Claude Code reads, and it imports the body. Emitting both covers every
 * reader without a per-tool configuration step.
 */
export const DEFAULT_CONSTITUTION: StandardsConstitution = {
  bodyFile: AGENTS_MD_FILENAME,
  pointerFile: CLAUDE_MD_FILENAME
};

/** One constitution file's write plan. */
export type ConstitutionFileUpdate = {
  readonly relativePath: string;
  readonly filePath: string;
  readonly status: StandardsWriteStatus;
  readonly content: string;
  readonly appendBlock: string;
  readonly reviewSuggestions: readonly string[];
};

/** The whole constitution's write plan. */
export type ConstitutionUpdate = {
  readonly body: ConstitutionFileUpdate;
  readonly pointer: ConstitutionFileUpdate | null;
};

/** The JSON shape of a constitution update — one file summary, plus its pointer. */
export type ConstitutionUpdateSummary = {
  readonly body: {
    readonly relativePath: string;
    readonly status: StandardsWriteStatus;
    readonly reviewSuggestions: readonly string[];
  };
  readonly pointer: {
    readonly relativePath: string;
    readonly status: StandardsWriteStatus;
    readonly reviewSuggestions: readonly string[];
  } | null;
};

/** The JSON shape of a constitution update. */
export function summarizeConstitutionUpdate(update: ConstitutionUpdate): ConstitutionUpdateSummary {
  return {
    body: {
      relativePath: update.body.relativePath,
      status: update.body.status,
      reviewSuggestions: update.body.reviewSuggestions
    },
    pointer:
      update.pointer === null
        ? null
        : {
            relativePath: update.pointer.relativePath,
            status: update.pointer.status,
            reviewSuggestions: update.pointer.reviewSuggestions
          }
  };
}

/** True when the relative path names a constitution file the writer owns. */
export function isConstitutionPath(relativePath: string): boolean {
  return relativePath === AGENTS_MD_FILENAME || relativePath === CLAUDE_MD_FILENAME;
}

/** True when `childPath` is `parentPath` or lives under it. */
export function isInsidePath(childPath: string, parentPath: string): boolean {
  const rel = relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * The write-target containment guard for a constitution file.
 *
 * A symlinked `CLAUDE.md` / `AGENTS.md`, or one that resolves outside the
 * project root, is a write-target escape attempt and must be rejected before
 * anything is written.
 */
export function assertSafeConstitutionPath(filePath: string, projectRoot: string): void {
  if (!existsSync(filePath)) return;
  if (lstatSync(filePath).isSymbolicLink() || !isInsidePath(realpathSync(filePath), projectRoot)) {
    throw new Error('Project standards constitution files must stay inside the project root');
  }
}

function readFileIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    // Same narrowing as the repo's other IO reads: an expected FS miss
    // (unreadable / vanished / is-a-directory) means "no readable file
    // here"; every other IO error is a real defect and must surface.
    if (isExpectedFsMiss(err)) return null;
    throw err;
  }
}

const MANAGED_BLOCK_START = '<!-- peaks-standards:index:start -->';

/** Assemble one constitution file's plan. */
function fileUpdate(input: {
  readonly relativePath: string;
  readonly filePath: string;
  readonly status: StandardsWriteStatus;
  readonly content: string;
  readonly appendBlock?: string;
  readonly reviewSuggestions?: readonly string[];
}): ConstitutionFileUpdate {
  return {
    relativePath: input.relativePath,
    filePath: input.filePath,
    status: input.status,
    content: input.content,
    appendBlock: input.appendBlock ?? '',
    reviewSuggestions: input.reviewSuggestions ?? []
  };
}

/**
 * The four-state plan for ONE constitution file.
 *
 *   planned  — the file is absent; it will be created with body + block
 *   appended — the file exists without a managed block; the block is appended
 *   existing — the file exists and its managed block already matches
 *   review   — the file exists with a managed block that differs; a human decides
 */
function buildFileUpdate(input: {
  readonly projectRoot: string;
  readonly relativePath: string;
  readonly body: string;
  readonly managedBlock: string;
}): ConstitutionFileUpdate {
  const filePath = resolve(input.projectRoot, input.relativePath);
  const existingContent = readFileIfExists(filePath);
  if (existingContent === null) {
    return fileUpdate({
      relativePath: input.relativePath,
      filePath,
      status: 'planned',
      content: `${input.body.trimEnd()}\n\n${input.managedBlock}`
    });
  }
  const blockStart = existingContent.indexOf(MANAGED_BLOCK_START);
  if (blockStart < 0) {
    return fileUpdate({
      relativePath: input.relativePath,
      filePath,
      status: 'appended',
      content: `${existingContent.trimEnd()}\n\n${input.managedBlock}`,
      appendBlock: `\n\n${input.managedBlock}`
    });
  }
  const existingBlock = existingContent.slice(blockStart).trimEnd();
  if (existingBlock === input.managedBlock.trimEnd()) {
    return fileUpdate({
      relativePath: input.relativePath,
      filePath,
      status: 'existing',
      content: existingContent
    });
  }
  return fileUpdate({
    relativePath: input.relativePath,
    filePath,
    status: 'review',
    content: existingContent,
    reviewSuggestions: [
      `Existing ${input.relativePath} already has a managed standards block. Review the managed block manually before changing it.`
    ]
  });
}

/**
 * The constitution write plan for one project.
 *
 * `rulesRoot` is the directory the project's standards actually live in —
 * `.peaks/standards` for the 2.0 canonical layout, `.claude/rules` for a
 * project still carrying the 1.x tree — so the body points at the files that
 * are really there.
 */
export function buildConstitutionUpdate(input: {
  readonly projectRoot: string;
  readonly constitution: StandardsConstitution;
  readonly language: StandardsLanguage;
  readonly scripts: ProjectScripts;
  readonly rulesRoot: string;
}): ConstitutionUpdate {
  const managedBlock = renderManagedStandardsIndex(input.language);
  const body = buildFileUpdate({
    projectRoot: input.projectRoot,
    relativePath: input.constitution.bodyFile,
    body: renderAgentsMd(input.language, input.scripts, input.rulesRoot),
    managedBlock
  });
  const pointerFile = input.constitution.pointerFile;
  const pointer =
    pointerFile === null
      ? null
      : buildFileUpdate({
          projectRoot: input.projectRoot,
          relativePath: pointerFile,
          body: renderClaudeMdPointer(),
          managedBlock
        });
  return { body, pointer };
}

/**
 * Create the constitution files that are absent. Never overwrites.
 *
 * Used by the layout migration (`standards migrate --from-claude-rules`),
 * which brings a 1.x project onto the 2.0 canonical layout.
 */
export function scaffoldConstitutionFiles(input: {
  readonly projectRoot: string;
  readonly constitution: StandardsConstitution;
  readonly language: StandardsLanguage;
  readonly scripts: ProjectScripts;
  readonly rulesRoot: string;
}): readonly string[] {
  const written: string[] = [];
  const bodyPath = resolve(input.projectRoot, input.constitution.bodyFile);
  if (!existsSync(bodyPath)) {
    writeFileSync(bodyPath, renderAgentsMd(input.language, input.scripts, input.rulesRoot), 'utf8');
    written.push(input.constitution.bodyFile);
  }
  const pointerFile = input.constitution.pointerFile;
  if (pointerFile !== null) {
    const pointerPath = resolve(input.projectRoot, pointerFile);
    if (!existsSync(pointerPath)) {
      writeFileSync(pointerPath, renderClaudeMdPointer(), 'utf8');
      written.push(pointerFile);
    }
  }
  return written;
}
