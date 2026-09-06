import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { detectProjectContext, type ProjectContext } from './project-context.js';
import {
  renderClaudeMd,
  renderClaudeMdOneX,
  renderCodeReview,
  renderCommonCodingStyle,
  renderLanguageCodingStyle,
  renderManagedClaudeMdIndex,
  renderSecurity,
} from './standards-render.js';
export { renderUiLibraryPriorityRule } from './standards-render.js';

/**
 * Typed error raised when a planned `peaks standards` write target would
 * land outside `projectRoot` (or collide with the user-level baseline
 * under `<homedir>/.claude/**`). Surfaced as a stable error code so CLI
 * callers can map it to a recoverable hint.
 */
export type ProjectStandardsWriteTargetReason = 'outside-project-root' | 'resolves-to-homedir-claude';

export class ProjectStandardsWriteTargetError extends Error {
  public readonly code = 'PROJECT_STANDARDS_WRITE_TARGET_OUTSIDE_ROOT' as const;
  public readonly filePath: string;
  public readonly projectRoot: string;
  public readonly reason: ProjectStandardsWriteTargetReason;

  public constructor(input: {
    readonly filePath: string;
    readonly projectRoot: string;
    readonly reason: ProjectStandardsWriteTargetReason;
  }) {
    super(
      `Project standards write target '${input.filePath}' is rejected (reason: ${input.reason}); ` +
        `writes must stay inside project root '${input.projectRoot}'. ` +
        `Refusing to pollute the user-level ~/.claude/ baseline.`
    );
    this.name = 'ProjectStandardsWriteTargetError';
    this.filePath = input.filePath;
    this.projectRoot = input.projectRoot;
    this.reason = input.reason;
  }
}

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
  readonly appliesTo: readonly ['peaks-rd', 'peaks-qa', 'peaks-code'];
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

