import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { detectProjectContext, type ProjectContext } from './project-context.js';
import {
  renderCodeReview,
  renderCommonCodingStyle,
  renderLanguageCodingStyle,
  renderSecurity
} from './standards-render.js';
import { renderAgentsMd, renderClaudeMdPointer } from './standards-render-agents.js';
import {
  assertSafeConstitutionPath,
  buildConstitutionUpdate,
  DEFAULT_CONSTITUTION,
  isConstitutionPath,
  isInsidePath,
  summarizeConstitutionUpdate,
  type ConstitutionFileUpdate,
  type ConstitutionUpdate,
  type ConstitutionUpdateSummary,
  type StandardsConstitution
} from './standards-constitution.js';
import { applyConstitutionFile, hasThickOneXClaudeRules, writeNewFile } from './standards-files.js';
import { detectProjectScripts, type ProjectScripts } from './project-scripts.js';
export { renderUiLibraryPriorityRule } from './standards-render.js';

/**
 * Typed error raised when a planned `peaks standards` write target would
 * land outside `projectRoot` (or collide with the user-level baseline
 * under `<homedir>/.claude/**`). Surfaced as a stable error code so CLI
 * callers can map it to a recoverable hint.
 */
export type ProjectStandardsWriteTargetReason =
  'outside-project-root' | 'resolves-to-homedir-claude';

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
  /** Which instruction files this project owns, and where its standards live. */
  readonly constitution: StandardsConstitution;
  /** The directory the project's standards files live in. */
  readonly rulesRoot: string;
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
  /** The write plan for the body file and, when the IDE needs one, its pointer. */
  readonly constitutionUpdate: ConstitutionUpdate;
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
  readonly constitutionUpdate: ConstitutionUpdateSummary;
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
  /**
   * Which instruction files this project owns. Defaults to
   * {@link DEFAULT_CONSTITUTION} — the body file plus the pointer that
   * imports it. The IDE-aware layer narrows it for IDEs that read the body
   * file directly and need no pointer.
   */
  readonly constitution?: StandardsConstitution;
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

const SUPPORTED_LANGUAGES = new Set<StandardsLanguage>([
  'generic',
  'typescript',
  'javascript',
  'python',
  'go',
  'rust'
]);

function normalizeRoot(path: string): string {
  return realpathSync(resolve(path));
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
  if (
    existsSync(join(projectRoot, 'pyproject.toml')) ||
    existsSync(join(projectRoot, 'requirements.txt'))
  )
    return 'python';
  if (existsSync(join(projectRoot, 'go.mod'))) return 'go';
  if (existsSync(join(projectRoot, 'Cargo.toml'))) return 'rust';
  return 'generic';
}

/**
 * Public alias for `detectLanguageInternal` so callers outside this
 * auto-detect path) can ask the same heuristic without re-implementing
 * the file-probe logic.
 */
export function detectLanguage(projectRoot: string): StandardsLanguage {
  return detectLanguageInternal(projectRoot);
}

function getPendingStandardsRuleWrites(plan: ProjectStandardsInitPlan): StandardsWrite[] {
  return plan.plannedWrites.filter(
    (write) => !isConstitutionPath(write.relativePath) && write.status !== 'existing'
  );
}

