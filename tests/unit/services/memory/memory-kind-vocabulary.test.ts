// tests/unit/services/memory/memory-kind-vocabulary.test.ts
//
// Unit tests for the expanded memory-kind vocabulary (slice
// 2026-09-10-memory-vocab-and-rotate, E).
//
// Pins two things:
//   1. the accepted kind set — the single exported constant the parser,
//      index, doctor, and CLI all derive from;
//   2. the hot/warm tier mapping for every accepted kind.
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/memory-kind-vocabulary.test.ts

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  END_MARKER,
  executeMemoryReindex,
  extractStableProjectMemories,
  extractStableProjectMemoriesWithDiagnostics,
  HOT_MEMORY_KINDS,
  MEMORY_KIND_TIER,
  PROJECT_MEMORY_KINDS,
  resolveMemoryKind,
  START_MARKER,
  VALID_PROJECT_MEMORY_KINDS,
  WARM_MEMORY_KINDS
} from '~/src/services/memory/project-memory-service/index';

/** The 8 kinds that existed before the slice — must keep working unchanged. */
const ORIGINAL_KINDS = [
  'project',
  'rule',
  'decision',
  'reference',
  'feedback',
  'convention',
  'module',
  'lesson'
] as const;

/** Values observed on disk with a real kind the index schema used to reject. */
const EXPANDED_KINDS = [
  'design',
  'handoff',
  'session-handoff',
  'project-todo',
  'publish-closure',
  'project-rule',
  'project-closure',
  'slice-closure',
  'slice-pilot-findings',
  'bug',
  'investigation',
  'technical-pattern',
  'sediment'
] as const;

const HOT = [
  'feedback',
  'decision',
  'rule',
  'convention',
  'module',
  'lesson',
  'bug',
  'investigation',
  'technical-pattern',
  'project-rule'
] as const;

const WARM = [
  'project',
  'reference',
  'design',
  'handoff',
  'session-handoff',
  'project-todo',
  'publish-closure',
  'project-closure',
  'slice-closure',
  'slice-pilot-findings',
  'sediment'
] as const;

describe('memory kind vocabulary', () => {
  it('accepts the original 8 kinds plus the 13 observed values', () => {
    expect([...PROJECT_MEMORY_KINDS].sort()).toEqual([...ORIGINAL_KINDS, ...EXPANDED_KINDS].sort());
    expect(PROJECT_MEMORY_KINDS).toHaveLength(21);
    expect(VALID_PROJECT_MEMORY_KINDS).toHaveLength(21);
  });

  it('keeps every original kind accepted', () => {
    for (const kind of ORIGINAL_KINDS) {
      expect(PROJECT_MEMORY_KINDS).toContain(kind);
    }
  });

  it('pins the hot/warm tier mapping for every kind', () => {
    expect([...HOT_MEMORY_KINDS].sort()).toEqual([...HOT].sort());
    expect([...WARM_MEMORY_KINDS].sort()).toEqual([...WARM].sort());
    for (const kind of HOT) expect(MEMORY_KIND_TIER[kind]).toBe('hot');
    for (const kind of WARM) expect(MEMORY_KIND_TIER[kind]).toBe('warm');
  });

  it('partitions the accepted set into exactly one tier per kind', () => {
    const tiered = [...HOT_MEMORY_KINDS, ...WARM_MEMORY_KINDS];
    expect(tiered.sort()).toEqual([...PROJECT_MEMORY_KINDS].sort());
    expect(new Set(tiered).size).toBe(PROJECT_MEMORY_KINDS.length);
    for (const kind of PROJECT_MEMORY_KINDS) {
      expect(['hot', 'warm']).toContain(MEMORY_KIND_TIER[kind]);
    }
  });

  it('resolves every expanded kind through the shared frontmatter parser', () => {
    for (const kind of EXPANDED_KINDS) {
      const content = [
        '---',
        `name: sample-${kind}`,
        `description: ${kind} sample`,
        'metadata:',
        `  type: ${kind}`,
        '---',
        '',
        'Body.',
        ''
      ].join('\n');
      const resolution = resolveMemoryKind(content);
      expect(resolution.kind).toBe(kind);
      expect(resolution.rawKind).toBe(kind);
    }
  });

  it('still reports a genuinely unknown kind as unclassified', () => {
    const content = [
      '---',
      'name: sample',
      'description: sample',
      'metadata:',
      '  type: not-a-real-kind',
      '---',
      '',
      'Body.',
      ''
    ].join('\n');
    const resolution = resolveMemoryKind(content);
    expect(resolution.kind).toBeNull();
    expect(resolution.rawKind).toBe('not-a-real-kind');
  });
});

