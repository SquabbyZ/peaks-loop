/**
 * Post-compact engineering-state re-injection
 * (rid `2026-09-13-a2-post-compact-reinject`, session
 * `2026-09-12-session-e37ef0`).
 *
 * THE PROBLEM THIS SOLVES
 *
 * `94bacb4a` settled WHO decides when to compact: peaks-loop owns the window,
 * the harness performs the compaction. This module owns what happens AFTER
 * it. Compaction summarizes a conversation, and a summarizer has no notion of
 * a slice, a request, a gate or an acceptance criterion — so the engineering
 * state is exactly the part it is most likely to drop. The user's word for
 * the symptom is 飘逸 (drift): the session keeps talking but has lost its
 * place.
 *
 * This repository already has the case on file:
 * `.peaks/memory/per-turn-obligations-belong-in-per-turn-output.md` —
 * text that lives in the message history (a SKILL.md body, a dispatch prompt)
 * does not survive a compaction, so a rule that only exists there stops
 * applying. The fix has to be re-injection, not a better summary.
 *
 * WHY A BUDGET IS THE DESIGN AND NOT A DETAIL
 *
 * The harness's own supported mechanism is a `SessionStart` hook whose stdout
 * it adds to the context. So the card competes for the very space the
 * compaction just freed. Re-injecting a lot is WORSE than re-injecting
 * nothing: it re-fills the window, the ratio climbs back, and the next
 * compaction arrives sooner — the cost is paid on every cycle. Hence a hard,
 * declared ceiling (`POST_COMPACT_REINJECTION_BYTE_BUDGET`) and a
 * deterministic rule for what is dropped (see `renderReinjectionCard`).
 *
 * POINT, DO NOT INLINE
 *
 * Two different things can be put in the card:
 *   - a FACT whose absence changes behaviour on the very next turn (the
 *     runtime rules, the next slice, the identity of the session), and
 *   - a BODY of material the model can go and read (a request artifact, a
 *     job state file, a memory file).
 * Inlining the second is the worse trade at every size: it costs bytes on
 * every compaction cycle forever, it goes stale the moment it is written, and
 * the model cannot tell a stale copy from a live one. A path costs ~60 bytes,
 * is always current, and the model is going to read the file anyway before it
 * edits anything. So the card inlines only the first kind and spends one
 * whole block on pointers to the second.
 *
 * VENDOR NEUTRALITY
 *
 * Nothing here knows an IDE, a settings file or a hook event. The card is a
 * string; the hook entry that carries it lives with the other peaks hook
 * entries (`session-start-hook-constants.ts`) and the settings plumbing is
 * `applyHookInstall`. The only input that touches the outside world is
 * `projectRoot`.
 *
 * FAIL-SOFT IS A HARD REQUIREMENT, AND IT HAS A SHARP EDGE HERE
 *
 * The hook's stdout IS context. So an error message printed on stdout is not
 * a visible failure — it is a failure injected straight into the model's
 * context as if peaks-loop had meant it. `buildPostCompactReinjectionCard`
 * therefore never throws (every source is individually guarded and reports
 * into `unresolved`), and the CLI wrapper that renders it prints NOTHING and
 * exits 0 when the card cannot be built.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readJobShapeDecision } from '../code/job-shape-decision.js';
import { tryReadJobProgress } from '../job/job-progress-store.js';
import { getSessionIdCanonical } from '../session/session-manager.js';

/**
 * Hard ceiling on the card's size, in UTF-8 bytes.
 *
 * WHY 3072. Three numbers decided it, not taste:
 *
 *   1. It must be small against the freed space. A compaction releases tens
 *      of thousands of tokens. 3072 bytes is under ~1200 tokens of English —
 *      under 0.6% of a 200K window and under 0.12% of a 1M one. At that size
 *      the card cannot plausibly re-fill what the compaction freed, whatever
 *      the window, which is the property that makes the re-injection safe to
 *      run on every cycle.
 *   2. It must be big enough for the whole content contract. Measured against
 *      this repository the full card — identity, pointers, rules, next action
 *      and progress — lands around 1.2-1.7 KiB. 3072 leaves roughly 2x
 *      headroom for long session ids, a long job id and a long absolute
 *      project root before the drop rule has to fire at all.
 *   3. It must be a BYTE count rather than a token or percentage count. Bytes
 *      are computable on the hook path with `Buffer.byteLength` and no
 *      tokenizer, no window resolution and no dependency; and unlike a
 *      share-of-window budget, a fixed byte cap cannot silently GROW on a
 *      large-window model — which would reintroduce the very "re-fill the
 *      freed space" failure the cap exists to prevent. A percentage budget
 *      was considered and rejected for that reason.
 */
