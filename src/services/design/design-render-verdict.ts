/**
 * How one designlang check result becomes a G2 verdict.
 *
 * The verdict comes from the tool's own evidence first, and only falls back
 * to the exit code when no evidence parsed — "a parsed report still wins over
 * the code". The exit codes are designlang's own (0 OK / 1 DRIFT /
 * 2 EXTRACTION_FAILED / 3 NAVIGATION_TIMEOUT):
 *
 * - `verify-ui` exit 1 is the scored fail; exit 2 is an unusable page, which
 *   must block (`DESIGN_PAGE_UNUSABLE`), never fail; exit 3 is a navigation
 *   timeout, a retryable block.
 * - `drift` exit 1 is a real drift report and fails; exit 3 blocks as
 *   retryable. The page-usability probe already blocks blank and login pages
 *   before this runs, so a nonzero drift here is about the design, not noise.
 *
 * Nothing here turns an unrun or shapeless check into a pass.
 */
import { redactSensitiveErrorMessage } from 'peaks-loop-shared/result';

import { blockedMessage } from './acceptance.js';
import { parseDesignlangEvidence, type DesignlangRunResult } from './designlang.js';
import { redactUrl } from './url-redact.js';

/** Exit code designlang uses for an unusable page (empty stdout, unreadable). */
const EXIT_UNUSABLE_PAGE = 2;
/** Exit code designlang uses for a navigation timeout. */
const EXIT_NAVIGATION_TIMEOUT = 3;
/** A carried cause is one short line of evidence, not a log dump. */
const CAUSE_MAX_CHARS = 240;

/** The G2-relevant classification of one check run. */
export type RenderVerdict =
  | { status: 'pass' }
  | { status: 'fail'; reason: string }
  | { status: 'blocked'; code: string; message: string; cause?: string };

function fail(kind: string, detail: string, url: string): RenderVerdict {
  return { status: 'fail', reason: `designlang ${kind} ${detail} for ${redactUrl(url)}` };
}

/**
 * Why the tool said the page was unusable, single-lined and redacted, or null
 * when it printed nothing. It is carried as `cause` so a missing brand primary,
 * an unreadable page and a failed capture are told apart instead of all three
 * reading as "the page cannot be judged".
 */
function stderrCause(result: DesignlangRunResult): string | null {
  const text = redactUrl(redactSensitiveErrorMessage(result.stderr)).trim().replace(/\s+/g, ' ');
  if (text === '') return null;
  return text.length > CAUSE_MAX_CHARS ? `${text.slice(0, CAUSE_MAX_CHARS)}…` : text;
}

function blockedRetryable(kind: string, url: string): RenderVerdict {
  return {
    status: 'blocked',
    code: 'DESIGN_RENDER_RETRYABLE',
    message: `${blockedMessage('DESIGN_RENDER_RETRYABLE')} (designlang ${kind} exited ${String(EXIT_NAVIGATION_TIMEOUT)} for ${redactUrl(url)})`
  };
}

/** No evidence parsed: the exit code decides fail / retryable / no evidence. */
function noReportVerdict(
  kind: string,
  result: DesignlangRunResult,
  url: string,
  evidenceMessage: string
): RenderVerdict {
  if (result.exitCode === EXIT_NAVIGATION_TIMEOUT) return blockedRetryable(kind, url);
  if (result.exitCode !== 0) {
    return fail(kind, `exited ${String(result.exitCode)}`, url);
  }
  return {
    status: 'blocked',
    code: 'DESIGN_RENDER_NO_EVIDENCE',
    // The parser's message already names the tool and the kind; prefixing it
    // again produced "produced no evidence: designlang drift produced no ...".
    message: redactUrl(evidenceMessage)
  };
}

/**
 * Judge one `drift` run. The payload's own verdict decides: `in-sync` passes,
 * any of the three drift verdicts fails; a report that does not echo the page
 * and tokens file the adapter passed is no evidence.
 */
export function driftVerdict(
  result: DesignlangRunResult,
  url: string,
  tokensPath: string
): RenderVerdict {
  const evidence = parseDesignlangEvidence({
    kind: 'drift',
    stdout: result.stdout,
    expect: { url, tokensFile: tokensPath }
  });
  if (!evidence.ok) return noReportVerdict('drift', result, url, evidence.message);
  const verdict = evidence.raw.verdict;
  if (verdict === 'in-sync') return { status: 'pass' };
  return fail('drift', `reported ${String(verdict)}`, url);
}

/**
 * Judge one `verify-ui` run. `pass: true` passes and `pass: false` fails even
 * when the exit code disagrees; with no parsed report, exit 2 blocks as
 * `DESIGN_PAGE_UNUSABLE`, exit 3 blocks as retryable, and exit 1 fails.
 */
export function verifyUiVerdict(result: DesignlangRunResult, url: string): RenderVerdict {
  const evidence = parseDesignlangEvidence({ kind: 'verify-ui', stdout: result.stdout });
  if (evidence.ok) {
    if (evidence.raw.pass === true) return { status: 'pass' };
    return fail('verify-ui', 'reported pass: false', url);
  }
  if (result.exitCode === EXIT_UNUSABLE_PAGE) {
    // Exit 2 is the tool's own "could not extract this page" bucket: a missing
    // brand primary, an unreadable page and a failed capture share it, so the
    // tool's stderr is carried as the cause instead of re-labelling the page.
    const cause = stderrCause(result);
    return {
      status: 'blocked',
      code: 'DESIGN_PAGE_UNUSABLE',
      message: `${blockedMessage('DESIGN_PAGE_UNUSABLE')} (designlang verify-ui exited ${String(EXIT_UNUSABLE_PAGE)} for ${redactUrl(url)}${cause === null ? '' : `: ${cause}`})`,
      ...(cause === null ? {} : { cause })
    };
  }
  return noReportVerdict('verify-ui', result, url, evidence.message);
}
