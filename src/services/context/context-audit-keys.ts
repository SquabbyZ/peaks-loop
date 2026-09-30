/**
 * Stable group-key builders for `peaks code context-audit` — the
 * `(tool name, short input key)` half of the grouping contract.
 *
 * Moved out of `./context-audit.ts` (wave 3, eslint-family sweep). Every
 * case body, predicate and clip budget below is copied EXACTLY from the
 * original switch; the switch is only split into two sequential halves so
 * no single function crosses the complexity ceiling. For every `(tool,
 * input)` pair the returned key is identical to before the move.
 */

/** Max characters kept in a group key — keys are labels, not payloads. */
const KEY_MAX_CHARS = 100;
/** `Task` / `Agent` descriptions are kept even shorter (label, not payload). */
const TASK_KEY_MAX_CHARS = 60;
/** Budget for the JSON fallback used by unknown tools. */
const FALLBACK_KEY_MAX_CHARS = 80;

function readInputString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function clip(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/** Last `n` path segments — keeps `Read` / `Edit` keys short but identifiable. */
function tailPath(value: string, n: number): string {
  const parts = value.split(/[\\/]/).filter((p) => p.length > 0);
  return parts.slice(Math.max(0, parts.length - n)).join('/');
}

const NOT_A_KEY = null;

/** First half of the original switch: execution / file / search tools. */
function keyForKnownTool(tool: string, i: Record<string, unknown>): string | null {
  switch (tool) {
    case 'Bash':
      return clip(readInputString(i.command), KEY_MAX_CHARS);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return clip(tailPath(readInputString(i.file_path), 2), KEY_MAX_CHARS);
    case 'Grep':
    case 'Glob':
      return clip(
        `${readInputString(i.pattern)} @ ${readInputString(i.path) || '.'}`,
        KEY_MAX_CHARS
      );
    default:
      return NOT_A_KEY;
  }
}

/** Second half of the original switch: agent tools + unknown-tool fallback. */
function keyForRemainingTool(tool: string, i: Record<string, unknown>): string {
  switch (tool) {
    case 'Task':
    case 'Agent':
      return clip(
        readInputString(i.description) || readInputString(i.subagent_type),
        TASK_KEY_MAX_CHARS
      );
    default: {
      let json: string;
      try {
        json = JSON.stringify(i) ?? '';
      } catch {
        json = '';
      }
      return clip(json, FALLBACK_KEY_MAX_CHARS);
    }
  }
}

/**
 * Build the stable group key for one tool call. Unknown tools fall back to a
 * clipped JSON rendering of their input so the group is still recognizable.
 */
export function contextAuditKey(tool: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const i = input as Record<string, unknown>;
  const known = keyForKnownTool(tool, i);
  if (known !== NOT_A_KEY) return known;
  return keyForRemainingTool(tool, i);
}
