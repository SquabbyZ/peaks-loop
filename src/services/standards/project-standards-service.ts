import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type StandardsLanguage = 'generic' | 'typescript' | 'javascript' | 'python' | 'go' | 'rust';
export type StandardsWriteStatus = 'planned' | 'existing' | 'written' | 'appended' | 'review';

export type StandardsWrite = {
  readonly relativePath: string;
  readonly filePath: string;
  readonly content: string;
  readonly status: StandardsWriteStatus;
};

export type ProjectStandardsSource = {
  readonly sourceId: 'everything-claude-code';
  readonly url: 'https://github.com/affaan-m/everything-claude-code';
  readonly usage: 'curated-baseline-reference';
};

export type StandardsSkillPreflight = {
  readonly appliesTo: readonly ['peaks-rd', 'peaks-qa', 'peaks-solo'];
  readonly summary: string;
};

export type ProjectStandardsInitPlan = {
  readonly apply: boolean;
  readonly projectRoot: string;
  readonly language: StandardsLanguage;
  readonly source: ProjectStandardsSource;
  readonly skillPreflight: StandardsSkillPreflight;
  readonly plannedWrites: StandardsWrite[];
};

export type ProjectStandardsInitResult = ProjectStandardsInitPlan & {
  readonly writtenFiles: string[];
};

export type ProjectStandardsInitSummary = {
  readonly apply: boolean;
  readonly projectRoot: string;
  readonly language: StandardsLanguage;
  readonly source: ProjectStandardsSource;
  readonly skillPreflight: StandardsSkillPreflight;
  readonly plannedWrites: Array<Pick<StandardsWrite, 'relativePath' | 'status'>>;
  readonly writtenFiles: string[];
  readonly skippedFiles: string[];
};

export type ProjectStandardsUpdatePlan = ProjectStandardsInitPlan & {
  readonly claudeMd: {
    readonly relativePath: 'CLAUDE.md';
    readonly filePath: string;
    readonly status: StandardsWriteStatus;
    readonly content: string;
    readonly appendBlock: string;
    readonly reviewSuggestions: string[];
  };
};

export type ProjectStandardsUpdateResult = ProjectStandardsUpdatePlan & {
  readonly writtenFiles: string[];
  readonly appendedFiles: string[];
  readonly reviewSuggestions: string[];
};

export type ProjectStandardsUpdateSummary = {
  readonly apply: boolean;
  readonly projectRoot: string;
  readonly language: StandardsLanguage;
  readonly source: ProjectStandardsSource;
  readonly skillPreflight: StandardsSkillPreflight;
  readonly plannedWrites: Array<Pick<StandardsWrite, 'relativePath' | 'status'>>;
  readonly writtenFiles: string[];
  readonly appendedFiles: string[];
  readonly skippedFiles: string[];
  readonly reviewSuggestions: string[];
  readonly claudeMd: {
    readonly relativePath: 'CLAUDE.md';
    readonly status: StandardsWriteStatus;
    readonly reviewSuggestions: string[];
  };
};

type ProjectStandardsInitOptions = {
  readonly projectRoot: string;
  readonly language?: string;
  readonly apply?: boolean;
};

type StandardsTemplate = {
  readonly relativePath: string;
  readonly content: string;
};

const SOURCE: ProjectStandardsSource = {
  sourceId: 'everything-claude-code',
  url: 'https://github.com/affaan-m/everything-claude-code',
  usage: 'curated-baseline-reference'
};

const SKILL_PREFLIGHT: StandardsSkillPreflight = {
  appliesTo: ['peaks-rd', 'peaks-qa', 'peaks-solo'],
  summary: 'peaks-rd、peaks-qa、peaks-solo 进入代码仓工作流时自动 preflight 项目规范。'
};

const SUPPORTED_LANGUAGES = new Set<StandardsLanguage>(['generic', 'typescript', 'javascript', 'python', 'go', 'rust']);