export const POST_COMPACT_REINJECTION_BYTE_BUDGET = 3072;

/**
 * Runtime rules that live ONLY in the message history, so a compaction
 * destroys them.
 *
 * Why a repo-owned constant and not something parsed out of the dispatch
 * record: the dispatch record is free-form prose written per slice, and a
 * parser over it would silently stop matching the day someone rephrases a
 * heading — a rule that vanishes without a failure. These six are peaks-loop's
 * OWN operating rules for an agent working in a peaks-loop session; keeping
 * them here makes adding one a one-line change with a test behind it.
 *
 * The membership test for an entry is: "if the model forgets this, does it
 * act WRONGLY on the next turn?" Session-general advice that already lives in
 * CLAUDE.md / the system prompt is deliberately absent — the system prompt is
 * not part of the summarized history, so re-injecting it would spend budget
 * to say something the model can already see.
 */
export const AGENT_RUNTIME_RULES: ReadonlyArray<string> = Object.freeze([
  'CLI: run `node --import tsx src/cli/index.ts <cmd>`, never `pnpm exec tsx` — on Windows the latter truncates any argument at its first newline.',
  'Test scope: one file or pattern per run; the full suite requires PEAKS_FULL_TEST=1.',
  "Exit codes: never read a test result through a pipe (`| tail` reports tail's status); read ${PIPESTATUS[0]}.",
  'Never write `.claude/settings.local.json` from a slice — reproduce against a temp project copy via `--project <tmpdir>`.',
  'Git: commit / push policy is per-dispatch and is NOT inherited from this card — re-read the dispatch record before any state-mutating git command.',
  'No interactive questions: decide, act, and record the decision in the artifact.'
]);

/**
 * The block ranks, in survival order. The drop rule reads THIS list, so it is
 * the single place the priority is stated.
 *
 * The ordering principle is value-per-byte, highest first:
 *   0 IDENTITY      — which session; ~1 line, and every other line depends on it
 *   1 WHERE TO READ — the pointers; cheap, always current, and the only way the
 *                     model reaches the bulky material it must not have inlined
 *   2 RULES         — behaviour-changing, and unavailable anywhere else in context
 *   3 NEXT          — one line; without it the next turn has no target
 *   4 CURRENT WORK  — request / job / change identity and progress
 * RULES outranks CURRENT WORK deliberately: the identity of the slice is
 * recoverable by Reading the artifact the card points at, whereas a rule the
 * model has forgotten will be broken before it thinks to go looking.
 */
export const REINJECTION_BLOCK_RANKS = Object.freeze([0, 1, 2, 3, 4] as const);

export const REINJECTION_BLOCK_HEADINGS: Readonly<Record<number, string>> = Object.freeze({
  0: '[peaks-loop] post-compact state card',
  1: 'WHERE TO READ',
  2: 'RULES THAT ARE NOT IN CONTEXT ANY MORE',
  3: 'NEXT',
  4: 'CURRENT WORK'
});

