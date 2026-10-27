/**
 * `src/services/observability/report-formatter-near-miss.ts`
 *
 * The near-miss section of the markdown report.
 *
 * WHY IT IS ITS OWN MODULE. `report-formatter.ts` was already near its
 * 300-line cap, and this section does not fit beside the rest of it. The
 * split follows the precedent in this directory: the hotspot section lives
 * in `report-formatter-hotspots.ts` for the same reason.
 *
 * WHY THE RATE NEVER APPEARS ALONE. The report is what leaves the terminal
 * — it gets pasted into a PR description — so a number in it has to be read
 * the way it was measured. The near-miss rate is measured over the reason
 * classes the scope had events for, and a scope can hold events for ONE of
 * the three classes: the `gate` emitter postdates every session in this
 * repository's recorded history, so two of the three classes have no events
 * at all there.
 *
 * A rate printed on its own is therefore ambiguous between "there were no
 * near-misses" and "the classes that could have shown a near-miss were never
 * observed" — and the second reading is an ABSENCE read as a RESULT, which
 * is the exact failure this whole programme exists to close. So the rate line
 * carries its coverage with it: how many of the reason classes the rate was
 * measured over, and that the rest is an absence of data rather than a
 * result. A reader who sees ONLY the rate line still cannot draw the wrong
 * conclusion.
 *
 * WHY THE COVERAGE IS A TABLE. Each class's rate divides by the slices THAT
 * CLASS REACHED, not by every passing slice, so the class's own population
 * has to travel with its number. The table says, per class: whether the class
 * was observable at all, how many events it had, how many slices it reached,
 * how many it flagged, and the rate it supports — or `not measured`, which is
 * what a class with no events gets instead of a zero.
 *
 * WHY THE FLAGGED SLICES ARE LISTED. The count has to have a referent: a
 * reader who is told that one slice passed with a check unsatisfied has to
 * be able to see WHICH slice and WHICH check.
 */

import type { NearMissClassCoverage, NearMissReport } from './near-miss.js';

/** How many decimals the rate's fraction is rounded to. */
const RATE_DECIMALS = 3;

/** How many decimals the rate's percentage is rounded to. */
const PERCENT_DECIMALS = 1;

/** The rate as a fraction and as a percentage — the two readings of one number. */
function formatRate(rate: number): string {
  const fraction = Number(rate.toFixed(RATE_DECIMALS));
  const percent = Number((rate * 100).toFixed(PERCENT_DECIMALS));
  return `${fraction} (${percent}%)`;
}

/** A rate as a percentage alone — the coverage table's cell. */
function formatPercent(rate: number): string {
  return `${Number((rate * 100).toFixed(PERCENT_DECIMALS))}%`;
}

/**
 * The line that states the rate AND what the rate was measured over.
 *
 * The qualifier is on the rate's own line, not on a line further down, so a
 * reader who reads nothing else still cannot take a zero for a finding.
 */
function rateLine(nearMiss: NearMissReport): string {
  const observableCount = nearMiss.coverage.filter((item) => item.observable).length;
  const unobservedCount = nearMiss.unobservedClasses.length;
  const coverage =
    unobservedCount === 0
      ? `measured over all ${nearMiss.coverage.length} reason classes, every one of which was ` +
        'OBSERVABLE in this scope'
      : `measured over the ${observableCount} of ${nearMiss.coverage.length} reason classes that ` +
        `were OBSERVABLE in this scope; the other ${unobservedCount} class(es) had no events to ` +
        'observe, so their share of the rate is an absence of data, not a result';
  return (
    `- **rate**: ${formatRate(nearMiss.nearMissRate)} — ` +
    `${nearMiss.nearMissSliceCount} of ${nearMiss.passedSliceCount} passed slice(s) were ` +
    `near-misses. The rate is ${coverage}.`
  );
}

/** The line that states the denominator and the definition it counts by. */
function denominatorLine(nearMiss: NearMissReport): string {
  const denominator = nearMiss.denominator;
  return `- **denominator**: ${denominator.sliceCount} slice(s) — ${denominator.definition}`;
}

