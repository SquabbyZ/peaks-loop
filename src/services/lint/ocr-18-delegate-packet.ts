/**
 * OCR 1.x delegation — phase 1: the review packet.
 *
 * The packet is the durable artifact the host agent reviews from: which files
 * OCR selected and by which pattern, which it excluded, the resolved rule text
 * per group, the git range, and the cost surface. Building it never calls an
 * LLM and never reads a key.
 *
 * It keeps the pinned CLI's snake_case field names because it is a boundary
 * document. `findings` is always `null` here: a recorded review carries `[]`
 * when it was clean, so "the agent never ran" cannot be read as zero findings.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { normalizePath } from '../../shared/path-utils.js';
import { languageForPath, type Ocr18Language } from './ocr-18-language-routing.js';
import { detectLanguages, type Ocr18Detection } from './ocr-18-multi.js';
import {
  buildDelegateRuleArgs,
  parseDelegateRules,
  runDelegatePreview,
  type DelegateFile,
  type DelegatePreview,
  type DelegateRuleGroup,
  type RulesResult
} from './ocr-18-delegate-payload.js';
import { invokeOcr, type Ocr18Range, type Ocr18State } from './ocr-multilang-adapter.js';

/** `delegate rule` takes paths as argv; this keeps each invocation under the Windows limit. */
const RULE_BATCH = 50;

export type DelegateSelectedFile = {
  readonly path: string;
  readonly status: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly language: Ocr18Language | null;
  /** The glob that selected this file, or `null` when no rule group claimed it. */
  readonly pattern: string | null;
};

export type DelegatePacketState =
  'no-routed-language' | 'unsupported-files-only' | 'ocr-unavailable' | 'awaiting-envelope';

export type DelegatePacket = {
  readonly schema_version: '1';
  readonly mode: 'delegate';
  readonly state: DelegatePacketState;
  readonly findings: null;
  readonly rid: string;
  readonly session: string;
  readonly git: {
    readonly from: string | null;
    readonly to: string | null;
    readonly commit: string | null;
  };
  readonly detection: {
    readonly languages: readonly Ocr18Language[];
    readonly changed_file_count: number;
    readonly unsupported_files: readonly string[];
  };
  readonly cost: {
    readonly total_files: number;
    readonly reviewable_count: number;
    readonly excluded_count: number;
    readonly total_insertions: number;
    readonly total_deletions: number;
  } | null;
  readonly selected_files: readonly DelegateSelectedFile[];
  readonly excluded_files: readonly DelegateFile[];
  readonly rules: readonly DelegateRuleGroup[];
  readonly warnings: readonly string[];
  readonly raw_output: string | null;
};

function patternFor(path: string, rules: readonly DelegateRuleGroup[]): string | null {
  const target = normalizePath(path);
  for (const group of rules) {
    if (group.files.some((file) => normalizePath(file) === target)) return group.pattern;
  }
  return null;
}

function selectFiles(
  preview: DelegatePreview | null,
  rules: readonly DelegateRuleGroup[]
): { readonly files: readonly DelegateSelectedFile[]; readonly warnings: readonly string[] } {
  if (preview === null) return { files: [], warnings: [] };
  const warnings: string[] = [];
  const files = preview.reviewable_files.map((file) => {
    const pattern = patternFor(file.path, rules);
    if (pattern === null) warnings.push(`no rule group matched ${file.path}`);
    return {
      path: file.path,
      status: file.status,
      insertions: file.insertions,
      deletions: file.deletions,
      language: languageForPath(file.path),
      pattern
    };
  });
  return { files, warnings };
}

export type DelegatePacketInput = {
  readonly rid: string;
  readonly session: string;
  readonly range: Ocr18Range;
  readonly detection: Ocr18Detection;
  readonly preview: DelegatePreview | null;
  readonly rules: readonly DelegateRuleGroup[];
  readonly unavailable: string | null;
};

function packetState(input: DelegatePacketInput): DelegatePacketState {
  if (input.unavailable !== null) return 'ocr-unavailable';
  if (input.preview !== null) return 'awaiting-envelope';
  // Zero changed files and "files changed, none reviewable" are different facts.
  return input.detection.changedFileCount === 0 ? 'no-routed-language' : 'unsupported-files-only';
}

