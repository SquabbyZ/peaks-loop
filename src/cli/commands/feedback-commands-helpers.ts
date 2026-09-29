/**
 * Support constants + option schema + hint renderer extracted verbatim from
 * `feedback-commands.ts` (file-size cap campaign). Mechanical move only: the
 * command descriptions, the promote action option schema, the two next-action
 * lists, and the exempt-entries hint line.
 */

export const FEEDBACK_PARENT_DESCRIPTION =
  'v2.15.0 slice 002 AC-3: promote user-given feedback memories to peaks-loop enforcement layers (A: sop, B: hooks, C: hard-floor).';

export const PROMOTE_DESCRIPTION =
  'Promote a feedback memory to one of the 3 enforcement layers (A=peaks-sop gate, B=peaks-hooks PreToolUse, C=mode-gate hardFloorCategory). ' +
  'Reads `.peaks/memory/<file>.md` and writes the promotion marker (HTML comment + sidecar .promotion.json) + an RD envelope at ' +
  '`.peaks/_runtime/<sid>/rd/feedback-promote-<name>.json`. Layer A additionally generates and registers the SOP manifest the ' +
  'SOP engine reads. Layers B and C live in shared files the command does not own, so it records the requirement and exits ' +
  'non-zero (PROMOTION_NOT_EFFECTIVE) until the registration is present. ' +
  'Without --layer, the CLI lists the 3 layer options as nextActions and exits with code 0 ' +
  '(use --layer <A|B|C> to actually promote, or pass --dry-run to preview the stub).';

export const CHECK_UNPROMOTED_DESCRIPTION =
  'Scan `.peaks/memory/*.md` and list feedback memories without a promotion marker. ' +
  'Default: dry-run (exit 0, just warn). Pass --strict to fail with exit code 1 when any ' +
  'unpromoted feedback is found — this is what `peaks workflow verify-pipeline` Gate H uses.';

export interface FeedbackPromoteOpts {
  layer?: string;
  project?: string;
  promotedBy?: string;
  dryRun?: boolean;
  json?: boolean;
}

export const NO_LAYER_NEXT_ACTIONS = [
  'No --layer passed. Choose one of A / B / C and re-run.',
  'A: append to sops/*.md (procedural rules)',
  'B: append a matcher to .peaks/.claude-settings-template.json (tool-call interception)',
  'C: extend HardFloorCategory in mode-gate.ts (always pauses regardless of mode)',
  'Or pass --dry-run to preview all three stubs first.'
];

export const UNPROMOTED_NEXT_ACTIONS = [
  `Run \`peaks feedback promote <memory-file> --layer <A|B|C>\` for each entry above.`,
  'A = peaks-sop gate, B = peaks-hooks PreToolUse, C = mode-gate hardFloorCategory.',
  'A marker alone does not count: the entry above names the artifact its layer still owes.',
  'See sops/feedback-promotion-sop.md for the SOP and the layer-choice rubric.'
];

export function formatExemptHint(exempt: readonly { name: string; code: string }[]): string {
  return `${exempt.length} memor${exempt.length === 1 ? 'y' : 'ies'} declare themselves not-to-be-promoted: ${exempt.map((e) => `${e.name} (${e.code})`).join('; ')}.`;
}