/** Short names for the omitted-marker. See `ReinjectionBlock.label`. */
export const REINJECTION_BLOCK_LABELS: Readonly<Record<number, string>> = Object.freeze({
  0: 'header',
  1: 'pointers',
  2: 'rules',
  3: 'next',
  4: 'current-work'
});

export type ReinjectionBlock = {
  readonly rank: number;
  /** Full heading line, rendered into the card. */
  readonly heading: string;
  /**
   * Short name used by the omitted-marker. Distinct from `heading` on purpose:
   * the marker is itself part of the budget, and a marker built from the full
   * headings ("RULES THAT ARE NOT IN CONTEXT ANY MORE") costs several times
   * what the useful information in it is worth.
   */
  readonly label: string;
  readonly lines: readonly string[];
};

export type ReinjectionCard = {
  readonly text: string;
  readonly bytes: number;
  readonly budgetBytes: number;
  readonly emittedRanks: readonly number[];
  readonly droppedRanks: readonly number[];
};

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Render one block: a heading line, then the body lines indented two spaces.
 * A block is the smallest unit the drop rule can remove — it is never split,
 * because half a pointer list or half a rule reads as a complete answer and
 * is worse than an absent one.
 */
function renderBlock(block: ReinjectionBlock): string {
  const body = block.lines.map((line) => `  ${line}`).join('\n');
  return body.length > 0 ? `${block.heading}\n${body}` : block.heading;
}

/**
 * Assemble the card under a byte budget.
 *
 * THE RULE, stated so it can be checked rather than interpreted:
 *
 *   1. Blocks are rendered whole. Ranks are read in ascending order.
 *   2. A block is emitted iff its bytes still fit in the remaining budget.
 *      Otherwise it is SKIPPED and the walk CONTINUES — greedy by rank, not
 *      stop-at-first-miss. This is the only one of the two candidate rules
 *      that keeps the survival order meaningful: with stop-at-first-miss, one
 *      oversized low-priority block would evict every block after it,
 *      including the hard rules. Skipping cannot reorder anything, because
 *      ranks are still walked in order.
 *   3. Blocks are joined by a blank line, which is counted as part of the
 *      block being added (a separator is never emitted for a block that did
 *      not fit).
 *   4. If anything was dropped and the remaining budget admits it, one final
 *      line names the dropped ranks. It is ALL-OR-NOTHING: it is emitted only
 *      if it fits entirely, so no string is ever truncated mid-way and the
 *      byte accounting stays exact.
 *
 * Deterministic in the strict sense: the output is a pure function of
 * (blocks, budgetBytes). No clock, no filesystem, no "best effort".
 *
 * `budgetBytes` is injectable so the rule above is testable at any size; it
 * defaults to the declared ceiling and no production caller overrides it.
 */
export function renderReinjectionCard(input: {
  readonly blocks: ReadonlyArray<ReinjectionBlock>;
  readonly budgetBytes?: number | undefined;
}): ReinjectionCard {
  const budget = input.budgetBytes ?? POST_COMPACT_REINJECTION_BYTE_BUDGET;
  const ordered = [...input.blocks].sort((a, b) => a.rank - b.rank);

  const parts: string[] = [];
  const emittedRanks: number[] = [];
  const droppedRanks: number[] = [];
  let used = 0;

  for (const block of ordered) {
    const rendered = renderBlock(block);
    // A separator only ever counts once a block already exists, and it is
    // charged to the block being added so a skipped block leaves no residue.
    const cost = byteLength(rendered) + (parts.length > 0 ? 2 : 0);
    if (used + cost > budget) {
      droppedRanks.push(block.rank);
      continue;
    }
    parts.push(rendered);
    emittedRanks.push(block.rank);
    used += cost;
  }

  if (droppedRanks.length > 0) {
    const labelsByRank = new Map(ordered.map((b) => [b.rank, b.label] as const));
    const names = droppedRanks.map((rank) => labelsByRank.get(rank) ?? `rank ${rank}`).join(', ');
    const marker = `[peaks-loop] omitted (budget ${budget}B): ${names}`;
    const cost = byteLength(marker) + (parts.length > 0 ? 2 : 0);
    if (used + cost <= budget) {
      parts.push(marker);
      used += cost;
    }
  }

  const text = parts.join('\n\n');
  return {
    text,
    bytes: byteLength(text),
    budgetBytes: budget,
    emittedRanks,
    droppedRanks
  };
}

