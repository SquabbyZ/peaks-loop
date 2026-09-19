// tests/unit/services/memory/memory-title-sensitive-scan.test.ts
//
// Slice C0 — `peaks memory extract` refused a memory whose TITLE merely
// contained a word with `auth` in it:
//
//   title: "Derive from the authority, never re-declare it"
//   → ok: false, code: MEMORY_EXTRACT_FAILED,
//     message: "Refusing to store sensitive memory content"
//     nextActions: ["Check artifact paths and remove secrets before extracting memory"]
//
// There was no secret. `assertSafeMemory`'s third check ran the CONFIG-KEY
// predicate `isSensitiveConfigPath` over `memory.title`, and that predicate
// matches by SUBSTRING (`includes('auth')`) — so `authority` hit it, as would
// `author`, `unauthorized`, `tokenizer` and `secretary`. The refusal was
// uninformative in the one direction that mattered: it said "remove secrets"
// about a memory that had none, sending its author to look for a credential
// that did not exist.
//
// The gate is NOT deleted, and this file is where that claim is pinned. The
// content scanner needs a `:` or `=` (see its first pattern), so a title that
// is nothing but `apiKey` — no value attached — is caught by no other rule.
// The title scan is the only check that sees "the title IS a credential name",
// so it was kept and its PREDICATE was replaced: config keys keep the
// substring predicate (`isSensitiveConfigPath` is untouched; its own domain is
// pinned under `tests/unit/cli/`), while a prose title is read one word at a
// time. A word-level reading is what `authority` needed and what
// `private_key` / `myApiKey` / `access token` still survive.
//
// BOTH SIDES ARE PINNED, and each side can go red on its own:
//   - the false refusals go RED under the old substring predicate (measured by
//     injection, not argued — see the tech doc);
//   - the true positives go RED if the title scan is deleted outright, and the
//     content-scanner cases go RED if its patterns are loosened.
// A change that only loosens one side is exactly what this repository's
// "do not leave the gate open so it passes" rule forbids.
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/memory-title-sensitive-scan.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import {
  assertSafeMemory,
  executeProjectMemoryExtract,
  findSensitiveMemoryTitleTerm,
  hasSensitiveMemoryContent,
  SENSITIVE_MEMORY_CHECKS
} from '~/src/services/memory/project-memory-service/index';
import { isSensitiveConfigPath } from '~/src/services/config/config-service';
import { registerMemoryCommand } from '~/src/cli/commands/core/memory-command';
import type { ProgramIO } from '~/src/cli/cli-helpers';
import type { ExtractedProjectMemory } from '~/src/services/memory/project-memory-service/types';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/memory/memory-title-sensitive-scan.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the gate returns nothing and prints nothing of its own; the envelope it feeds is asserted under a11y'
    }
  ]
);

const START = '<!-- peaks-memory:start -->';
const END = '<!-- peaks-memory:end -->';

/** A memory whose title is the only thing under test. */
function memory(
  title: string,
  body = 'A stable fact that carries no credential.'
): ExtractedProjectMemory {
  return { title, kind: 'lesson', body, sourceArtifact: 'probe/handoff.md' };
}

