import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectory, pathExists } from '../../shared/fs.js';

export type OpenSpecInitOptions = {
  projectRoot: string;
  apply?: boolean;
};

export type OpenSpecInitPlan = {
  apply: boolean;
  projectRoot: string;
  openspecRoot: string;
  plannedWrites: Array<{ path: string; kind: 'directory' | 'file'; bytes: number; content: string }>;
  alreadyInitialized: boolean;
  existingFiles: string[];
};

export type OpenSpecInitResult = OpenSpecInitPlan & {
  writtenFiles: string[];
  createdDirectories: string[];
};

const README_BODY = `# OpenSpec — change proposals for this project

This directory hosts the \`peaks openspec\` change proposal lifecycle:

  render → validate → show → to-rd → ... → archive

Each in-flight proposal lives in \`changes/<id>/\` and contains:

- \`proposal.md\`  — why, what, non-goals, impact
- \`tasks.md\`     — concrete slices and commit boundaries (consumed by peaks-sc)
- \`design.md\`   — optional, for non-trivial designs
- \`specs/\`       — optional, delta-style spec changes (## ADDED / ## MODIFIED / ## REMOVED)
- \`*.md\`         — any additional narrative the change needs

When a change ships, \`peaks openspec archive <id> --apply\` moves it into
\`changes/archive/<id>/\`. The archive is the historical record of what
landed and why.

To scaffold a fresh change in this project:

  peaks openspec render --request <path-to-render-request.json> --apply

For the full lifecycle see \`peaks openspec --help\` and the
peaks-clause-code skill family.
`;

const CHANGES_INDEX_HEADER = `# OpenSpec — change log

This file is the human-readable index of every change that has shipped in
this project. New entries are added by \`peaks openspec archive\` (when
\`.apply\` is used); do not hand-edit.

| Date | Change | Status |
|------|--------|--------|
`;

function renderReadme(): string {
  return README_BODY;
}

function renderChangesIndex(): string {
  return CHANGES_INDEX_HEADER;
}

function buildPlan(projectRoot: string, apply: boolean): OpenSpecInitPlan {
  const openspecRoot = join(projectRoot, 'openspec');
  const changesRoot = join(openspecRoot, 'changes');
  const archiveRoot = join(changesRoot, 'archive');

  const plannedWrites: OpenSpecInitPlan['plannedWrites'] = [
    { path: openspecRoot, kind: 'directory', bytes: 0, content: '' },
    { path: changesRoot, kind: 'directory', bytes: 0, content: '' },
    { path: archiveRoot, kind: 'directory', bytes: 0, content: '' },
    { path: join(openspecRoot, 'README.md'), kind: 'file', bytes: 0, content: renderReadme() },
    { path: join(openspecRoot, 'CHANGES.md'), kind: 'file', bytes: 0, content: renderChangesIndex() }
  ];

  // Stamp byte counts now that content is finalised.
  for (const write of plannedWrites) {
    if (write.kind === 'file') {
      write.bytes = Buffer.byteLength(write.content, 'utf8');
    }
  }

  return {
    apply,
    projectRoot,
    openspecRoot,
    plannedWrites,
    alreadyInitialized: false,
    existingFiles: []
  };
}

export async function planOpenSpecInit(options: OpenSpecInitOptions): Promise<OpenSpecInitPlan> {
  const openspecRoot = join(options.projectRoot, 'openspec');
  const plan = buildPlan(options.projectRoot, options.apply ?? false);

  if (await isDirectory(openspecRoot)) {
    // Already initialised. Report the existing files so the user can audit
    // before re-running with --apply. We never overwrite an existing
    // openspec/ — that is a destructive action and out of scope for init.
    const existing: string[] = [];
    for (const write of plan.plannedWrites) {
      if (write.kind === 'file' && (await pathExists(write.path))) {
        existing.push(write.path);
      }
    }
    // Pre-compute which directory writes to keep (those whose target does
    // not exist yet). .filter cannot be async, so resolve the boolean
    // set up front.
    const directoryKeep = new Set<string>();
    for (const write of plan.plannedWrites) {
      if (write.kind === 'directory' && !(await isDirectory(write.path))) {
        directoryKeep.add(write.path);
      }
    }
    plan.plannedWrites = plan.plannedWrites.filter((write) => {
      if (write.kind === 'directory') return directoryKeep.has(write.path);
      return !existing.includes(write.path);
    });
    plan.alreadyInitialized = existing.length > 0 || (await isDirectory(join(openspecRoot, 'changes')));
    plan.existingFiles = existing;
  }

  return plan;
}

export async function executeOpenSpecInit(options: OpenSpecInitOptions): Promise<OpenSpecInitResult> {
  const plan = await planOpenSpecInit(options);
  const writtenFiles: string[] = [];
  const createdDirectories: string[] = [];

  if (plan.apply && !plan.alreadyInitialized) {
    for (const write of plan.plannedWrites) {
      if (write.kind === 'directory') {
        if (!(await isDirectory(write.path))) {
          await mkdir(write.path, { recursive: true });
          createdDirectories.push(write.path);
        }
        continue;
      }
      if (write.content.length === 0) continue;
      await writeFile(write.path, write.content, 'utf8');
      writtenFiles.push(write.path);
    }
  }

  return { ...plan, writtenFiles, createdDirectories };
}