/** Facts the card is built from. Every field is independently optional. */
export type PostCompactReinjectionFacts = {
  readonly projectRoot: string;
  readonly sessionId: string | null;
  readonly jobId: string | null;
  readonly isJob: boolean;
  readonly progress: {
    readonly done: number;
    readonly total: number;
    readonly currentSlice: string;
  } | null;
  readonly latestRequest: string | null;
  /** Which sources could not be read. Rendered nowhere in the card; reported. */
  readonly unresolved: readonly string[];
};

/** Forward-slash a path so the card's pointers are shell-dialect neutral. */
function toPosix(p: string): string {
  return p.replaceAll('\\', '/');
}

/**
 * Find the most recently modified request artifact under the session tree.
 *
 * This is a POINTER RESOLVER, not a content reader: it returns the artifact's
 * name so the card can name it, and never opens it. Deliberately limited to
 * `<session>/<role>/requests/*.md` — the tree every role already writes to —
 * rather than a repo-wide search, so the answer cannot be some unrelated
 * markdown file that happens to be newer.
 *
 * Returns its failures alongside the answer instead of swallowing them. The
 * tempting shape here — a bare `catch { continue }` — makes two very different
 * states indistinguishable to the caller: "this role has no requests yet"
 * (ordinary, most roles) and "this role's requests directory exists but could
 * not be read" (a real problem worth reporting). Only `ENOENT` is the ordinary
 * one, so only `ENOENT` is silent.
 */