/** The refusal message, or `null` when the gate accepted the memory. */
function refusalFor(title: string): string | null {
  try {
    assertSafeMemory(memory(title));
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * Titles that must NOT be refused. Each is either the reported failure or the
 * same shape one word over — the false-refusal family the config-key predicate
 * produced because it matched terms inside longer words.
 */
const FALSE_REFUSALS: ReadonlyArray<string> = [
  'Derive from the authority, never re-declare it', // the reported memory
  'the author of this note',
  'unauthorized access handling',
  'tokenizer behavior',
  'secretary of state',
  'credentialed staff rotation',
  'auth flow for the IDE adapter',
  'AUTHORITY',
  // C4 — the negative half of the `authkey` pair: the `authkey`-specific twin
  // of `tokenizer behavior` / `secretary of state` above.
  //
  // The row must be a word that CONTAINS the term. C3 shipped
  // `authorization header handling` here with a comment claiming it would
  // redden "if the new entries were ever widened to bare `auth`". QA measured
  // that false — that row stays green under that mutation (the `auth flow` row
  // is what catches it), so its comment claimed more than the row could
  // prove. It is replaced by one that can actually redden: under the pre-C0
  // substring shape a run need only CONTAIN a term, and `authkeyboard`
  // contains `authkey`. Measured (C4): with the matcher mutated to substring
  // semantics this row goes red, and the two analogue rows above go red with
  // it.
  'authkeyboard layout'
];

/**
 * Titles that must STILL be refused, with the term the message has to name.
 * `private_key`, `api_key` and `access token` are here because a word-per-word
 * reading would drop them: they are the evidence that the new predicate is not
 * simply narrower than the substring one it replaced.
 */
const TRUE_POSITIVES: ReadonlyArray<readonly [title: string, term: string]> = [
  ['apiKey', 'apikey'],
  ['ApiKey', 'apikey'],
  ['api_key', 'apikey'],
  ['myApiKey', 'apikey'],
  ['accessKey', 'accesskey'],
  ['private_key', 'privatekey'],
  ['secret-token', 'secret'],
  ['password', 'password'],
  ['passwords', 'passwords'],
  ['credentials', 'credentials'],
  ['bearer', 'bearer'],
  ['access token', 'accesstoken'],
  // C3: the two entries `authkey`/`authkeys` added to SENSITIVE_PROSE_TERMS
  // after C2 measured that `authkey` and `auth-key` were ACCEPTED while C0's
  // tech doc §4 claimed they were listed. Without these rows the entries have
  // zero coverage — `grep tests/ authkey` returned nothing, so deleting them
  // again would have gone unnoticed, which is the exact shape this slice
  // exists to fix. `auth-key` / `authKeys` are the separator and camelCase
  // spellings, both of which must resolve to the same run.
  ['authkey', 'authkey'],
  ['auth-key', 'authkey'],
  ['authKeys', 'authkeys']
];

describe('Scenario: behavior — the title scan reads terms, not substrings', () => {
  it.each(FALSE_REFUSALS)('when the title is %j, should accept the memory', (title) => {
    // given: a title that merely contains a credential word inside a longer one
    // when: the gate runs
    const refusal = refusalFor(title);

    // then: nothing is refused — the pre-C0 predicate refused all of these
    expect(refusal, `refused: ${refusal ?? ''}`).toBeNull();
  });

  it.each(TRUE_POSITIVES)('when the title is %j, should refuse it and name %j', (title, term) => {
    // given: a title that IS a credential name (no value attached anywhere)
    // when: the gate runs
    const refusal = refusalFor(title);

    // then: the memory is refused by the TITLE scan, and the message names the
    //       term — "Refusing to store sensitive memory content" alone is the
    //       message that sent C0's user hunting for a secret that was not there
    expect(refusal).not.toBeNull();
    expect(refusal).toContain(SENSITIVE_MEMORY_CHECKS.title);
    expect(refusal).toContain(`"${term}"`);
  });

  it('when the title scan is asked directly, should return the matched term', () => {
    // given: the predicate the title scan is built on
    // when: it is asked about a term, a run of words, and prose
    // then: the term and the run are returned, the prose is not — a run is what
    //       keeps `private_key` alive without reopening `secretary`
    expect(findSensitiveMemoryTitleTerm('private_key')).toBe('privatekey');
    expect(findSensitiveMemoryTitleTerm('the access token of the run')).toBe('accesstoken');
    expect(findSensitiveMemoryTitleTerm('the secretary of state')).toBeNull();
  });

  it('when a credential term is the whole body rather than the title, should still refuse it', () => {
    // given: the same value-carrying shape the content scanner owns
    // when: the gate runs with a clean title
    // then: the CONTENT scan is the check that fires, and it says so
    let refusal: string | null = null;
    try {
      assertSafeMemory(memory('Rotate the key quarterly', 'api_key: sk-abcdef1234567890'));
    } catch (error) {
      refusal = (error as Error).message;
    }
    expect(refusal).toContain(SENSITIVE_MEMORY_CHECKS.content);
  });
});

/**
 * The other half of the split, pinned so it cannot be "fixed" by accident: the
 * CONFIG-KEY domain keeps the substring predicate. Narrowing
 * `isSensitiveConfigPath` itself — candidate (b) of the slice brief — would
 * have repaired the title by weakening the config rule, and would have left the
 * two domains bolted together. It is untouched, and this is the case that says
 * so: the SAME string is a credential-bearing key and a harmless title, and the
 * two predicates are allowed to disagree because they answer different
 * questions.
 */
describe('Scenario: behavior — the config-key domain keeps its substring predicate', () => {
  it.each([
    ['providers.anthropic.apiKey', true],
    ['tokens.GitHubToken', true],
    ['auth.token', true],
    ['workspaces.0.rootPath', false]
  ])('when the key is %j, should report sensitive = %s', (key, sensitive) => {
    // given: a config key — a name whose substring reading is the point, since
    //        an auth-bearing key IS a credential key
    // when: the config-key predicate reads it
    // then: it answers as it always did; this slice did not move it
    expect(isSensitiveConfigPath(key)).toBe(sensitive);
  });

  it('when the key is context.windowTokens, should report sensitive = true — the same defect, recorded', () => {
    // given: `context.windowTokens`, the machine-scoped override of
    //        `PEAKS_CONTEXT_WINDOW_TOKENS` (`CONTEXT_WINDOW_TOKENS_CONFIG_KEY`)
    // when: the config-key predicate reads it
    // then: it says SENSITIVE, because the key contains `token` — the same
    //       substring breadth that refused `authority` as a memory title, one
    //       domain over (at the project layer this reads as "sensitive config
    //       keys must be stored in the user config layer").
    //
    //       The answer is pinned AS IT IS, not endorsed: narrowing
    //       `isSensitiveConfigPath` is candidate (b) of this slice's brief and
    //       it is REJECTED here, because it changes the config domain's
    //       behavior — a config slice's decision, not a memory-title fix's. The
    //       pre-change answer is pinned so that decision cannot be taken
    //       silently by this file, and so the defect stays visible until that
    //       slice exists.
    expect(isSensitiveConfigPath('context.windowTokens')).toBe(true);
  });

  it('when the same word is read by each domain, should disagree — by design', () => {
    // given: one string that is both a plausible config key and plausible prose
    // when: each domain's predicate reads it
    // then: the config key is sensitive and the title is not. The config answer
    //       is not a bug to be copied into the title scan — it is the answer to
    //       a different question ("is this a KEY that would carry a secret"),
    //       which is why the domains no longer share one predicate
    expect(isSensitiveConfigPath('authority')).toBe(true);
    expect(findSensitiveMemoryTitleTerm('authority')).toBeNull();
  });
});

/**
 * The content scanner's pattern behaviour, pinned on BOTH sides and taken from
 * the pre-C0 code. The slice moved no pattern — `hasSensitiveMemoryContent` is
 * byte-identical — and these are what says so: if a pattern is loosened to make
 * a case pass, one of the `true` rows below goes red.
 */
const CONTENT_SCANNER: ReadonlyArray<readonly [sample: string, sensitive: boolean]> = [
  ['api_key: sk-abcdef1234567890', true],
  ['token=abcdef123456', true],
  ['password: hunter2', true],
  ['credential = abc', true],
  ['Authorization: Bearer abcdefghijklmnop', true],
  ['a header reading bearer abcdefghijklmnopq', true],
  ['sk-abcdef1234567890', true],
  ['ghp_abcdefghijklmnopqrstuvwxyz0123', true],
  ['github_pat_abcdefghijklmnopqrstuvwxyz0123', true],
  ['glpat-abcdefghijklmnopqrstuv', true],
  ['AKIAIOSFODNN7EXAMPLE', true],
  ['-----BEGIN RSA PRIVATE KEY-----', true],
  ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', true],
  // The other side: the same vocabulary as prose, with no value to leak —
  // these four are also why the title predicate must not be a substring match.
  ['Derive from the authority, never re-declare it', false],
  ['The tokenizer splits the body into tokens.', false],
  ['The secretary of state is not a credential.', false],
  ['passwordless design is a goal, not a secret.', false]
];

describe('Scenario: behavior — the content scanner is unchanged', () => {
  it.each(CONTENT_SCANNER)(
    'when the content is %j, should report sensitive = %s',
    (sample, sensitive) => {
      // given: a pre-C0 sample of each pattern family, plus its prose counterpart
      // when: the content scanner reads it
      // then: it answers exactly what it answered before this slice
      expect(hasSensitiveMemoryContent(sample)).toBe(sensitive);
    }
  );
});

describe('Scenario: integration — the real extract path', () => {
  let root: string;
  let artifactPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-c0-title-'));
    mkdirSync(join(root, '.peaks', 'memory'), { recursive: true });
    artifactPath = join(root, 'handoff.md');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function block(title: string, body: string): string {
    return `${START}\ntitle: ${title}\nkind: lesson\n---\n${body}\n${END}`;
  }

  it('when an artifact carries a memory titled after authority, should extract it', () => {
    // given: the reported artifact, on disk
    writeFileSync(
      artifactPath,
      `${block('Derive from the authority, never re-declare it', 'The capsule is the source of truth.')}\n`,
      'utf8'
    );

    // when: the real extract path runs
    const plan = executeProjectMemoryExtract({
      projectRoot: root,
      artifactPaths: [artifactPath],
      apply: false
    });

    // then: the memory is planned for writing instead of aborting the extract —
    //       one refused block used to fail the whole run, not just its own file
    expect(plan.plannedWrites.map((write) => write.memory.title)).toEqual([
      'Derive from the authority, never re-declare it'
    ]);
  });

  it('when an artifact carries a credential value, should abort the extract', () => {
    // given: an artifact with a value the content scanner owns
    writeFileSync(
      artifactPath,
      `${block('Rotate the key quarterly', 'api_key: sk-abcdef1234567890')}\n`,
      'utf8'
    );

    // when: the real extract path runs
    // then: it still refuses — the false-refusal fix did not open this path
    expect(() =>
      executeProjectMemoryExtract({
        projectRoot: root,
        artifactPaths: [artifactPath],
        apply: false
      })
    ).toThrow(new RegExp(SENSITIVE_MEMORY_CHECKS.content));
  });
});

describe('Scenario: a11y — the envelope names the check, and the advice answers it', () => {
  let root: string;
  let artifactPath: string;

  type Envelope = {
    ok: boolean;
    code?: string;
    message?: string;
    nextActions?: string[];
    data?: { check?: string; matchedTerm?: string | null };
  };

  async function runExtract(): Promise<Envelope> {
    const stdout: string[] = [];
    const io: ProgramIO = { stdout: (chunk: string) => stdout.push(chunk), stderr: () => {} };
    const program = new Command();
    registerMemoryCommand(program, io);
    await program.parseAsync(
      ['memory', 'extract', '--json', '--project', root, '--artifact', artifactPath],
      { from: 'user' }
    );
    return JSON.parse(stdout.join('')) as Envelope;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-c0-envelope-'));
    mkdirSync(join(root, '.peaks', 'memory'), { recursive: true });
    artifactPath = join(root, 'handoff.md');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('when a prose title is refused, should name the term and stop advising "remove secrets"', async () => {
    // given: a memory whose title IS a credential term — the one case where the
    //        title scan is the only check that can fire
    writeFileSync(
      artifactPath,
      `${START}\ntitle: apiKey\nkind: lesson\n---\nWhere the key comes from.\n${END}\n`,
      'utf8'
    );

    // when: the CLI runs
    const envelope = await runExtract();

    // then: the failure names the check that fired, the term it matched and the
    //       remedy that answers it — the old static "remove secrets" sent the
    //       reader after a value that, by construction, does not exist here
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('MEMORY_EXTRACT_FAILED');
    expect(envelope.message).toContain(SENSITIVE_MEMORY_CHECKS.title);
    expect(envelope.nextActions).toEqual([
      'Retitle the memory so it is not named after a credential term, then re-run memory extract'
    ]);
    expect(envelope.nextActions?.join(' ')).not.toContain('remove secrets');

    // The term itself reaches the reader through `data`, and NOT through the
    // message. MEASURED, not assumed: `fail()` runs every failure MESSAGE
    // through `redactSensitiveErrorMessage`, whose last pattern
    // (`/(secret|token|password|api[-_ ]?key)/gi`) is a blanket word rule, so
    // the term is stripped out of the prose on the way to the envelope. The
    // term is a word from a fixed vocabulary — never a value — so it rides the
    // field `fail()` does not redact. Pinned from both sides: if the term stops
    // being named, or starts leaking into a message that the redactor owns,
    // this case says so.
    expect(envelope.data?.check).toBe(SENSITIVE_MEMORY_CHECKS.title);
    expect(envelope.data?.matchedTerm).toBe('apikey');
    expect(envelope.message).not.toContain('apikey');
  });

  it('when a credential value is refused, should name the content scan and advise removing the value', async () => {
    // given: a real credential in the body
    writeFileSync(
      artifactPath,
      `${START}\ntitle: Rotate the key quarterly\nkind: lesson\n---\napi_key: sk-abcdef1234567890\n${END}\n`,
      'utf8'
    );

    // when: the CLI runs
    const envelope = await runExtract();

    // then: the advice is the one that fits — and it still sends the reader to
    //       the value, because this time there is one. No term is reported for
    //       this check, in the message or in the data: the match IS the
    //       credential, so it is not echoed anywhere.
    expect(envelope.ok).toBe(false);
    expect(envelope.message).toContain(SENSITIVE_MEMORY_CHECKS.content);
    expect(envelope.nextActions).toEqual([
      'Remove the credential value from the memory content, then re-run memory extract'
    ]);
    expect(envelope.data?.check).toBe(SENSITIVE_MEMORY_CHECKS.content);
    expect(envelope.data?.matchedTerm).toBeNull();

    // The advice sentence has to SURVIVE the redactor it agrees with: the
    // catch-all rewrites the words secret / token / password / api-key wherever
    // they appear, so naming the pattern families in their own words arrived as
    // "an [redacted] / [redacted] / [redacted] assignment". Measured on the
    // real CLI, both wordings; this case keeps the surviving one.
    expect(envelope.message).not.toContain('[redacted]');
  });

  it('when the same title is accepted, should report success with the memory planned', async () => {
    // given: the reported title, whose only sin was a word inside a word
    writeFileSync(
      artifactPath,
      `${START}\ntitle: Derive from the authority, never re-declare it\nkind: lesson\n---\nThe capsule is the source of truth.\n${END}\n`,
      'utf8'
    );

    // when: the CLI runs
    const envelope = await runExtract();

    // then: the run succeeds and the memory is planned for writing
    expect(envelope.ok).toBe(true);
    expect(JSON.stringify(envelope)).toContain('Derive from the authority, never re-declare it');
  });
});
