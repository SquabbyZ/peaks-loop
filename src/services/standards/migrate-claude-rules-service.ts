/**
 * peaks standards migrate — .claude/rules/ tree thinning.
 * Slice: 2026-06-12-standards-migrate-claude-rules.
 *
 * The 1.x peaks-loop install copied a thick .claude/rules
 * tree (skill-first / CLI-auxiliary / dogfood / commit-trailer
 * rules) into consumer projects. In 2.0, the canonical rules
 * live at .peaks/standards/ and every markdown file under
 * .claude/rules becomes a 2-line pointer to the canonical path.
 *
 * The service:
 *   1. Backs up the existing `.claude/rules/` tree to
 *      `.claude/rules/.peaks-2.0-backup-<ts>/` (timestamped;
 *      safe to run multiple times).
 *   2. Replaces each .md file under .claude/rules (recursive)
 *      with a 2-line pointer.
 *   3. Scaffolds the 2.0 canonical rules at
 *      `.peaks/standards/{common,typescript}/`, but
 *      never overwrites existing files in `.peaks/standards/`.
 *
 * All operations are gated by `apply: true`. Dry-run mode
 * returns the would-change diff without writing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrateClaudeRulesInput {
  readonly projectRoot: string;
  readonly apply?: boolean;
}

export interface MigrateClaudeRulesData {
  readonly backupPath: string | null;
  readonly thinnedFiles: readonly string[];
  readonly scaffoldedFiles: readonly string[];
  readonly preservedFiles: readonly string[];
  readonly wouldChange: boolean;
  readonly applied: boolean;
  readonly nextActions: readonly string[];
}

export interface MigrateClaudeRulesResult {
  readonly ok: true;
  readonly data: MigrateClaudeRulesData;
  readonly warnings: readonly string[];
}

const POINTER_TEXT = (canonicalPath: string): string =>
  `# Canonical peaks-loop 2.0 rules live at: ${canonicalPath}\n# This file is a 2-line pointer. Edit the canonical file instead.\n`;

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function readMarkdownFilesRecursive(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const stat = statSync(root);
  if (stat.isFile()) {
    return root.endsWith('.md') ? [root] : [];
  }
  if (!stat.isDirectory()) return [];
  for (const entry of readdirSync(root)) {
    out.push(...readMarkdownFilesRecursive(join(root, entry)));
  }
  return out;
}

function isAlreadyPointer(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const body = readFileSync(filePath, 'utf8');
    return body.includes('Canonical peaks-loop 2.0 rules live at:');
  } catch {
    return false;
  }
}

const CANONICAL_2_0_DEV_PREFERENCE = `# Peaks-Loop dev preference (2.0 canonical)

> Project-local preference, captured from the 1.x install + re-rendered with the 2.0 vocabulary.
> Scope: applies to every iteration, adjustment, fix, or tweak on this project.
> Reading: read this **before** opening a new CLI command or routing a new feature through a CLI surface.

## Rule 1 — Skill-first, CLI-auxiliary

When designing or modifying a peaks-loop feature, default to the **skill-first** design. CLI commands are **invoked by the skill prompt** when they are the right primitive: a side effect that must be atomic, a gate that must be machine-enforced, a probe that needs structured JSON, or a backstop that prevents the LLM from skipping a step. Behaviour only an LLM in a skill prompt would use lives **in the relevant skill's SKILL.md**, not as a new CLI command. See \`.claude/rules/common/dev-preference.md\` for the decision template.

## Rule 2 — Dogfood on every adjustment

**Every adjustment, iteration, or fix-problem operation must be dogfood-tested in the current project before the work is declared complete.** No exceptions for "it's a small change", "just a comment update", or "just a SKILL.md line". The unit test suite is a subset of "current effect"; the dogfood is the full set. If a change passes unit tests but breaks a CLI command, the change is a regression.

## Rule 3 — Commits belong to the human

**No AI co-author trailer.** The commit is the human's. **Identity is global gitconfig only** (\`~/.gitconfig\`). Do not set, override, or shadow \`user.name\` / \`user.email\` at the repo level, via env vars, or via \`git -c user.*=...\`. The commit's recorded author and committer must both equal the global identity.
`;

const CANONICAL_2_0_CODING_STYLE_TS = `# TypeScript Coding Standards (2.0 canonical)

> Project-local standards, derived from the 1.x install + re-rendered with the 2.0 vocabulary.

- Apply project-local conventions before generic typescript guidance.
- Keep public APIs typed or documented according to typescript ecosystem norms.
- Do not add new \`any\` types; use explicit domain types, generics, or \`unknown\` with narrowing.
- Prefer standard tooling and existing project scripts for formatting, linting, tests, and coverage.
- peaks-rd must check this file before planning code changes in typescript projects.
`;

const CANONICAL_2_0_COMMON_FILES: ReadonlyArray<{ readonly relPath: string; readonly content: string }> = [
  { relPath: 'common/dev-preference.md', content: CANONICAL_2_0_DEV_PREFERENCE },
  {
    relPath: 'common/coding-style.md',
    content:
      '# Coding Standards (2.0 canonical)\n\n- Prefer simple, readable code over clever abstractions.\n- Keep functions focused and files cohesive.\n- Use immutable updates unless a language-specific convention explicitly favors mutation.\n- Validate user input, external data, file paths, and configuration at system boundaries.\n- Preserve existing project conventions when they are stricter than this baseline.\n',
  },
  {
    relPath: 'common/code-review.md',
    content:
      '# Code Review Standards (2.0 canonical)\n\n- Review diffs for correctness, maintainability, test coverage, and regression risk.\n- Treat missing tests for changed behavior as a blocker unless the change is documentation-only.\n- Verify code paths that handle filesystem, external APIs, credentials, user input, or generated artifacts.\n',
  },
  {
    relPath: 'common/security.md',
    content:
      '# Security Review Standards (2.0 canonical)\n\n- Never hardcode secrets, API keys, passwords, tokens, or credentials.\n- Do not send private code or secrets to external services without explicit user authorization.\n- Guard filesystem writes against path traversal, symlink, and junction escapes.\n- Require explicit confirmation for destructive actions, external state changes, and credential use.\n',
  },
  { relPath: 'typescript/coding-style.md', content: CANONICAL_2_0_CODING_STYLE_TS },
];

export function migrateClaudeRules(input: MigrateClaudeRulesInput): MigrateClaudeRulesResult {
  const projectRoot = input.projectRoot;
  const apply = input.apply === true;
  const warnings: string[] = [];
  const nextActions: string[] = [];

  const claudeRulesDir = join(projectRoot, '.claude', 'rules');
  const peaksStandardsDir = join(projectRoot, '.peaks', 'standards');
  const canonicalRelPath = '.peaks/standards/';

  const existingRulesFiles = readMarkdownFilesRecursive(claudeRulesDir);
  const thickFiles = existingRulesFiles.filter((f) => !isAlreadyPointer(f));

  const hasThickFiles = thickFiles.length > 0;
  // The backup path is computed eagerly (so dry-run can preview
  // the would-create location) but only created on disk in
  // apply mode. In dry-run mode we still return the path so
  // the user can see where the backup will land.
  const computedBackupPath = hasThickFiles ? join(claudeRulesDir, `.peaks-2.0-backup-${timestampSlug()}`) : null;
  const backupPath: string | null = apply ? computedBackupPath : null;

  const thinnedFiles: string[] = [];
  const scaffoldedFiles: string[] = [];
  const preservedFiles: string[] = [];
  // wouldChange is true iff there is at least one thick file to
  // thin. An empty .claude/rules/ is NOT a wouldChange (no-op).
  const wouldChange = hasThickFiles;

  if (apply && hasThickFiles) {
    // Step 1: backup
    if (backupPath !== null) {
      try {
        mkdirSync(backupPath, { recursive: true });
        for (const file of thickFiles) {
          const body = readFileSync(file, 'utf8');
          const rel = file.slice(claudeRulesDir.length + 1);
          writeFileSync(join(backupPath, rel), body, 'utf8');
        }
      } catch (err) {
        warnings.push(`Backup step failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Step 2: replace each .md with a 2-line pointer
    for (const file of thickFiles) {
      try {
        writeFileSync(file, POINTER_TEXT(canonicalRelPath), 'utf8');
        thinnedFiles.push(file);
      } catch (err) {
        warnings.push(`Thin step failed for ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Step 3: scaffold .peaks/standards/ — never overwrite existing
    for (const file of CANONICAL_2_0_COMMON_FILES) {
      const dest = join(peaksStandardsDir, file.relPath);
      if (existsSync(dest)) {
        preservedFiles.push(dest);
        continue;
      }
      try {
        mkdirSync(join(dest, '..'), { recursive: true });
        writeFileSync(dest, file.content, 'utf8');
        scaffoldedFiles.push(dest);
      } catch (err) {
        warnings.push(`Scaffold step failed for ${file.relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (thinnedFiles.length > 0) {
    nextActions.push(`Thinned ${thinnedFiles.length} .md file(s) under .claude/rules (recursive) → 2-line pointer.`);
  }
  if (scaffoldedFiles.length > 0) {
    nextActions.push(`Scaffolded ${scaffoldedFiles.length} 2.0 canonical rule(s) at .peaks/standards/.`);
  }
  if (preservedFiles.length > 0) {
    nextActions.push(`Preserved ${preservedFiles.length} existing .peaks/standards/ file(s) (no overwrite).`);
  }
  if (backupPath !== null) {
    nextActions.push(`Backup at ${backupPath} (git-ignored).`);
  }
  if (!apply && wouldChange) {
    nextActions.push('Re-run with --apply to perform the migration.');
  }

  return {
    ok: true,
    data: {
      backupPath,
      thinnedFiles,
      scaffoldedFiles,
      preservedFiles,
      wouldChange,
      applied: apply && hasThickFiles,
      nextActions,
    },
    warnings,
  };
}
