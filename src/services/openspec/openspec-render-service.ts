import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDirectory } from '../../shared/fs.js';

export type OpenSpecRenderTaskSection = {
  heading: string;
  todos: string[];
  doneItems?: string[];
};

export type OpenSpecRenderRequest = {
  changeId: string;
  why: string;
  whatChanges: string[];
  acceptanceCriteria: string[];
  outOfScope?: string[];
  dependencies?: string[];
  risks?: string[];
  tasks?: OpenSpecRenderTaskSection[];
  design?: string;
};

export type OpenSpecRenderedFile = {
  path: string;
  content: string;
};

export type OpenSpecRenderResult = {
  changeId: string;
  changeRoot: string;
  files: OpenSpecRenderedFile[];
  applied: boolean;
};

export type OpenSpecRenderOptions = {
  openspecRoot?: string;
  apply?: boolean;
  overwrite?: boolean;
};

const CHANGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function defaultOpenSpecRoot(): string {
  return join(process.cwd(), 'openspec');
}

function renderBullets(items: string[] | undefined): string {
  if (items === undefined || items.length === 0) {
    return '_None_\n';
  }
  return `${items.map((item) => `- ${item}`).join('\n')}\n`;
}

function renderProposal(request: OpenSpecRenderRequest): string {
  const lines: string[] = [];
  lines.push(`# Change: ${request.changeId}`);
  lines.push('');
  lines.push('## Why');
  lines.push('');
  lines.push(request.why.length > 0 ? request.why : '_None_');
  lines.push('');
  lines.push('## What Changes');
  lines.push('');
  lines.push(renderBullets(request.whatChanges));
  lines.push('## Out of Scope');
  lines.push('');
  lines.push(renderBullets(request.outOfScope));
  lines.push('## Dependencies');
  lines.push('');
  lines.push(renderBullets(request.dependencies));
  lines.push('## Risks');
  lines.push('');
  lines.push(renderBullets(request.risks));
  lines.push('## Acceptance Criteria');
  lines.push('');
  lines.push(renderBullets(request.acceptanceCriteria));
  return lines.join('\n');
}

function renderTasks(tasks: OpenSpecRenderTaskSection[]): string {
  const sections: string[] = ['# Tasks', ''];
  for (const task of tasks) {
    sections.push(`## ${task.heading}`);
    sections.push('');
    for (const todo of task.todos) {
      sections.push(`- [ ] ${todo}`);
    }
    if (task.doneItems !== undefined) {
      for (const done of task.doneItems) {
        sections.push(`- [x] ${done}`);
      }
    }
    sections.push('');
  }
  return sections.join('\n');
}

function buildFiles(request: OpenSpecRenderRequest, changeRoot: string): OpenSpecRenderedFile[] {
  const files: OpenSpecRenderedFile[] = [
    { path: join(changeRoot, 'proposal.md'), content: renderProposal(request) }
  ];
  if (request.tasks !== undefined && request.tasks.length > 0) {
    files.push({ path: join(changeRoot, 'tasks.md'), content: renderTasks(request.tasks) });
  }
  if (request.design !== undefined) {
    files.push({ path: join(changeRoot, 'design.md'), content: request.design });
  }
  return files;
}

async function writeRenderedFiles(files: OpenSpecRenderedFile[]): Promise<void> {
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf8');
  }
}

export async function renderOpenSpecChange(
  request: OpenSpecRenderRequest,
  options: OpenSpecRenderOptions = {}
): Promise<OpenSpecRenderResult> {
  if (!CHANGE_ID_PATTERN.test(request.changeId)) {
    throw new Error(`Invalid changeId: ${request.changeId} (expected letters, digits, dots, underscores, or dashes)`);
  }

  const openspecRoot = options.openspecRoot ?? defaultOpenSpecRoot();
  const changeRoot = join(openspecRoot, 'changes', request.changeId);
  const files = buildFiles(request, changeRoot);

  if (options.apply !== true) {
    return { changeId: request.changeId, changeRoot, files, applied: false };
  }

  if (options.overwrite !== true && (await isDirectory(changeRoot))) {
    throw new Error(`Refusing to render: change directory already exists at ${changeRoot}. Re-run with overwrite to replace it.`);
  }

  await writeRenderedFiles(files);
  return { changeId: request.changeId, changeRoot, files, applied: true };
}