function prevalidateWrites(
  projectRoot: string,
  writes: StandardsWrite[],
  resolveHomedir: () => string = osHomedir
): void {
  const homeRoot = resolveHomedir();
  for (const write of writes) {
    const targetPath = resolve(write.filePath);
    const targetDir = dirname(targetPath);
    assertWritablePathInsideProject(targetDir, projectRoot);
    if (isConstitutionPath(write.relativePath)) {
      assertSafeConstitutionPath(targetPath, projectRoot);
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

function writeMissingStandardsRules(
  plan: ProjectStandardsInitPlan,
  writes = getPendingStandardsRuleWrites(plan)
): string[] {
  const writtenFiles: string[] = [];

  for (const write of writes) {
    const targetPath = resolve(write.filePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeNewFile(targetPath, write.content);
    writtenFiles.push(write.relativePath);
  }

  return writtenFiles;
}

/** The standards directory of the 2.0 canonical layout. */
const CANONICAL_RULES_ROOT = '.peaks/standards';

/** The standards directory of the 1.x layout a thick `.claude/rules/` tree implies. */
const LEGACY_RULES_ROOT = '.claude/rules';

/**
 * The 2.0 canonical layout: the shared cross-tool body, the pointer that
 * imports it, and the project-local standards tree.
 */
function createTemplates(input: {
  readonly constitution: StandardsConstitution;
  readonly language: StandardsLanguage;
  readonly ctx: ProjectContext;
  readonly scripts: ProjectScripts;
}): StandardsTemplate[] {
  const templates: StandardsTemplate[] = [
    {
      relativePath: input.constitution.bodyFile,
      content: renderAgentsMd(input.language, input.scripts, CANONICAL_RULES_ROOT)
    }
  ];
  if (input.constitution.pointerFile !== null) {
    templates.push({
      relativePath: input.constitution.pointerFile,
      content: renderClaudeMdPointer()
    });
  }
  templates.push(
    {
      relativePath: '.peaks/standards/common/code-review.md',
      content: renderCodeReview(input.ctx)
    },
    {
      relativePath: '.peaks/standards/common/coding-style.md',
      content: renderCommonCodingStyle(input.ctx)
    },
    { relativePath: '.peaks/standards/common/security.md', content: renderSecurity(input.ctx) },
    {
      relativePath: `.peaks/standards/${input.language}/coding-style.md`,
      content: renderLanguageCodingStyle(input.language, input.ctx)
    }
  );
  return templates;
}

/**
 * Legacy 1.x templates — used only when the consumer project
 * still carries a thick `.claude/rules/` tree. These mirror the
 * historical 1.x install layout so the existing files are not
 * silently overwritten; the caller should follow up with
 * `peaks standards migrate --from-claude-rules` to converge to
 * the 2.0 canonical layout.
 *
 * The constitution is the SAME two files as in the 2.0 layout — the body
 * plus the pointer that imports it — so a project on either layout ends up
 * with one body and one pointer; only the directory the body points its
 * standards reads at differs.
 */
function createLegacyOneXTemplates(input: {
  readonly constitution: StandardsConstitution;
  readonly language: StandardsLanguage;
  readonly ctx: ProjectContext;
  readonly scripts: ProjectScripts;
}): StandardsTemplate[] {
  const templates: StandardsTemplate[] = [
    {
      relativePath: input.constitution.bodyFile,
      content: renderAgentsMd(input.language, input.scripts, LEGACY_RULES_ROOT)
    }
  ];
  if (input.constitution.pointerFile !== null) {
    templates.push({
      relativePath: input.constitution.pointerFile,
      content: renderClaudeMdPointer()
    });
  }
  templates.push(
    { relativePath: '.claude/rules/common/code-review.md', content: renderCodeReview(input.ctx) },
    {
      relativePath: '.claude/rules/common/coding-style.md',
      content: renderCommonCodingStyle(input.ctx)
    },
    { relativePath: '.claude/rules/common/security.md', content: renderSecurity(input.ctx) },
    {
      relativePath: `.claude/rules/${input.language}/coding-style.md`,
      content: renderLanguageCodingStyle(input.language, input.ctx)
    }
  );
  return templates;
}

/**
 * The write plan for the constitution files — the shared body and, when the
 * IDE needs one, the pointer that imports it.
 *
 * The four-state decision (create / append / leave / ask for a review) lives
 * in `standards-constitution.ts`, next to the rule that a file which already
 * exists is never overwritten.
 */
function buildWrite(projectRoot: string, template: StandardsTemplate): StandardsWrite {
  const filePath = resolve(projectRoot, template.relativePath);
  return {
    ...template,
    filePath,
    status: existsSync(filePath) ? 'existing' : 'planned'
  };
}

export function createProjectStandardsInitPlan(
  options: ProjectStandardsInitOptions
): ProjectStandardsInitPlan {
  const projectRoot = normalizeRoot(options.projectRoot);
  assertSafeStandardsRoot(projectRoot);
  const language =
    options.language === undefined
      ? detectLanguageInternal(projectRoot)
      : parseLanguage(options.language);
  const ctx = detectProjectContext(projectRoot);
  const scripts = detectProjectScripts(projectRoot);
  const constitution = options.constitution ?? DEFAULT_CONSTITUTION;
  // Default to the 2.0 canonical layout (`.peaks/standards/`).
  // If the consumer project still carries a 1.x "thick" `.claude/rules/`
  // tree, fall back to the legacy 1.x path so the operator's existing
  // rules are never silently overwritten — the caller should follow up
  // with `peaks standards migrate --from-claude-rules` to migrate them
  // to 2.0.
  const useLegacyOneXLayout = hasThickOneXClaudeRules(projectRoot);
  const rulesRoot = useLegacyOneXLayout ? LEGACY_RULES_ROOT : CANONICAL_RULES_ROOT;
  const templates = useLegacyOneXLayout
    ? createLegacyOneXTemplates({ constitution, language, ctx, scripts })
    : createTemplates({ constitution, language, ctx, scripts });
  const plannedWrites = templates.map((template) => buildWrite(projectRoot, template));

  return {
    apply: options.apply ?? false,
    projectRoot,
    language,
    source: SOURCE,
    skillPreflight: SKILL_PREFLIGHT,
    constitution,
    rulesRoot,
    plannedWrites
  };
}

export function createProjectStandardsUpdatePlan(
  options: ProjectStandardsInitOptions
): ProjectStandardsUpdatePlan {
  const basePlan = createProjectStandardsInitPlan(options);
  const scripts = detectProjectScripts(basePlan.projectRoot);
  const constitutionUpdate = buildConstitutionUpdate({
    projectRoot: basePlan.projectRoot,
    constitution: basePlan.constitution,
    language: basePlan.language,
    scripts,
    rulesRoot: basePlan.rulesRoot
  });
  return {
    ...basePlan,
    constitutionUpdate
  };
}

export function executeProjectStandardsInit(
  options: ProjectStandardsInitOptions
): ProjectStandardsInitResult {
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
    plannedWrites: plan.plannedWrites.map((write) =>
      writtenFiles.includes(write.relativePath) ? { ...write, status: 'written' } : write
    ),
    writtenFiles
  };
}

/**
 * The planned-write statuses after the constitution files were applied.
 *
 * A constitution file takes the status the update gave it; a rules file
 * takes `written` when this run wrote it; everything else keeps its plan
 * status.
 */
function mergePlannedWriteStatuses(input: {
  readonly plannedWrites: readonly StandardsWrite[];
  readonly bodyPath: string;
  readonly bodyStatus: StandardsWriteStatus;
  readonly pointerPath: string | null;
  readonly pointerStatus: StandardsWriteStatus | null;
  readonly writtenFiles: readonly string[];
}): StandardsWrite[] {
  return input.plannedWrites.map((write) => {
    if (write.relativePath === input.bodyPath) return { ...write, status: input.bodyStatus };
    if (input.pointerPath !== null && write.relativePath === input.pointerPath) {
      return { ...write, status: input.pointerStatus ?? write.status };
    }
    if (input.writtenFiles.includes(write.relativePath)) {
      return { ...write, status: 'written' as const };
    }
    return write;
  });
}

/**
 * Write the rules files and the constitution files of one update run.
 *
 * Returns the status each constitution file ended at.
 */
function applyUpdateWrites(input: {
  readonly plan: ProjectStandardsUpdatePlan;
  readonly writtenFiles: string[];
  readonly appendedFiles: string[];
  readonly resolveHomedir: () => string;
}): {
  readonly bodyStatus: StandardsWriteStatus;
  readonly pointerStatus: StandardsWriteStatus | null;
} {
  const pointerPlan = input.plan.constitutionUpdate.pointer;
  assertSafeStandardsRoot(input.plan.projectRoot);
  const pendingRuleWrites = getPendingStandardsRuleWrites(input.plan);
  prevalidateWrites(input.plan.projectRoot, pendingRuleWrites, input.resolveHomedir);
  input.writtenFiles.push(...writeMissingStandardsRules(input.plan, pendingRuleWrites));
  const prevalidate = (file: ConstitutionFileUpdate): void =>
    prevalidateWrites(input.plan.projectRoot, [file], input.resolveHomedir);
  const bodyStatus = applyConstitutionFile({
    file: input.plan.constitutionUpdate.body,
    writtenFiles: input.writtenFiles,
    appendedFiles: input.appendedFiles,
    prevalidate
  });
  if (pointerPlan === null) return { bodyStatus, pointerStatus: null };
  const pointerStatus = applyConstitutionFile({
    file: pointerPlan,
    writtenFiles: input.writtenFiles,
    appendedFiles: input.appendedFiles,
    prevalidate
  });
  return { bodyStatus, pointerStatus };
}

export function executeProjectStandardsUpdate(
  options: ProjectStandardsInitOptions
): ProjectStandardsUpdateResult {
  const plan = createProjectStandardsUpdatePlan(options);
  const writtenFiles: string[] = [];
  const appendedFiles: string[] = [];
  const pointerPlan = plan.constitutionUpdate.pointer;
  const reviewSuggestions = [
    ...plan.constitutionUpdate.body.reviewSuggestions,
    ...(pointerPlan === null ? [] : pointerPlan.reviewSuggestions)
  ];
  const resolveHomedir = options.resolveHomedir ?? osHomedir;
  let bodyStatus = plan.constitutionUpdate.body.status;
  let pointerStatus = pointerPlan === null ? null : pointerPlan.status;

  if (plan.apply) {
    const applied = applyUpdateWrites({ plan, writtenFiles, appendedFiles, resolveHomedir });
    bodyStatus = applied.bodyStatus;
    pointerStatus = applied.pointerStatus;
  }

  const bodyPath = plan.constitutionUpdate.body.relativePath;
  const pointerPath = pointerPlan === null ? null : pointerPlan.relativePath;
  const plannedWrites = mergePlannedWriteStatuses({
    plannedWrites: plan.plannedWrites,
    bodyPath,
    bodyStatus,
    pointerPath,
    pointerStatus,
    writtenFiles
  });

  return {
    ...plan,
    constitutionUpdate: {
      body: { ...plan.constitutionUpdate.body, status: bodyStatus },
      pointer:
        pointerPlan === null
          ? null
          : { ...pointerPlan, status: pointerStatus ?? pointerPlan.status }
    },
    plannedWrites,
    writtenFiles,
    appendedFiles,
    reviewSuggestions
  };
}

export function summarizeProjectStandardsInitResult(
  result: ProjectStandardsInitResult
): ProjectStandardsInitSummary {
  return {
    apply: result.apply,
    projectRoot: result.projectRoot,
    language: result.language,
    source: result.source,
    skillPreflight: result.skillPreflight,
    plannedWrites: result.plannedWrites.map((write) => ({
      relativePath: write.relativePath,
      status: write.status
    })),
    writtenFiles: result.writtenFiles,
    skippedFiles: result.plannedWrites
      .filter((write) => write.status === 'existing')
      .map((write) => write.relativePath)
  };
}

export function summarizeProjectStandardsUpdateResult(
  result: ProjectStandardsUpdateResult
): ProjectStandardsUpdateSummary {
  return {
    apply: result.apply,
    projectRoot: result.projectRoot,
    language: result.language,
    source: result.source,
    skillPreflight: result.skillPreflight,
    plannedWrites: result.plannedWrites.map((write) => ({
      relativePath: write.relativePath,
      status: write.status
    })),
    writtenFiles: result.writtenFiles,
    appendedFiles: result.appendedFiles,
    skippedFiles: result.plannedWrites
      .filter((write) => write.status === 'existing')
      .map((write) => write.relativePath),
    reviewSuggestions: result.reviewSuggestions,
    constitutionUpdate: summarizeConstitutionUpdate(result.constitutionUpdate)
  };
}