function normalizeRoot(path: string): string {
  return realpathSync(resolve(path));
}

function isInsidePath(childPath: string, parentPath: string): boolean {
  const rel = relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function assertDirectoryNotSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error('Project standards directory must stay inside the project root');
  }
}

function assertRealPathInsideProject(path: string, projectRoot: string): void {
  if (!isInsidePath(realpathSync(path), projectRoot)) {
    throw new Error('Project standards write target must stay inside the project root');
  }
}

function assertWritablePathInsideProject(path: string, projectRoot: string): void {
  let currentPath = path;
  while (!existsSync(currentPath)) {
    currentPath = dirname(currentPath);
  }
  assertRealPathInsideProject(currentPath, projectRoot);
}

function assertSafeClaudeMdPath(filePath: string, projectRoot: string): void {
  if (!existsSync(filePath)) return;
  if (lstatSync(filePath).isSymbolicLink() || !isInsidePath(realpathSync(filePath), projectRoot)) {
    throw new Error('Project standards CLAUDE.md must stay inside the project root');
  }
}

function assertSafeStandardsRoot(projectRoot: string): string {
  const resolvedRoot = normalizeRoot(projectRoot);
  const claudeDir = join(resolvedRoot, '.claude');
  const rulesDir = join(claudeDir, 'rules');
  assertDirectoryNotSymlink(claudeDir);
  assertDirectoryNotSymlink(rulesDir);

  if (existsSync(rulesDir)) {
    assertRealPathInsideProject(rulesDir, resolvedRoot);
    return realpathSync(rulesDir);
  }

  return rulesDir;
}

function parseLanguage(value: string): StandardsLanguage {
  const normalized = value.trim().toLowerCase();
  if (SUPPORTED_LANGUAGES.has(normalized as StandardsLanguage)) {
    return normalized as StandardsLanguage;
  }
  throw new Error('Unsupported standards language');
}

function detectLanguage(projectRoot: string): StandardsLanguage {
  if (existsSync(join(projectRoot, 'tsconfig.json'))) return 'typescript';
  if (existsSync(join(projectRoot, 'package.json'))) return 'javascript';
  if (existsSync(join(projectRoot, 'pyproject.toml')) || existsSync(join(projectRoot, 'requirements.txt'))) return 'python';
  if (existsSync(join(projectRoot, 'go.mod'))) return 'go';
  if (existsSync(join(projectRoot, 'Cargo.toml'))) return 'rust';
  return 'generic';
}

function renderHeader(title: string): string {
  return [
    `# ${title}`,
    '',
    'Source: Peaks curated baseline; everything-claude-code reference: https://github.com/affaan-m/everything-claude-code',
    'Scope: project-local standards for peaks-rd, peaks-qa, and peaks-solo workflow preflight.',
    ''
  ].join('\n');
}

function renderClaudeMd(language: StandardsLanguage): string {
  return [
    '# Project Instructions',
    '',
    '> 🤖 AI 生成，请审阅',
    '',
    'This repository uses project-local Peaks standards. Existing repository conventions override generic generated guidance.',
    '',
    'Peaks workflow automation:',
    '- peaks-rd checks these standards before RD planning or implementation work.',
    '- peaks-qa checks code review and security guidance before verification work.',
    '- peaks-solo summarizes RD and QA standards preflight before end-to-end code workflows.',
    '',
    'Rules:',
    '- Read `.claude/rules/common/coding-style.md` before editing code.',
    '- Read `.claude/rules/common/code-review.md` before reviewing changes.',
    '- Read `.claude/rules/common/security.md` before touching filesystem, user input, external calls, auth, or secrets.',
    `- Read .claude/rules/${language}/coding-style.md for language-specific standards when applicable.`,
    '',
    'External reference: https://github.com/affaan-m/everything-claude-code is used as a curated reference only. Do not execute or install external content without explicit approval.',
    ''
  ].join('\n');
}