export type ProjectStandardsInitOptions = {
  readonly projectRoot: string;
  readonly language?: string;
  readonly apply?: boolean;
  /**
   * Test seam: override the homedir resolver used by the
   * write-target containment guard. Defaults to `os.homedir()`.
   * Production callers should NOT pass this — it exists so unit
   * tests can simulate the "projectRoot === homedir" trap without
   * mutating global Node state (which is read-only).
   */
  readonly resolveHomedir?: () => string;
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
  appliesTo: ['peaks-rd', 'peaks-qa', 'peaks-code'],
  summary: 'peaks-rd、peaks-qa、peaks-code 进入代码仓工作流时自动 preflight 项目规范。'
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
  const peaksDir = join(resolvedRoot, '.peaks');
  const peaksStandardsDir = join(peaksDir, 'standards');
  assertDirectoryNotSymlink(claudeDir);
  assertDirectoryNotSymlink(rulesDir);
  // 2.0 canonical layout — same symlink/junction protection as
  // the legacy `.claude/rules/` tree. A symlinked `.peaks/standards/`
  // is a write-target escape attempt and must be rejected.
  assertDirectoryNotSymlink(peaksDir);
  assertDirectoryNotSymlink(peaksStandardsDir);

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

function detectLanguageInternal(projectRoot: string): StandardsLanguage {
  if (existsSync(join(projectRoot, 'tsconfig.json'))) return 'typescript';
  if (existsSync(join(projectRoot, 'package.json'))) return 'javascript';
  if (existsSync(join(projectRoot, 'pyproject.toml')) || existsSync(join(projectRoot, 'requirements.txt'))) return 'python';
  if (existsSync(join(projectRoot, 'go.mod'))) return 'go';
  if (existsSync(join(projectRoot, 'Cargo.toml'))) return 'rust';
  return 'generic';
}

/**
 * Public alias for `detectLanguageInternal` so callers outside this
 * module (e.g. `workspace-service.ts` for the slice 2026-06-16 RD#7
 * auto-detect path) can ask the same heuristic without re-implementing
 * the file-probe logic.
 */
export function detectLanguage(projectRoot: string): StandardsLanguage {
  return detectLanguageInternal(projectRoot);
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

function prevalidateWrites(projectRoot: string, writes: StandardsWrite[], resolveHomedir: () => string = osHomedir): void {
  const homeRoot = resolveHomedir();
  for (const write of writes) {
    const targetPath = resolve(write.filePath);
    const targetDir = dirname(targetPath);
    assertWritablePathInsideProject(targetDir, projectRoot);
    if (write.relativePath === 'CLAUDE.md') {
      assertSafeClaudeMdPath(targetPath, projectRoot);
    }
    assertNotHomedirBaseline(targetPath, projectRoot, homeRoot);
  }
}

function assertNotHomedirBaseline(targetPath: string, projectRoot: string, homeRoot: string): void {
  if (homeRoot === '' || projectRoot === '') return;
  const realProjectRoot = normalizeRoot(projectRoot);
  const realHomeRoot = normalizeRoot(homeRoot);
  // Canonical "rules wrote to global instead of project" bug: when the
  // resolved projectRoot IS the user-level homedir, the planned write
  // would land at `~/.claude/**`, polluting the baseline installed by
  // `scripts/install-skills.mjs`. Defense in depth: never silently
  // write to the user-level baseline.
  //
  // Note: we deliberately do NOT reject projects that are merely
  // subdirectories of homedir (e.g. `~/Desktop/test/platform-rag-web`).
  // Those are normal consumer projects; the writes go to
  // `<projectRoot>/.claude/**`, NOT to `<homedir>/.claude/**`. The
  // second check below is the real protection: it inspects whether the
  // resolved write target itself lands inside `<homedir>/.claude/`,
  // which only fires for the canonical bug case (or any accidental
  // `~/` reference in the call chain that lands in `.claude/`).
  if (realProjectRoot === realHomeRoot) {
    throw new ProjectStandardsWriteTargetError({
      filePath: targetPath,
      projectRoot: realProjectRoot,
      reason: 'resolves-to-homedir-claude'
    });
  }
  // Reject if the resolved write target itself lands inside the
  // homedir's `.claude/` tree. This catches accidental `~/` usage anywhere
  // in the call chain even when projectRoot is sane. Walk up to the first
  // existing ancestor so realpathSync does not ENOENT on a planned file.
  const homeClaudeDir = join(realHomeRoot, '.claude');
  const realHomeClaudeDir = existsSync(homeClaudeDir) ? realpathSync(homeClaudeDir) : homeClaudeDir;
  let cursor = targetPath;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (!existsSync(cursor)) return; // Nothing on disk to inspect; the project-root check above already covered the case.
  const realTargetAncestor = realpathSync(cursor);
  if (isInsidePath(realTargetAncestor, realHomeClaudeDir)) {
    throw new ProjectStandardsWriteTargetError({
      filePath: realTargetAncestor,
      projectRoot: realProjectRoot,
      reason: 'resolves-to-homedir-claude'
    });
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

function createTemplates(language: StandardsLanguage, ctx: ProjectContext): StandardsTemplate[] {
  return [
    { relativePath: 'CLAUDE.md', content: renderClaudeMd(language, ctx) },
    { relativePath: '.peaks/standards/common/code-review.md', content: renderCodeReview(ctx) },
    { relativePath: '.peaks/standards/common/coding-style.md', content: renderCommonCodingStyle(ctx) },
    { relativePath: '.peaks/standards/common/security.md', content: renderSecurity(ctx) },
    { relativePath: `.peaks/standards/${language}/coding-style.md`, content: renderLanguageCodingStyle(language, ctx) }
  ];
}

/**
 * Legacy 1.x templates — used only when the consumer project
 * still carries a thick `.claude/rules/` tree. These mirror the
 * historical 1.x install layout so the existing files are not
 * silently overwritten; the caller should follow up with
 * `peaks standards migrate --from-claude-rules` to converge to
 * the 2.0 canonical layout.
 */
function createLegacyOneXTemplates(language: StandardsLanguage, ctx: ProjectContext): StandardsTemplate[] {
  return [
    { relativePath: 'CLAUDE.md', content: renderClaudeMdOneX(language, ctx) },
    { relativePath: '.claude/rules/common/code-review.md', content: renderCodeReview(ctx) },
    { relativePath: '.claude/rules/common/coding-style.md', content: renderCommonCodingStyle(ctx) },
    { relativePath: '.claude/rules/common/security.md', content: renderSecurity(ctx) },
    { relativePath: `.claude/rules/${language}/coding-style.md`, content: renderLanguageCodingStyle(language, ctx) }
  ];
}

/**
 * Detect whether the consumer project still carries a 1.x "thick"
 * `.claude/rules/` tree (the legacy layout that 2.0 migrates away
 * from). A project with thick 1.x rules should NOT be silently
 * re-initialised into the 2.0 `.peaks/standards/` layout; the
 * caller should explicitly run `peaks standards migrate --from-claude-rules`
 * instead. A new project (no `.claude/rules/` tree, or only a
 * previously-thinned 2-line-pointer tree) is safe to bootstrap
 * directly into the 2.0 canonical layout.
 */
function hasThickOneXClaudeRules(projectRoot: string): boolean {
  const claudeRulesDir = join(projectRoot, '.claude', 'rules');
  if (!existsSync(claudeRulesDir)) return false;
  const stat = lstatSync(claudeRulesDir);
  if (!stat.isDirectory()) return false;
  // Walk one level deep; if any .md file under common/ or
  // typescript/ (or the language pack) exists and is NOT a
  // 2-line pointer, treat the tree as thick 1.x.
  const POINTER_MARKER = 'Canonical peaks-loop 2.0 rules live at:';
  const stack = [claudeRulesDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const entryPath = join(dir, entry);
      let entryStat;
      try {
        entryStat = lstatSync(entryPath);
      } catch {
        continue;
      }
      if (entryStat.isDirectory()) {
        stack.push(entryPath);
      } else if (entryStat.isFile() && entry.endsWith('.md')) {
        let body = '';
        try {
          body = readFileSync(entryPath, 'utf8');
        } catch {
          continue;
        }
        if (!body.includes(POINTER_MARKER)) return true;
      }
    }
  }
  return false;
}

function createManagedClaudeBlock(language: StandardsLanguage): string {
  return renderManagedClaudeMdIndex(language);
}

function buildClaudeUpdate(projectRoot: string, language: StandardsLanguage, ctx: ProjectContext): {
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
      content: `${renderClaudeMd(language, ctx).trimEnd()}\n\n${managedBlock}`,
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
  const language = options.language === undefined ? detectLanguageInternal(projectRoot) : parseLanguage(options.language);
  const ctx = detectProjectContext(projectRoot);
  // Default to the 2.0 canonical layout (`.peaks/standards/`).
  // If the consumer project still carries a 1.x "thick" `.claude/rules/`
  // tree, fall back to the legacy 1.x path so the operator's existing
  // rules are never silently overwritten — the caller should follow up
  // with `peaks standards migrate --from-claude-rules` to migrate them
  // to 2.0.
  const useLegacyOneXLayout = hasThickOneXClaudeRules(projectRoot);
  const plannedWrites = useLegacyOneXLayout
    ? createLegacyOneXTemplates(language, ctx).map((template) => buildWrite(projectRoot, template))
    : createTemplates(language, ctx).map((template) => buildWrite(projectRoot, template));

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
  const ctx = detectProjectContext(basePlan.projectRoot);
  const claudeMd = buildClaudeUpdate(basePlan.projectRoot, basePlan.language, ctx);
  return {
    ...basePlan,
    claudeMd
  };
}

export function executeProjectStandardsInit(options: ProjectStandardsInitOptions): ProjectStandardsInitResult {
  const plan = createProjectStandardsInitPlan(options);
  const writtenFiles: string[] = [];
  const resolveHomedir = options.resolveHomedir ?? osHomedir;

  if (plan.apply) {
    assertSafeStandardsRoot(plan.projectRoot);
    const pendingWrites = plan.plannedWrites.filter((write) => write.status !== 'existing');
    prevalidateWrites(plan.projectRoot, pendingWrites, resolveHomedir);
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
  const resolveHomedir = options.resolveHomedir ?? osHomedir;

  if (plan.apply) {
    assertSafeStandardsRoot(plan.projectRoot);
    const pendingRuleWrites = getPendingStandardsRuleWrites(plan);
    prevalidateWrites(plan.projectRoot, pendingRuleWrites, resolveHomedir);
    const targetPath = resolve(claudeMd.filePath);
    prevalidateWrites(plan.projectRoot, [claudeMd], resolveHomedir);
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
