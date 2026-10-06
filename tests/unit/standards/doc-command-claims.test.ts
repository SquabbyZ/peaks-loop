// tests/unit/standards/doc-command-claims.test.ts
//
// Every "peaks <command>" written inside an EXECUTABLE code fence in the shipped
// docs must resolve against the tree commander actually registers.
//
// Why this class of defect gets a guard instead of a cleanup pass: the docs are
// read by an LLM that then runs the command. "peaks audit-goal" is not a
// stylistic slip — the agent types it, gets COMMAND_NOT_FOUND mid-task, and the
// same document names no other path. Measured the day this file was added: 60
// executable-fence claims across 25 docs, 1 of them unresolvable.
//
// What is deliberately NOT in the population, each exclusion a decision:
//
//   - fences tagged text, or with no language (19 more claims): arrow diagrams
//     and narrative, not copy-pasteable commands;
//   - inline code in prose: "peaks hooks already installed?" is an English
//     sentence wearing code formatting, and a guard that fires on it teaches
//     people to ignore the guard;
//   - shell comment lines inside a bash fence: a hash-prefixed line is not a
//     command whatever it mentions;
//   - .peaks/docs/diagnosis-*.md: point-in-time records. A diagnosis written
//     against an older CLI names the command that existed THEN, and rewriting it
//     to today's spelling falsifies the only evidence it is. Same reasoning as
//     the era-anchored guards elsewhere in this directory.
//
// The floors in the population arm are load-bearing: an earlier draft of this
// instrument reported "zero drift" because its root path pointed outside the
// repository and it had scanned zero files. A green that comes from measuring
// nothing is the failure mode this file exists to refuse.
//
// No backtick appears anywhere in this source on purpose — the fence marker is
// assembled from its character code. Writing literal triple backticks into a
// .ts file through this toolchain has produced a silently truncated file twice
// in one session, and a guard that cannot load guards nothing.
//
// Run with: pnpm vitest run tests/unit/standards/doc-command-claims.test.ts

import type { Command } from 'commander';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createProgram } from '../../../src/cli/program.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/standards/doc-command-claims.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the guard asserts on a claim population, not on any printed output shape'
    }
  ]
);

const FENCE = String.fromCharCode(96).repeat(3);

/** Fence languages whose contents a reader is expected to run. */
const EXEC_FENCE_LANG = /^(bash|sh|shell|console|zsh)$/;

/** "peaks <verb> [sub]" — two tokens name a leaf or a parent group. */
const CLAIM_PATTERN = /\bpeaks\s+([a-z][a-z0-9-]{1,24})(?:\s+([a-z][a-z0-9-]{1,24}))?/g;

const MIN_DOCS = 20;
const MIN_CLAIMS = 45;

type Claim = { readonly line: number; readonly verb: string; readonly sub?: string };

type Tree = { paths: Set<string>; parents: Set<string>; verbs: Set<string> };

function commandTree(): Tree {
  const io = { stdout: (_s: string) => {}, stderr: (_s: string) => {} };
  const program = createProgram(io) as Command;
  const paths = new Set<string>();
  const parents = new Set<string>();
  const walk = (cmd: Command, prefix: string[]): void => {
    for (const child of cmd.commands) {
      const path = [...prefix, child.name()].join(' ');
      paths.add(path);
      if (child.commands.length > 0) {
        parents.add(path);
      }
      walk(child, [...prefix, child.name()]);
    }
  };
  walk(program, []);
  return {
    paths,
    parents,
    verbs: new Set([...paths].map((p) => p.split(' ')[0] ?? ''))
  };
}

// The gated document set: both READMEs, every file under .peaks/docs, and every
// skills/<name>/SKILL.md.
function gatedDocs(): string[] {
  const docs = ['README.md', 'README-en.md'].filter((file) => existsSync(file));
  if (existsSync('.peaks/docs')) {
    for (const name of readdirSync('.peaks/docs')) {
      if (name.endsWith('.md')) {
        docs.push(join('.peaks/docs', name));
      }
    }
  }
  if (existsSync('skills')) {
    for (const name of readdirSync('skills')) {
      const skill = join('skills', name, 'SKILL.md');
      if (existsSync(skill)) {
        docs.push(skill);
      }
    }
  }
  return docs;
}