export function buildDelegatePacket(input: DelegatePacketInput): DelegatePacket {
  const selected = selectFiles(input.preview, input.rules);
  return {
    schema_version: '1',
    mode: 'delegate',
    state: packetState(input),
    findings: null,
    rid: input.rid,
    session: input.session,
    git: {
      from: input.range.from ?? null,
      to: input.range.to ?? null,
      commit: input.range.commit ?? null
    },
    detection: {
      languages: input.detection.languages,
      changed_file_count: input.detection.changedFileCount,
      unsupported_files: input.detection.unsupportedFiles
    },
    cost:
      input.preview === null
        ? null
        : {
            total_files: input.preview.total_files,
            reviewable_count: input.preview.reviewable_count,
            excluded_count: input.preview.excluded_count,
            total_insertions: input.preview.total_insertions,
            total_deletions: input.preview.total_deletions
          },
    selected_files: selected.files,
    excluded_files: input.preview?.excluded_files ?? [],
    rules: input.rules,
    warnings: selected.warnings,
    raw_output: input.unavailable
  };
}

function mergeGroups(
  merged: Map<string, DelegateRuleGroup>,
  groups: readonly DelegateRuleGroup[]
): void {
  for (const group of groups) {
    const key = `${group.source}|${group.pattern}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { ...group, files: [...group.files] });
      continue;
    }
    const files = [...existing.files];
    for (const file of group.files) if (!files.includes(file)) files.push(file);
    merged.set(key, { ...existing, files });
  }
}

/** Rule resolution in batches, merged by `source|pattern` — the key the rule text is resolved on. */
export function collectDelegateRules(
  cwd: string,
  paths: readonly string[],
  range: Ocr18Range,
  timeoutMs?: number
): RulesResult {
  const merged = new Map<string, DelegateRuleGroup>();
  for (let start = 0; start < paths.length; start += RULE_BATCH) {
    const batch = paths.slice(start, start + RULE_BATCH);
    const invoked = invokeOcr(buildDelegateRuleArgs(batch, range), cwd, timeoutMs);
    if (!invoked.ok) return { ok: false, state: invoked.state, rawOutput: invoked.rawOutput };
    const parsed = parseDelegateRules(invoked.stdout);
    if (!parsed.ok) return parsed;
    mergeGroups(merged, parsed.groups);
  }
  return { ok: true, groups: [...merged.values()] };
}

/**
 * A rid is ONE path segment: it names the packet file under the session's
 * `rd/ocr-delegate/` directory, so a separator or a traversal value would move
 * the write somewhere the caller did not name.
 */
export function isDelegateRid(value: string): boolean {
  return (
    value.length > 0 && !isUnsafePathInput(value) && !value.includes('/') && !value.includes('\\')
  );
}

function assertRid(value: string): void {
  if (!isDelegateRid(value)) throw new Error(`invalid rid: ${value}`);
}

export type CollectDelegateOptions = {
  readonly cwd: string;
  readonly rid: string;
  readonly session: string;
  readonly range: Ocr18Range;
  readonly timeoutMs?: number;
};

export type DelegatePacketResult = {
  readonly packet: DelegatePacket;
  readonly failure: { readonly state: Ocr18State; readonly rawOutput: string } | null;
};

/**
 * Phase 1. Writes nothing; the caller owns the path and the durable write.
 *
 * No routed language skips BOTH invocations, exactly like the API path: spawning
 * OCR to discover there is nothing to review is the cost that guard exists for.
 */
export function collectDelegatePacket(options: CollectDelegateOptions): DelegatePacketResult {
  assertRid(options.rid);
  const detection = detectLanguages(options.cwd, options.range);
  const base = { rid: options.rid, session: options.session, range: options.range, detection };
  const unavailable = (state: Ocr18State, rawOutput: string): DelegatePacketResult => ({
    packet: buildDelegatePacket({ ...base, preview: null, rules: [], unavailable: rawOutput }),
    failure: { state, rawOutput }
  });

  if (detection.languages.length === 0) {
    return {
      packet: buildDelegatePacket({ ...base, preview: null, rules: [], unavailable: null }),
      failure: null
    };
  }
  const preview = runDelegatePreview(options.cwd, options.range, options.timeoutMs);
  if (!preview.ok) return unavailable(preview.state, preview.rawOutput);

  const paths = preview.preview.reviewable_files.map((file) => file.path);
  const rules = collectDelegateRules(options.cwd, paths, options.range, options.timeoutMs);
  if (!rules.ok) return unavailable(rules.state, rules.rawOutput);

  return {
    packet: buildDelegatePacket({
      ...base,
      preview: preview.preview,
      rules: rules.groups,
      unavailable: null
    }),
    failure: null
  };
}

export function writeDelegatePacket(packetPath: string, packet: DelegatePacket): void {
  mkdirSync(dirname(packetPath), { recursive: true });
  writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}
