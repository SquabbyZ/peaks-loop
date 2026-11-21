// Split out of `workspace/init-actions.ts`: the harness auto-compact threshold
// reconciliation `peaks workspace init` performs, so that installing peaks-loop
// in a downstream project leaves that project configured for early compaction
// (window + percent, in the project's own `.claude/settings.local.json`).
//
// FAIL-SOFT, ALWAYS. An init must not abort because a settings file is
// unreadable or an adapter declares no knob: every outcome lands in
// `nextActions` (a write) or `warnings` (a refusal worth seeing), and nothing
// thrown escapes this module. The one thing it never does is write to the
// user's global `~/.claude/settings.json` — the location it is handed is the
// project's, and the shared home-directory guard refuses `$HOME` as a root.
import {
  describeHarnessCompactThreshold,
  describeHarnessThresholdRefusal,
  describeHarnessThresholdWindowRefusal,
  describeWindowOnly,
  ensureHarnessCompactThreshold,
  type HarnessCompactThresholdResult
} from '../../../services/context/harness-compact-threshold-ensure.js';
import { resolveHarnessCompactThresholdLocation } from '../../../services/context/harness-compact-threshold-config.js';
import { getErrorMessage } from '../../cli-helpers.js';

/**
 * Reconcile the project's harness compact threshold and report it.
 *
 * Returns the value the envelope carries (`null` when the active adapter
 * declares no pair of knobs), so a consumer can read the outcome rather than
 * parse the prose.
 *
 * `--no-claude-hooks` SUPPRESSES THE WRITE ENTIRELY. That flag promises init
 * will not touch the harness settings file, and `.claude/settings.local.json`
 * IS that file (`tests/integration/five-new-rids-e2e.test.ts` pins it: after an init
 * with the flag, the file does not exist). An earlier shape of this reconcile
 * wrote the two `env` rows anyway and merely SAID so — honest prose around a
 * write the flag forbids, which is still the flag being broken. The rows are
 * written by the next plain init instead, so nothing is lost.
 */
export function ensureInitHarnessThreshold(
  nextActions: string[],
  warnings: string[],
  projectRoot: string,
  options: { readonly claudeHooks?: boolean | undefined } = {}
): HarnessCompactThresholdResult | null {
  if (options.claudeHooks === false) return null;
  try {
    const location = resolveHarnessCompactThresholdLocation({
      projectRoot,
      env: process.env
    });
    if (location === null) return null;
    const result = ensureHarnessCompactThreshold({ location, env: process.env });
    const notice = describeHarnessCompactThreshold(result);
    // ROUTED BY OUTCOME, ON TWO CHANNELS. The old shape had one predicate
    // (`written || skipped`) and pushed ONE string, so a refusal travelled as a
    // warning that could open with "WROTE <windowKey>=<n>".
    //
    //   - `written` (either knob) changed the project's own harness settings, and
    //     the harness reports its threshold only through `/autocompact`, so it is
    //     news: `nextActions`.
    //   - `unchanged` is SILENT, including a hand pin. The file already holds the
    //     value this call would write, so "already in force" is the honest answer
    //     and repeating it on every re-init is noise — not a refusal, because
    //     nothing is unconfigured.
    //   - `skipped` is a REFUSAL: the project is NOT configured, which is what
    //     this slice promises on install, so it goes to `warnings` as a refusal
    //     sentence of its own.
    //
    // THE WINDOW HALF COUNTS AS A WRITE. The two knobs are two separate writes,
    // so a project with a hand-set percent and no window gets the window written
    // while the percent reports `unchanged`; gating on the percent alone swallowed
    // that write and said nothing about it.
    //
    // AND THE WINDOW HALF CAN BE REFUSED ON ITS OWN. Routing only the percent's
    // `skipped` left a project whose window was refused (an out-of-band `50000`,
    // say) with NO warning at all — and with a hand-set percent it produced
    // complete silence about a project that is not configured. So BOTH halves are
    // checked, and the notices are composed once, here, so a write announcement
    // and a refusal can never be printed as two competing paragraphs.
    const windowWritten = result.window.action === 'written';
    const percentWritten = result.percent.action === 'written';
    // THE WRITE CHANNEL, one line for whichever half wrote. When BOTH wrote, the
    // combined describer folds the window clause into the percent write; when a
    // half was REFUSED the combined sentence carries no clause about it (the
    // describer only mentions a window that WROTE), so it can never open with a
    // write under a refusal — the refusal travels on its own channel below.
    const refusal = thresholdRefusal(result);
    if (percentWritten) {
      nextActions.push(notice);
    } else if (windowWritten) {
      nextActions.push(describeWindowOnly(result));
    }
    // THE REFUSAL CHANNEL: one warning that names WHICH half failed and why.
    // "Harness threshold not managed: …" alone can read as one knob's footnote
    // rather than the install's outcome, so the init-level frame says the thing
    // a reader of `warnings` has to act on: the install left this project NOT
    // fully configured. It never carries a write clause — the write is announced
    // on `nextActions`, so the warning cannot open with `WROTE …`.
    if (refusal !== null) {
      warnings.push(
        `harness auto-compact threshold: the project is NOT fully configured — ${refusal}`
      );
    }
    return result;
  } catch (err) {
    warnings.push(`harness auto-compact threshold not configured: ${getErrorMessage(err)}`);
    return null;
  }
}

/**
 * The refusal sentence for whichever half was refused, or null when neither was.
 *
 * BOTH HALVES are checked. Routing only the percent's `skipped` (the shape this
 * slice shipped) left a project whose WINDOW was refused — an out-of-band
 * `50000`, say — with no notice at all, and with a hand-set percent it produced
 * complete silence about a project that is not configured.
 */
function thresholdRefusal(result: HarnessCompactThresholdResult): string | null {
  const clauses: string[] = [];
  if (result.percent.action === 'skipped') {
    // The percent describer already opens with its own "Harness threshold not
    // managed" frame, so it is used as-is.
    clauses.push(describeHarnessThresholdRefusal(result));
  }
  if (result.window.action === 'skipped') {
    // The window describer is CLAUSE-ONLY (no frame), so the one frame is
    // supplied here and the two halves cannot stack "not managed" twice.
    clauses.push(`Harness window not managed — ${describeHarnessThresholdWindowRefusal(result)}`);
  }
  return clauses.length === 0 ? null : clauses.join(' ');
}

/**
 * Say what `--no-claude-hooks` did to the threshold reconcile.
 *
 * The flag SUPPRESSES the write (see `ensureInitHarnessThreshold`), so silence
 * here would leave the envelope's `harnessThreshold: null` reading as "the
 * adapter declares no knobs" rather than "you asked init not to touch the
 * settings file". Named so the omission is a stated fact.
 */
export function reportThresholdDespiteNoHooks(
  nextActions: string[],
  options: { readonly claudeHooks?: boolean | undefined }
): void {
  if (options.claudeHooks !== false) return;
  nextActions.push(
    'The harness auto-compact threshold (window + percent) was NOT written: ' +
      '--no-claude-hooks skips .claude/settings.local.json entirely, and those rows live ' +
      'in the same file. A later `peaks workspace init` without the flag configures them.'
  );
}