function findLatestRequestArtifact(
  projectRoot: string,
  sessionId: string
): { readonly rel: string | null; readonly warnings: readonly string[] } {
  const sessionDir = join(projectRoot, '.peaks', '_runtime', sessionId);
  const warnings: string[] = [];
  let roles: string[];
  try {
    roles = readdirSync(sessionDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    // No session tree at all is the ordinary "nothing to point at" case; any
    // other failure is reported.
    if (errnoCode(err) !== 'ENOENT') warnings.push(`session tree unreadable: ${sessionId}`);
    return { rel: null, warnings };
  }
  let best: { rel: string; mtimeMs: number } | null = null;
  for (const role of roles) {
    const requestsDir = join(sessionDir, role, 'requests');
    let files: string[];
    try {
      files = readdirSync(requestsDir).filter((name) => name.endsWith('.md'));
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') warnings.push(`requests dir unreadable: ${role}/requests`);
      continue;
    }
    for (const name of files) {
      try {
        const mtimeMs = statSync(join(requestsDir, name)).mtimeMs;
        if (best === null || mtimeMs > best.mtimeMs) {
          best = { rel: `${role}/requests/${name}`, mtimeMs };
        }
      } catch {
        // A single unreadable artifact must not hide the rest of the tree, but
        // it must not disappear either — a rename/delete racing this read is
        // the likely cause and it is worth knowing the answer is partial.
        warnings.push(`request artifact unreadable: ${role}/requests/${name}`);
      }
    }
  }
  return { rel: best === null ? null : best.rel, warnings };
}

/** The POSIX errno code on a thrown value, or `undefined` for anything else. */
function errnoCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Read every available fact. Never throws: each source is guarded separately
 * and a failure is recorded in `unresolved` rather than propagated, because
 * the caller is a session-start hook.
 */
export function resolvePostCompactReinjectionFacts(input: {
  readonly projectRoot: string;
  readonly sessionId?: string | null | undefined;
}): PostCompactReinjectionFacts {
  const projectRoot = input.projectRoot;
  const unresolved: string[] = [];

  let sessionId: string | null = input.sessionId ?? null;
  if (sessionId === null) {
    try {
      sessionId = getSessionIdCanonical(projectRoot);
    } catch {
      sessionId = null;
    }
    if (sessionId === null) unresolved.push('session-id (no canonical binding)');
  }

  let jobId: string | null = null;
  let isJob = false;
  if (sessionId !== null) {
    try {
      const record = readJobShapeDecision(projectRoot, sessionId);
      isJob = record.decision.isJob;
      jobId = record.decision.suggestedJobId;
    } catch {
      unresolved.push('job-shape (not decided for this session)');
    }
  }

  let progress: PostCompactReinjectionFacts['progress'] = null;
  if (sessionId !== null && jobId !== null) {
    try {
      const read = tryReadJobProgress(projectRoot, sessionId, jobId);
      if (read === null) {
        unresolved.push('job-progress (no progress.json yet)');
      } else {
        progress = { done: read.done, total: read.total, currentSlice: read.currentSlice };
      }
    } catch {
      unresolved.push('job-progress (unreadable)');
    }
  }

  let latestRequest: string | null = null;
  if (sessionId !== null) {
    try {
      const found = findLatestRequestArtifact(projectRoot, sessionId);
      latestRequest = found.rel;
      for (const warning of found.warnings) unresolved.push(`latest-request (${warning})`);
    } catch {
      // The resolver reports its own failures; this is only for the
      // unforeseen, and it is still reported rather than silently dropped.
      unresolved.push('latest-request (resolver threw)');
    }
    if (latestRequest === null) unresolved.push('latest-request (none on disk)');
  }

  return { projectRoot, sessionId, jobId, isJob, progress, latestRequest, unresolved };
}

function buildBlocks(facts: PostCompactReinjectionFacts): ReinjectionBlock[] {
  const root = toPosix(facts.projectRoot);
  const blocks: ReinjectionBlock[] = [];

  // Rank 0 — identity.
  const identity: string[] = [`project: ${root}`];
  identity.push(`session: ${facts.sessionId ?? 'unbound'}`);
  blocks.push({
    rank: 0,
    heading: REINJECTION_BLOCK_HEADINGS[0] ?? 'state',
    label: REINJECTION_BLOCK_LABELS[0] ?? 'rank-0',
    lines: identity
  });

  // Rank 1 — pointers. Relative paths: the model's cwd is the project root,
  // so a relative path is both shorter and stable across machines.
  const pointers: string[] = [];
  if (facts.sessionId !== null) {
    const base = `.peaks/_runtime/${facts.sessionId}`;
    pointers.push(`session tree: ${base}/`);
    pointers.push(`requests: read the newest file under ${base}/<role>/requests/`);
    if (facts.jobId !== null)
      pointers.push(`job progress: ${base}/job/${facts.jobId}/progress.json`);
    pointers.push(`job shape: ${base}/job-shape.json`);
    pointers.push(`dispatch records: .peaks/_sub_agents/${facts.sessionId}/dispatch-*.json`);
  } else {
    pointers.push('session tree: unbound — run `peaks workspace init --project .` first');
  }
  pointers.push('project memory: .peaks/memory/ (read the index before assuming)');
  blocks.push({
    rank: 1,
    heading: REINJECTION_BLOCK_HEADINGS[1] ?? 'where to read',
    label: REINJECTION_BLOCK_LABELS[1] ?? 'rank-1',
    lines: pointers
  });

  // Rank 2 — the rules that only exist in the summarized history.
  blocks.push({
    rank: 2,
    heading: REINJECTION_BLOCK_HEADINGS[2] ?? 'rules',
    label: REINJECTION_BLOCK_LABELS[2] ?? 'rank-2',
    lines: [...AGENT_RUNTIME_RULES]
  });

  // Rank 3 — next action.
  const next: string[] = [];
  if (facts.progress !== null) {
    next.push(
      `job ${facts.jobId ?? '?'}: slice ${facts.progress.done + 1}/${facts.progress.total} (${facts.progress.currentSlice})`
    );
  } else if (facts.isJob) {
    next.push(
      `job ${facts.jobId ?? '?'}: no progress.json yet — resume at the first unfinished slice`
    );
  } else if (facts.latestRequest !== null) {
    // NOT "continue <path>". The newest artifact is the best available guess
    // at the live request, but it is only a guess — a sibling role writing to
    // its own `requests/` directory bumps that directory's mtimes too, so the
    // card names the candidate and sends the model to the authority (the
    // dispatch record) rather than promoting a heuristic into an instruction.
    next.push(
      `no active job — confirm the live request from the dispatch record, then continue it`
    );
  } else {
    next.push('no job and no request on disk — re-read the user request before acting');
  }
  blocks.push({
    rank: 3,
    heading: REINJECTION_BLOCK_HEADINGS[3] ?? 'next',
    label: REINJECTION_BLOCK_LABELS[3] ?? 'rank-3',
    lines: next
  });

  // Rank 4 — current work identity + progress.
  const current: string[] = [];
  current.push(`session: ${facts.sessionId ?? 'unbound'}`);
  if (facts.jobId !== null) {
    current.push(`job: ${facts.jobId}${facts.isJob ? ' (job mode)' : ''}`);
  }
  if (facts.progress !== null) {
    current.push(
      `progress: ${facts.progress.done}/${facts.progress.total} — current ${facts.progress.currentSlice}`
    );
  }
  if (facts.latestRequest !== null) {
    current.push(`latest request artifact: ${facts.latestRequest}`);
  }
  blocks.push({
    rank: 4,
    heading: REINJECTION_BLOCK_HEADINGS[4] ?? 'current work',
    label: REINJECTION_BLOCK_LABELS[4] ?? 'rank-4',
    lines: current
  });

  return blocks;
}

export type PostCompactReinjectionCard = {
  /** True when a card was produced. False only if rendering itself failed. */
  readonly ok: boolean;
  readonly text: string;
  readonly bytes: number;
  readonly budgetBytes: number;
  readonly sessionId: string | null;
  readonly emittedRanks: readonly number[];
  readonly droppedRanks: readonly number[];
  readonly unresolved: readonly string[];
};

/**
 * Build the card for a project. This is the whole production surface: read
 * the facts, render them under the budget, return. NEVER throws — a thrown
 * error here would surface on session start, which is the one place the
 * absence of this feature must not be able to break anything.
 */
export function buildPostCompactReinjectionCard(input: {
  readonly projectRoot: string;
  readonly sessionId?: string | null | undefined;
  readonly budgetBytes?: number | undefined;
}): PostCompactReinjectionCard {
  const budgetBytes = input.budgetBytes ?? POST_COMPACT_REINJECTION_BYTE_BUDGET;
  let facts: PostCompactReinjectionFacts;
  try {
    facts = resolvePostCompactReinjectionFacts({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId ?? null
    });
  } catch {
    // The resolver is guarded source-by-source; this is the belt-and-braces
    // path for anything unforeseen. An empty card is the correct outcome —
    // the hook then contributes nothing to the context, which is exactly
    // what a session with no state to re-inject should contribute.
    return {
      ok: false,
      text: '',
      bytes: 0,
      budgetBytes,
      sessionId: null,
      emittedRanks: [],
      droppedRanks: [],
      unresolved: ['facts-resolution-threw']
    };
  }

  const card = renderReinjectionCard({ blocks: buildBlocks(facts), budgetBytes });
  return {
    ok: true,
    text: card.text,
    bytes: card.bytes,
    budgetBytes: card.budgetBytes,
    sessionId: facts.sessionId,
    emittedRanks: card.emittedRanks,
    droppedRanks: card.droppedRanks,
    unresolved: facts.unresolved
  };
}