describe('expanded kinds in the index', () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-vocab-'));
    memoryDir = join(root, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeMemory(name: string, kind: string): void {
    writeFileSync(
      join(memoryDir, `${name}.md`),
      [
        '---',
        `name: ${name}`,
        `description: ${name}`,
        'metadata:',
        `  type: ${kind}`,
        '---',
        '',
        `Body for ${name}.`,
        ''
      ].join('\n'),
      'utf8'
    );
  }

  it('indexes every expanded kind into its declared tier bucket', () => {
    for (const kind of EXPANDED_KINDS) writeMemory(`sample-${kind}`, kind);

    const report = executeMemoryReindex({ projectRoot: root, apply: true });
    expect(report.scannedFiles).toBe(EXPANDED_KINDS.length);
    expect(report.indexed).toBe(EXPANDED_KINDS.length);
    expect(report.unclassified).toHaveLength(0);

    const index = JSON.parse(readFileSync(join(memoryDir, 'index.json'), 'utf8')) as {
      hot: Record<string, Array<{ name: string; kind: string }>>;
      warm: Record<string, Array<{ name: string; kind: string }>>;
    };

    for (const kind of EXPANDED_KINDS) {
      const bucket = MEMORY_KIND_TIER[kind] === 'hot' ? index.hot : index.warm;
      expect(bucket[kind], `${kind} should be indexed in ${MEMORY_KIND_TIER[kind]}`).toHaveLength(
        1
      );
      expect(bucket[kind]![0]!.kind).toBe(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// LLM-facing vocabulary surfaces — the other half of the contract
//
// Everything above pins the CODE's internal consistency (tuple ↔ tier map ↔
// parser). None of it reads `skills/**`, and that is precisely how the
// LLM-facing copy drifted to a stale 7-value subset of a 21-value tuple with
// no symptom: an LLM told "these seven are the legal values" simply never
// writes `feedback` (the second most common kind on disk in this repo) or the
// other thirteen.
//
// So this block reads the actual files and asserts the declared vocabulary
// equals the canonical tuple. Two failure classes are covered:
//
//   1. a DECLARATION (a pipe-joined list claiming to be the vocabulary, or an
//      inline `--kind <a|b|c>`) must name every canonical kind, exactly once;
//   2. a SAMPLE (a single `kind:` value inside an example block) must be a
//      real kind — it is illustrative, so it is deliberately NOT required to
//      enumerate the whole tuple.
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

/** Directories whose markdown instructs the LLM about memory `kind`. */
const VOCABULARY_DOC_ROOTS = ['skills', 'src/skills'] as const;

/**
 * Walk with `fs`, never `execSync('find …')`.
 *
 * On Windows `execSync` runs through `cmd.exe`, where `find` resolves to the
 * unrelated `System32\find.exe` and rejects `-name` outright. The same idiom
 * is used by `tests/unit/skills/loop-hygiene-block.test.ts` for the same
 * reason.
 */
function walkMarkdown(relativeDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.md')) found.push(rel);
    }
  };
  walk(relativeDir);
  return found.sort();
}

/** `--kind <a|b|c>` — an inline vocabulary declaration in prose. */
const KIND_OPTION = /--kind <([^>]*)>/g;

/** A `kind:` line declaring the vocabulary: a pipe-joined list, optionally
 *  behind a `#` comment marker (the TXT procedure embeds the template inside a
 *  shell-comment block). */
const KIND_BLOCK_DECLARATION =
  /^[ \t]*(?:#+[ \t]*)?kind:[ \t]*([a-z][a-z-]*(?:[ \t]*\|[ \t]*[a-z][a-z-]*)+)[ \t]*$/;

/** A `kind:` line naming ONE value — a sample inside an example block. */
const KIND_SAMPLE = /^[ \t]*(?:#+[ \t]*)?kind:[ \t]*([a-z][a-z-]*)[ \t]*$/;

type VocabularyDeclaration = {
  file: string;
  line: number;
  declared: string[];
  form: 'kind-block' | 'kind-option';
};

type VocabularySample = { file: string; line: number; declared: string };

function splitPipeList(raw: string): string[] {
  return raw
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function collectVocabularySurfaces(): {
  declarations: VocabularyDeclaration[];
  samples: VocabularySample[];
  files: string[];
} {
  const declarations: VocabularyDeclaration[] = [];
  const samples: VocabularySample[] = [];
  const files = VOCABULARY_DOC_ROOTS.flatMap((root) => walkMarkdown(root));

  for (const file of files) {
    const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      const line = index + 1;

      for (const match of text.matchAll(KIND_OPTION)) {
        const inner = match[1] ?? '';
        // A single-token `--kind <kind>` is a placeholder, not a declaration.
        if (!inner.includes('|')) continue;
        declarations.push({ file, line, declared: splitPipeList(inner), form: 'kind-option' });
      }

      const declaration = KIND_BLOCK_DECLARATION.exec(text);
      if (declaration !== null) {
        declarations.push({
          file,
          line,
          declared: splitPipeList(declaration[1] ?? ''),
          form: 'kind-block'
        });
        return;
      }
      const sample = KIND_SAMPLE.exec(text);
      if (sample !== null) {
        samples.push({ file, line, declared: sample[1] ?? '' });
      }
    });
  }

  return { declarations, samples, files };
}

const SURFACES = collectVocabularySurfaces();

describe('LLM-facing kind vocabulary surfaces', () => {
  it('finds the surfaces it claims to guard (anti-vacuity)', () => {
    // If the walk or either regex silently stops matching, every assertion
    // below would pass on an empty list. These pins make that impossible.
    expect(SURFACES.files).toContain('skills/bee/peaks-txt/SKILL.md');
    expect(SURFACES.declarations.length).toBeGreaterThanOrEqual(9);

    const txt = SURFACES.declarations.filter((d) => d.file === 'skills/bee/peaks-txt/SKILL.md');
    expect(
      txt.length,
      'peaks-txt must declare the vocabulary in its block template and its filter'
    ).toBeGreaterThanOrEqual(3);
    expect(
      txt.some((d) => d.form === 'kind-block'),
      'the memory-block template must be seen'
    ).toBe(true);
    expect(
      txt.some((d) => d.form === 'kind-option'),
      'the --kind filter must be seen'
    ).toBe(true);

    expect(SURFACES.samples.length, 'illustrative samples must be seen').toBeGreaterThanOrEqual(2);
  });

  it('every declared vocabulary equals the canonical tuple (no missing, no extra)', () => {
    expect(SURFACES.declarations.length).toBeGreaterThan(0);
    for (const { file, line, declared, form } of SURFACES.declarations) {
      const where = `${file}:${line} (${form})`;
      // Set equality, not sequence equality: a prose list has no ordering
      // semantics, so requiring the canonical order would fail a harmless
      // reorder. Membership is the drift-critical invariant.
      expect(new Set(declared), `${where} must declare exactly PROJECT_MEMORY_KINDS`).toEqual(
        new Set(PROJECT_MEMORY_KINDS)
      );
      expect(declared, `${where} must not repeat a kind`).toHaveLength(PROJECT_MEMORY_KINDS.length);
    }
  });

  it('every illustrative kind sample is a real kind', () => {
    expect(SURFACES.samples.length).toBeGreaterThan(0);
    for (const { file, line, declared } of SURFACES.samples) {
      expect(
        PROJECT_MEMORY_KINDS,
        `${file}:${line} sample '${declared}' must be a canonical kind`
      ).toContain(declared);
    }
  });
});

/**
 * The `--kind <kind>` option help is LLM-facing too: the model reads `--help`
 * output. A single-quoted help literal that enumerates several kinds is a
 * hand-maintained copy of the vocabulary and will drift exactly as the prose
 * lists did — the derived form is a template literal over
 * `VALID_PROJECT_MEMORY_KINDS` and cannot drift.
 *
 * This anchored single-quote scan deliberately does not match the derived
 * backtick form, so it flags only the regression it exists to prevent.
 */
const CLI_HELP_KIND_LIST =
  /'[^'\n]*\b(?:project|decision|convention|rule|reference|feedback|module|lesson)\b\s*(?:,|\|)\s*\b(?:project|decision|convention|rule|reference|feedback|module|lesson)\b\s*(?:,|\|)[^'\n]*'/;

function walkTypeScript(relativeDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.ts')) found.push(rel);
    }
  };
  walk(relativeDir);
  return found.sort();
}

describe('CLI kind help is derived, never hand-maintained', () => {
  it('no command file spells out a kind list in an option-help literal', () => {
    const files = walkTypeScript('src/cli/commands');
    expect(files.length, 'the walk must actually reach the command files').toBeGreaterThan(100);

    const projectCommands = `${REPO_ROOT}/src/cli/commands/project-commands.ts`;
    expect(files).toContain('src/cli/commands/project-commands.ts');
    expect(
      readFileSync(projectCommands, 'utf8'),
      'project memories --kind must derive its help'
    ).toContain('VALID_PROJECT_MEMORY_KINDS');

    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(join(REPO_ROOT, file), 'utf8')
        .split(/\r?\n/)
        .forEach((text, index) => {
          if (CLI_HELP_KIND_LIST.test(text)) offenders.push(`${file}:${index + 1}`);
        });
    }
    expect(offenders, 'hand-maintained kind list(s) found in CLI help').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The doc's block SYNTAX — the other half of the same contract
//
// The vocabulary block above guards WHICH kinds a doc may name. It says nothing
// about the marker SHAPE, and that is a second, nastier way to make a doc lie.
//
// `project-memory-loading.md` used to instruct the LLM to write blocks as
// `<!-- peaks-memory:start kind=lesson -->`. That is not a marker: the scan is
// `content.indexOf(START_MARKER)`, an exact-literal search, so an
// attribute-shaped marker is never found AT ALL — the block is not "dropped",
// it does not exist, and `warnings` stays empty. The failure is total and
// silent, strictly worse than the malformed-header case that the M2 diagnostics
// do report.
//
// So: every `peaks-memory:start` / `:end` comment in an LLM-facing doc must be
// byte-equal to the literal the parser searches for, and the doc's own fenced
// example must survive a real parse. A future doc cannot reintroduce a shape
// the parser ignores, and cannot print an example it would drop.
//
// Reproducing the wrong shape as a counter-example in prose is NOT allowed —
// the guard is a one-line invariant on purpose. Describe it instead.
// ---------------------------------------------------------------------------

/** `<!-- peaks-memory:start … -->` / `…:end … -->`, whatever the inner text. */
const ANY_MEMORY_MARKER = /<!--\s*peaks-memory:(start|end)\b[^>]*-->/g;

type MarkerSite = { file: string; line: number; found: string };

function collectMemoryMarkerSites(): { sites: MarkerSite[]; files: string[] } {
  const sites: MarkerSite[] = [];
  const files = VOCABULARY_DOC_ROOTS.flatMap((root) => walkMarkdown(root));
  for (const file of files) {
    readFileSync(join(REPO_ROOT, file), 'utf8')
      .split(/\r?\n/)
      .forEach((text, index) => {
        for (const match of text.matchAll(ANY_MEMORY_MARKER)) {
          sites.push({ file, line: index + 1, found: match[0] });
        }
      });
  }
  return { sites, files };
}

const MARKER_SITES = collectMemoryMarkerSites();

/** Every fenced ```markdown block in a doc that contains a start marker. */
function fencedMemoryExamples(relativePath: string): string[] {
  const content = readFileSync(join(REPO_ROOT, relativePath), 'utf8');
  const blocks = [...content.matchAll(/```markdown\n([\s\S]*?)```/g)].map(
    (match) => match[1] ?? ''
  );
  return blocks.filter((block) => block.includes(START_MARKER));
}

describe('LLM-facing memory-block syntax matches what the parser searches for', () => {
  it('finds the marker sites it claims to guard (anti-vacuity)', () => {
    // If the walk or the regex silently stops matching, the assertion below
    // would pass on an empty list and guard nothing.
    expect(MARKER_SITES.files.length, 'the skills walk must reach the live docs').toBeGreaterThan(
      100
    );
    expect(MARKER_SITES.sites.length, 'live docs embed memory markers').toBeGreaterThanOrEqual(20);
    const txt = MARKER_SITES.sites.filter((site) => site.file === 'skills/bee/peaks-txt/SKILL.md');
    expect(txt.length, 'peaks-txt must show a memory-block example').toBeGreaterThanOrEqual(2);
  });

  it('every marker is the exact literal, so no doc can teach an unfindable block', () => {
    const offenders = MARKER_SITES.sites
      .filter((site) => site.found !== (site.found.includes(':start') ? START_MARKER : END_MARKER))
      .map(
        (site) =>
          `${site.file}:${site.line} — ${JSON.stringify(site.found)} is not ${JSON.stringify(site.found.includes(':start') ? START_MARKER : END_MARKER)}; the parser searches for the literal, so this block would be invisible`
      );
    expect(
      offenders,
      'a marker with attributes is not a marker: the block is never found, never warned about, and lost'
    ).toEqual([]);
  });

  it("the loading doc's own example survives a real parse", () => {
    const doc = 'skills/peaks-code/references/project-memory-loading.md';
    const examples = fencedMemoryExamples(doc);
    expect(examples, `${doc} must show at least one parseable memory block`).toHaveLength(1);

    const example = examples[0]!;
    const { memories, dropped } = extractStableProjectMemoriesWithDiagnostics(example, doc);
    expect(dropped, 'the instruction must not demo a block the parser drops').toEqual([]);
    expect(memories, 'the instruction must demo exactly one valid block').toHaveLength(1);
    expect(memories[0]!.title.length).toBeGreaterThan(0);
    expect(PROJECT_MEMORY_KINDS).toContain(memories[0]!.kind);

    // Parity with the plain projection, mirroring the M2 guard.
    expect(
      extractStableProjectMemories(example, doc),
      'diagnostics must not change acceptance'
    ).toEqual(memories);
  });
});
