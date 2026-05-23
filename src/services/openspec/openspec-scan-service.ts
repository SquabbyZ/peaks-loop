import { join } from 'node:path';
import { isDirectory, listDirectories, pathExists, readText } from '../../shared/fs.js';
import type {
  OpenSpecChangeDetail,
  OpenSpecChangePaths,
  OpenSpecChangeSummary,
  OpenSpecProposal,
  OpenSpecScanReport,
  OpenSpecTaskProgress,
  OpenSpecTaskSection
} from './openspec-types.js';

export type OpenSpecScanOptions = {
  openspecRoot?: string;
};

function defaultOpenSpecRoot(): string {
  return join(process.cwd(), 'openspec');
}

function parseMarkdownSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (currentHeading !== null) {
      sections.set(currentHeading, buffer.join('\n').trim());
    }
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flush();
      currentHeading = line.slice(3).trim();
      buffer = [];
    } else if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function parseBullets(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line === '-')
    .map((line) => line.replace(/^-\s*/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('[ ]') && !line.startsWith('[x]') && !line.startsWith('[X]'));
}

function parseProposal(markdown: string): OpenSpecProposal {
  const sections = parseMarkdownSections(markdown);
  const why = sections.get('Why') ?? '';
  return {
    why,
    whatChanges: parseBullets(sections.get('What Changes') ?? ''),
    outOfScope: parseBullets(sections.get('Out of Scope') ?? ''),
    dependencies: parseBullets(sections.get('Dependencies') ?? ''),
    risks: parseBullets(sections.get('Risks') ?? ''),
    acceptanceCriteria: parseBullets(sections.get('Acceptance Criteria') ?? '')
  };
}

function parseTaskProgress(markdown: string): OpenSpecTaskProgress {
  const sections = parseMarkdownSections(markdown);
  const sectionEntries: OpenSpecTaskSection[] = [];
  let totalTodo = 0;
  let doneTodo = 0;

  for (const [heading, body] of sections.entries()) {
    let sectionTotal = 0;
    let sectionDone = 0;
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^- \[[ xX]\]/.test(trimmed)) {
        sectionTotal += 1;
        if (/^- \[[xX]\]/.test(trimmed)) {
          sectionDone += 1;
        }
      }
    }
    if (sectionTotal > 0) {
      sectionEntries.push({ heading, total: sectionTotal, done: sectionDone });
      totalTodo += sectionTotal;
      doneTodo += sectionDone;
    }
  }

  return { totalTodo, doneTodo, sections: sectionEntries };
}

async function listSpecs(changeRoot: string): Promise<string[]> {
  const specsRoot = join(changeRoot, 'specs');
  if (!(await isDirectory(specsRoot))) {
    return [];
  }
  return listDirectories(specsRoot);
}

async function resolvePaths(changeRoot: string): Promise<OpenSpecChangePaths> {
  const proposalPath = join(changeRoot, 'proposal.md');
  const tasksPath = join(changeRoot, 'tasks.md');
  const designPath = join(changeRoot, 'design.md');
  return {
    root: changeRoot,
    proposal: (await pathExists(proposalPath)) ? proposalPath : null,
    tasks: (await pathExists(tasksPath)) ? tasksPath : null,
    design: (await pathExists(designPath)) ? designPath : null
  };
}

async function buildSummary(id: string, changeRoot: string): Promise<OpenSpecChangeSummary> {
  const paths = await resolvePaths(changeRoot);
  const specs = await listSpecs(changeRoot);
  let taskProgress: OpenSpecTaskProgress | null = null;
  if (paths.tasks !== null) {
    taskProgress = parseTaskProgress(await readText(paths.tasks));
  }
  return { id, paths, specs, taskProgress };
}

export async function scanOpenSpec(options: OpenSpecScanOptions = {}): Promise<OpenSpecScanReport> {
  const openspecRoot = options.openspecRoot ?? defaultOpenSpecRoot();
  const changesRoot = join(openspecRoot, 'changes');

  if (!(await isDirectory(openspecRoot))) {
    return { openspecRoot, changesRoot, exists: false, changes: [] };
  }

  if (!(await isDirectory(changesRoot))) {
    return { openspecRoot, changesRoot, exists: true, changes: [] };
  }

  const ids = await listDirectories(changesRoot);
  const changes = await Promise.all(ids.map((id) => buildSummary(id, join(changesRoot, id))));
  return { openspecRoot, changesRoot, exists: true, changes };
}

export async function loadOpenSpecChange(
  changeId: string,
  options: OpenSpecScanOptions = {}
): Promise<OpenSpecChangeDetail | null> {
  const openspecRoot = options.openspecRoot ?? defaultOpenSpecRoot();
  const changeRoot = join(openspecRoot, 'changes', changeId);
  if (!(await isDirectory(changeRoot))) {
    return null;
  }
  const summary = await buildSummary(changeId, changeRoot);
  const proposal = summary.paths.proposal === null ? null : parseProposal(await readText(summary.paths.proposal));
  return { ...summary, proposal };
}