/**
 * The line that reconciles the denominator with the status summary's count.
 *
 * "Passed" has two definitions in this repository and they do not count the
 * same slices, so the difference is stated rather than smoothed over.
 */
function statusLine(nearMiss: NearMissReport): string {
  const denominator = nearMiss.denominator;
  if (denominator.difference === null) {
    return (
      `- **status summary's success count**: ${denominator.statusSuccessCount} — the two ` +
      '"passed" definitions agree over this scope.'
    );
  }
  return (
    `- **status summary's success count**: ${denominator.statusSuccessCount} — the two ` +
    '"passed" definitions do NOT count the same slices; the gap is stated below.'
  );
}

/** The lines that say which gates the stream did not decide the liveness of. */
function undeterminedLines(nearMiss: NearMissReport): string[] {
  const lines = [
    `- **undetermined**: ${nearMiss.undetermined.length} gate(s) whose liveness the recorded ` +
      'stream did not decide.'
  ];
  for (const item of nearMiss.undetermined) {
    lines.push(`  - \`${item.sliceRid}\` / \`${item.gateId}\` — ${item.reason}`);
  }
  return lines;
}

/** The coverage table: what each reason class could and could not be observed for. */
function coverageTable(coverage: readonly NearMissClassCoverage[]): string {
  const lines: string[] = [];
  lines.push('### Coverage');
  lines.push('');
  lines.push(
    "Each class's rate is over the slices that class REACHED — a class that saw five slices " +
      'out of a hundred reports one in five, not one in a hundred. A class with no events was ' +
      'NOT observed, so it has no rate.'
  );
  lines.push('');
  lines.push('| reason class | observable | events | slices observed | slices flagged | rate |');
  lines.push('|---|---|---|---|---|---|');
  for (const item of coverage) {
    lines.push(
      `| ${item.reason} | ${item.observable ? 'yes' : 'no'} | ${item.scopeEventCount} | ` +
        `${item.observedSliceCount} | ${item.nearMissSliceCount} | ` +
        `${item.rate === null ? 'not measured' : formatPercent(item.rate)} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** The line that names the classes the rate does not measure. */
function unobservedLine(nearMiss: NearMissReport): string {
  const unobserved = nearMiss.unobservedClasses;
  if (unobserved.length === 0) {
    return '- **unobserved classes**: none — every reason class had events to observe in this scope.';
  }
  const names = unobserved.map((reason) => `\`${reason}\``).join(', ');
  return (
    `- **unobserved classes**: ${names} — these classes had NO events in this scope, so the ` +
    'rate above does not measure them. A zero over an unobserved class is an absence of data, ' +
    'not a result.'
  );
}

/** The table of the slices the metric flagged, so the count has a referent. */
function flaggedSlices(nearMiss: NearMissReport): string {
  const lines: string[] = [];
  lines.push('### Flagged slices');
  lines.push('');
  if (nearMiss.records.length === 0) {
    lines.push('_No slice passed with a required check still unsatisfied._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| slice | reasons | unsatisfied checks |');
  lines.push('|---|---|---|');
  for (const record of nearMiss.records) {
    const checks = record.unsatisfiedKeys.length === 0 ? '—' : record.unsatisfiedKeys.join(', ');
    lines.push(`| ${record.sliceRid} | ${record.reasons.join(', ')} | ${checks} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * The markdown for the near-miss section, including its heading.
 *
 * The section is rendered ONLY when the caller supplies the measurement, so a
 * caller that does not compute it gets exactly the report it got before.
 */
export function markdownNearMissSection(nearMiss: NearMissReport): string {
  const lines: string[] = [];
  lines.push('## Near-misses');
  lines.push('');
  lines.push(rateLine(nearMiss));
  lines.push(denominatorLine(nearMiss));
  lines.push(statusLine(nearMiss));
  lines.push(...undeterminedLines(nearMiss));
  if (nearMiss.denominator.difference !== null) {
    lines.push('');
    lines.push(nearMiss.denominator.difference.note);
  }
  lines.push('');
  lines.push(coverageTable(nearMiss.coverage));
  lines.push(unobservedLine(nearMiss));
  lines.push('');
  lines.push(flaggedSlices(nearMiss));
  return lines.join('\n');
}