function renderCommonCodingStyle(): string {
  return `${renderHeader('Common Coding Standards')}- Prefer simple, readable code over clever abstractions.
- Keep functions focused and files cohesive.
- Use immutable updates unless a language-specific convention explicitly favors mutation.
- Validate user input, external data, file paths, and configuration at system boundaries.
- Preserve existing project conventions when they are stricter than this baseline.
`;
}

function renderCodeReview(): string {
  return `${renderHeader('Code Review Standards')}- Review diffs for correctness, maintainability, test coverage, and regression risk.
- Treat missing tests for changed behavior as a blocker unless the change is documentation-only.
- Verify code paths that handle filesystem, external APIs, credentials, user input, or generated artifacts.
- peaks-qa must use this guidance as part of code workflow preflight and final verification.
`;
}

function renderSecurity(): string {
  return `${renderHeader('Security Review Standards')}- Never hardcode secrets, API keys, passwords, tokens, or credentials.
- Do not send private code or secrets to external services without explicit user authorization.
- Guard filesystem writes against path traversal, symlink, and junction escapes.
- Require explicit confirmation for destructive actions, external state changes, and credential use.
`;
}

function renderLanguageCodingStyle(language: StandardsLanguage): string {
  const languageName = language === 'generic' ? 'Generic' : language[0]!.toUpperCase() + language.slice(1);
  const typeSafetyRule = language === 'typescript' || language === 'javascript'
    ? '- Do not add new `any` types; use explicit domain types, generics, or `unknown` with narrowing.\n'
    : '';
  return `${renderHeader(`${languageName} Coding Standards`)}- Apply project-local conventions before generic ${language} guidance.
- Keep public APIs typed or documented according to ${language} ecosystem norms.
${typeSafetyRule}- Prefer standard tooling and existing project scripts for formatting, linting, tests, and coverage.
- peaks-rd must check this file before planning code changes in ${language} projects.
`;
}

function renderManagedClaudeMdIndex(language: StandardsLanguage): string {
  return [
    '<!-- peaks-standards:index:start -->',
    '## Peaks Standards Index',
    '- Constitution: `CLAUDE.md` is the repository-wide constitution.',
    '- Local laws: `.claude/rules/**` are project-local laws and are created only when missing.',
    '- Managed by: `peaks standards update`.',
    '- Managed files:',
    '  - `.claude/rules/common/code-review.md`',
    '  - `.claude/rules/common/coding-style.md`',
    '  - `.claude/rules/common/security.md`',
    `  - .claude/rules/${language}/coding-style.md`,
    '- Conflict note: keep the existing body unchanged and resolve any disagreement manually before the next standards update.',
    '<!-- peaks-standards:index:end -->',
    ''
  ].join('\n');
}

function readFileIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function getPendingStandardsRuleWrites(plan: ProjectStandardsInitPlan): StandardsWrite[] {
  return plan.plannedWrites.filter((write) => write.relativePath !== 'CLAUDE.md' && write.status !== 'existing');
}

function prevalidateWrites(projectRoot: string, writes: StandardsWrite[]): void {
  for (const write of writes) {
    const targetPath = resolve(write.filePath);
    const targetDir = dirname(targetPath);
    assertWritablePathInsideProject(targetDir, projectRoot);
    if (write.relativePath === 'CLAUDE.md') {
      assertSafeClaudeMdPath(targetPath, projectRoot);
    }
  }
}