/** Claims inside executable fences, with fence rules and shell comments skipped. */
function execFenceClaims(markdown: string): Claim[] {
  const claims: Claim[] = [];
  let lang = '';
  let open = false;
  markdown.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(FENCE)) {
      if (!open) {
        open = true;
        lang = trimmed.slice(FENCE.length).trim().toLowerCase();
      } else {
        open = false;
        lang = '';
      }
      return;
    }
    if (!open || !EXEC_FENCE_LANG.test(lang) || trimmed.startsWith('#')) {
      return;
    }
    for (const match of line.matchAll(CLAIM_PATTERN)) {
      const verb = match[1] as string;
      const sub = match[2];
      claims.push(sub === undefined ? { line: index + 1, verb } : { line: index + 1, verb, sub });
    }
  });
  return claims;
}

function unresolved(claims: Claim[], tree: Tree): string[] {
  return claims
    .filter((claim) => {
      if (!tree.verbs.has(claim.verb)) {
        return true;
      }
      if (claim.sub === undefined) {
        return false;
      }
      return tree.parents.has(claim.verb) && !tree.paths.has(claim.verb + ' ' + claim.sub);
    })
    .map((claim) => 'peaks ' + claim.verb + (claim.sub === undefined ? '' : ' ' + claim.sub));
}

function bashFence(body: string): string {
  return FENCE + 'bash\n' + body + '\n' + FENCE;
}

describe('docs claim the real CLI (doc-command-claims) — integration', () => {
  it('every executable-fence command claim resolves against the registered tree', () => {
    const tree = commandTree();
    const offenders: string[] = [];
    for (const doc of gatedDocs()) {
      for (const claim of unresolved(execFenceClaims(readFileSync(doc, 'utf8')), tree)) {
        offenders.push(doc + ' :: ' + claim);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('docs claim the real CLI (doc-command-claims) — behavior', () => {
  it('scans a population large enough for a green to mean something', () => {
    const tree = commandTree();
    const docs = gatedDocs();
    const claims = docs.reduce(
      (sum, doc) => sum + execFenceClaims(readFileSync(doc, 'utf8')).length,
      0
    );

    expect(tree.paths.size).toBeGreaterThan(400);
    expect(docs.length).toBeGreaterThanOrEqual(MIN_DOCS);
    expect(claims).toBeGreaterThanOrEqual(MIN_CLAIMS);
  });

  it('catches a command that does not exist, in both shapes', () => {
    const tree = commandTree();
    const claims = execFenceClaims(
      bashFence('peaks definitely-not-a-command --json\npeaks audit not-a-subcommand')
    );

    expect(claims).toHaveLength(2);
    expect(unresolved(claims, tree)).toEqual([
      'peaks definitely-not-a-command',
      'peaks audit not-a-subcommand'
    ]);
  });

  it('accepts the forms the CLI really has', () => {
    const tree = commandTree();
    const claims = execFenceClaims(
      bashFence(
        [
          'peaks audit goal --need "x" --json',
          'peaks sub-agent dispatch --role rd',
          'peaks codegraph status --project .',
          'peaks legacy-detect .'
        ].join('\n')
      )
    );

    expect(claims).toHaveLength(4);
    expect(unresolved(claims, tree)).toEqual([]);
  });

  it('does not treat a shell comment or a non-executable fence as a claim', () => {
    const tree = commandTree();
    const claims = execFenceClaims(
      bashFence('# 3. Are peaks hooks already installed?\npeaks hooks status --json') +
        '\n' +
        FENCE +
        'text\npeaks audit-goal  →  peaks-prd\n' +
        FENCE
    );

    expect(claims).toHaveLength(1);
    expect(unresolved(claims, tree)).toEqual([]);
  });
});

describe('docs claim the real CLI (doc-command-claims) — a11y', () => {
  it('names the file and the claim when it goes red, so the reader can act', () => {
    const tree = commandTree();
    const offenders = unresolved(execFenceClaims(bashFence('peaks upgrade --apply-init')), tree);

    expect(offenders).toEqual(['peaks upgrade']);
    const report = 'skills/example/SKILL.md :: ' + offenders[0];
    expect(report).toContain('SKILL.md');
    expect(report).toContain('peaks upgrade');
  });
});
