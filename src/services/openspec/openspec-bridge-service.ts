import { readText } from '../../shared/fs.js';
import { loadOpenSpecChange, type OpenSpecScanOptions } from './openspec-scan-service.js';

export type OpenSpecCommitBoundary = {
  heading: string;
  todos: string[];
  doneItems: string[];
};

export type OpenSpecRdInputProjection = {
  changeId: string;
  acceptance: string[];
  whatChanges: string[];
  dependencies: string[];
  risks: string[];
  outOfScope: string[];
  commitBoundaries: OpenSpecCommitBoundary[];
};

type ParsedTaskSection = {
  heading: string;
  body: string[];
};

function splitTaskSections(markdown: string): ParsedTaskSection[] {
  const sections: ParsedTaskSection[] = [];
  let current: ParsedTaskSection | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      if (current !== null) {
        sections.push(current);
      }
      current = { heading: line.slice(3).trim(), body: [] };
    } else if (current !== null) {
      current.body.push(line);
    }
  }
  if (current !== null) {
    sections.push(current);
  }
  return sections;
}

const TODO_PATTERN = /^- \[ \] (.+?)\s*$/;
const DONE_PATTERN = /^- \[[xX]\] (.+?)\s*$/;

function extractItems(body: string[]): { todos: string[]; doneItems: string[] } {
  const todos: string[] = [];
  const doneItems: string[] = [];
  for (const rawLine of body) {
    const line = rawLine.trim();
    const todoMatch = TODO_PATTERN.exec(line);
    if (todoMatch !== null) {
      todos.push(todoMatch[1] as string);
      continue;
    }
    const doneMatch = DONE_PATTERN.exec(line);
    if (doneMatch !== null) {
      doneItems.push(doneMatch[1] as string);
    }
  }
  return { todos, doneItems };
}

async function buildCommitBoundaries(tasksPath: string | null): Promise<OpenSpecCommitBoundary[]> {
  if (tasksPath === null) {
    return [];
  }
  const markdown = await readText(tasksPath);
  const boundaries: OpenSpecCommitBoundary[] = [];
  for (const section of splitTaskSections(markdown)) {
    const { todos, doneItems } = extractItems(section.body);
    if (todos.length === 0 && doneItems.length === 0) {
      continue;
    }
    boundaries.push({ heading: section.heading, todos, doneItems });
  }
  return boundaries;
}

export async function projectOpenSpecToRdInput(
  changeId: string,
  options: OpenSpecScanOptions = {}
): Promise<OpenSpecRdInputProjection | null> {
  const detail = await loadOpenSpecChange(changeId, options);
  if (detail === null) {
    return null;
  }

  const acceptance = detail.proposal?.acceptanceCriteria ?? [];
  const whatChanges = detail.proposal?.whatChanges ?? [];
  const dependencies = detail.proposal?.dependencies ?? [];
  const risks = detail.proposal?.risks ?? [];
  const outOfScope = detail.proposal?.outOfScope ?? [];
  const commitBoundaries = await buildCommitBoundaries(detail.paths.tasks);

  return {
    changeId,
    acceptance,
    whatChanges,
    dependencies,
    risks,
    outOfScope,
    commitBoundaries
  };
}