function writeMissingStandardsRules(plan: ProjectStandardsInitPlan, writes = getPendingStandardsRuleWrites(plan)): string[] {
  const writtenFiles: string[] = [];

  for (const write of writes) {
    const targetPath = resolve(write.filePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeNewFile(targetPath, write.content);
    writtenFiles.push(write.relativePath);
  }

  return writtenFiles;
}

function createTemplates(language: StandardsLanguage): StandardsTemplate[] {
  return [
    { relativePath: 'CLAUDE.md', content: renderClaudeMd(language) },
    { relativePath: '.claude/rules/common/code-review.md', content: renderCodeReview() },
    { relativePath: '.claude/rules/common/coding-style.md', content: renderCommonCodingStyle() },
    { relativePath: '.claude/rules/common/security.md', content: renderSecurity() },
    { relativePath: `.claude/rules/${language}/coding-style.md`, content: renderLanguageCodingStyle(language) }
  ];
}

function createManagedClaudeBlock(language: StandardsLanguage): string {
  return renderManagedClaudeMdIndex(language);
}

function buildClaudeUpdate(projectRoot: string, language: StandardsLanguage): {
  readonly relativePath: 'CLAUDE.md';
  readonly filePath: string;
  readonly status: StandardsWriteStatus;
  readonly content: string;
  readonly appendBlock: string;
  readonly reviewSuggestions: string[];
} {
  const filePath = resolve(projectRoot, 'CLAUDE.md');
  assertSafeClaudeMdPath(filePath, projectRoot);
  const existingContent = readFileIfExists(filePath);
  const managedBlock = createManagedClaudeBlock(language);

  if (existingContent === null) {
    return {
      relativePath: 'CLAUDE.md',
      filePath,
      status: 'planned',
      content: `${renderClaudeMd(language).trimEnd()}\n\n${managedBlock}`,
      appendBlock: '',
      reviewSuggestions: []
    };
  }

  const existingBlockStart = existingContent.indexOf('<!-- peaks-standards:index:start -->');
  if (existingBlockStart < 0) {
    return {
      relativePath: 'CLAUDE.md',
      filePath,
      status: 'appended',
      content: `${existingContent.trimEnd()}

${managedBlock}`,
      appendBlock: `

${managedBlock}`,
      reviewSuggestions: []
    };
  }

  const existingManagedBlock = existingContent.slice(existingBlockStart).trimEnd();
  if (existingManagedBlock === managedBlock.trimEnd()) {
    return {
      relativePath: 'CLAUDE.md',
      filePath,
      status: 'existing',
      content: existingContent,
      appendBlock: '',
      reviewSuggestions: []
    };
  }

  return {
    relativePath: 'CLAUDE.md',
    filePath,
    status: 'review',
    content: existingContent,
    appendBlock: '',
    reviewSuggestions: ['Existing CLAUDE.md already has a managed standards block. Review the managed block manually before changing it.']
  };
}

function buildWrite(projectRoot: string, template: StandardsTemplate): StandardsWrite {
  const filePath = resolve(projectRoot, template.relativePath);
  return {
    ...template,
    filePath,
    status: existsSync(filePath) ? 'existing' : 'planned'
  };
}

function writeNewFile(path: string, content: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function appendExistingFile(path: string, content: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}

export function createProjectStandardsInitPlan(options: ProjectStandardsInitOptions): ProjectStandardsInitPlan {
  const projectRoot = normalizeRoot(options.projectRoot);
  assertSafeStandardsRoot(projectRoot);
  const language = options.language === undefined ? detectLanguage(projectRoot) : parseLanguage(options.language);
  const plannedWrites = createTemplates(language).map((template) => buildWrite(projectRoot, template));

  return {
    apply: options.apply ?? false,
    projectRoot,
    language,
    source: SOURCE,
    skillPreflight: SKILL_PREFLIGHT,
    plannedWrites
  };
}

export function createProjectStandardsUpdatePlan(options: ProjectStandardsInitOptions): ProjectStandardsUpdatePlan {
  const basePlan = createProjectStandardsInitPlan(options);
  const claudeMd = buildClaudeUpdate(basePlan.projectRoot, basePlan.language);
  return {
    ...basePlan,
    claudeMd
  };
}

export function executeProjectStandardsInit(options: ProjectStandardsInitOptions): ProjectStandardsInitResult {
  const plan = createProjectStandardsInitPlan(options);
  const writtenFiles: string[] = [];

  if (plan.apply) {
    assertSafeStandardsRoot(plan.projectRoot);
    const pendingWrites = plan.plannedWrites.filter((write) => write.status !== 'existing');
    prevalidateWrites(plan.projectRoot, pendingWrites);
    for (const write of pendingWrites) {
      const targetPath = resolve(write.filePath);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeNewFile(targetPath, write.content);
      writtenFiles.push(write.relativePath);
    }
  }

  return {
    ...plan,
    plannedWrites: plan.plannedWrites.map((write) => writtenFiles.includes(write.relativePath) ? { ...write, status: 'written' } : write),
    writtenFiles
  };
}

export function executeProjectStandardsUpdate(options: ProjectStandardsInitOptions): ProjectStandardsUpdateResult {
  const plan = createProjectStandardsUpdatePlan(options);
  const writtenFiles: string[] = [];
  const appendedFiles: string[] = [];
  const reviewSuggestions = [...plan.claudeMd.reviewSuggestions];
  let claudeMd = { ...plan.claudeMd };

  if (plan.apply) {
    assertSafeStandardsRoot(plan.projectRoot);
    const pendingRuleWrites = getPendingStandardsRuleWrites(plan);
    prevalidateWrites(plan.projectRoot, pendingRuleWrites);
    const targetPath = resolve(claudeMd.filePath);
    prevalidateWrites(plan.projectRoot, [claudeMd]);
    writtenFiles.push(...writeMissingStandardsRules(plan, pendingRuleWrites));

    if (claudeMd.status === 'planned') {
      writeNewFile(targetPath, claudeMd.content);
      writtenFiles.push(claudeMd.relativePath);
      claudeMd = { ...claudeMd, status: 'written' };
    } else if (claudeMd.status === 'appended') {
      appendExistingFile(targetPath, claudeMd.appendBlock);
      appendedFiles.push(claudeMd.relativePath);
    }
  }

  const plannedWrites = plan.plannedWrites.map((write) => {
    if (write.relativePath === 'CLAUDE.md') {
      return { ...write, status: claudeMd.status };
    }
    if (writtenFiles.includes(write.relativePath)) {
      return { ...write, status: 'written' as const };
    }
    return write;
  });

  return {
    ...plan,
    claudeMd,
    plannedWrites,
    writtenFiles,
    appendedFiles,
    reviewSuggestions
  };
}

export function summarizeProjectStandardsInitResult(result: ProjectStandardsInitResult): ProjectStandardsInitSummary {
  return {
    apply: result.apply,
    projectRoot: result.projectRoot,
    language: result.language,
    source: result.source,
    skillPreflight: result.skillPreflight,
    plannedWrites: result.plannedWrites.map((write) => ({ relativePath: write.relativePath, status: write.status })),
    writtenFiles: result.writtenFiles,
    skippedFiles: result.plannedWrites.filter((write) => write.status === 'existing').map((write) => write.relativePath)
  };
}

export function summarizeProjectStandardsUpdateResult(result: ProjectStandardsUpdateResult): ProjectStandardsUpdateSummary {
  return {
    apply: result.apply,
    projectRoot: result.projectRoot,
    language: result.language,
    source: result.source,
    skillPreflight: result.skillPreflight,
    plannedWrites: result.plannedWrites.map((write) => ({ relativePath: write.relativePath, status: write.status })),
    writtenFiles: result.writtenFiles,
    appendedFiles: result.appendedFiles,
    skippedFiles: result.plannedWrites.filter((write) => write.status === 'existing').map((write) => write.relativePath),
    reviewSuggestions: result.reviewSuggestions,
    claudeMd: {
      relativePath: result.claudeMd.relativePath,
      status: result.claudeMd.status,
      reviewSuggestions: result.claudeMd.reviewSuggestions
    }
  };
}
