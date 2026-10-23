// src/cli/commands/core/skill-store-report.ts
//
// The one line that says what the canonical store holds.
//
// WHY IT IS ITS OWN MODULE. The report is a rendering of a list of records, and the
// records come from the installer while the words come from the command. Keeping the
// two apart lets the wording be pinned by its own tests, without a fake sync service
// in the way.
//
// WHICH READING IT REPORTS. The rows are the store AS THE RUN FOUND IT, and the line
// says so: `state as found`. That is the reading a repair needs — "2 stale" names
// what was behind before the run fixed it, and a report that said "0 stale" after the
// repair would hide the very thing the run did. The rows that were repaired say so
// next to their names, so the two readings never blur: the count is what was found,
// the annotation is what this run did about it.
//
// THE COUNTS COVER EVERY ROW. A row the report does not count is a row a reader
// cannot account for, so the five states are counted separately and the absent ones
// are counted too: an entry the store does not hold is not a current entry, and
// counting it as one is how a report ends up describing a store that is empty.
import type {
  StoreEntryReport,
  StoreEntryState
} from '../../../services/skills/sync-service-support.js';

/** The states, in the order the counts are printed. */
const STATE_ORDER: readonly StoreEntryState[] = [
  'current',
  'stale',
  'unmanaged',
  'retired',
  'absent'
];

/** The rows in one state. */
function rowsIn(entries: readonly StoreEntryReport[], state: StoreEntryState): StoreEntryReport[] {
  return entries.filter((entry) => entry.state === state);
}

/**
 * What this run did about a group of rows, in words.
 *
 * The suffix is per STATE as well as per action: an absent entry that was installed
 * is not an entry that was repaired.
 */
function actionSuffix(state: StoreEntryState, action: string | undefined): string {
  if (action === 'installed') {
    return state === 'absent' ? 'installed by this run' : 'repaired by this run';
  }
  if (action === 'planned') {
    if (state === 'absent') return 'would be installed';
    if (state === 'retired') return 'would be removed';
    return 'would be repaired';
  }
  if (action === 'pruned') return 'removed by this run';
  return '';
}

/**
 * The names of a group, with what the run did about it.
 */
function describeGroup(
  entries: readonly StoreEntryReport[],
  state: StoreEntryState,
  label: string
): string | null {
  const rows = rowsIn(entries, state);
  if (rows.length === 0) return null;
  const names = rows.map((entry) => entry.name).join(', ');
  const suffix = actionSuffix(state, rows[0]?.action);
  return `${label}: ${names}${suffix.length > 0 ? ` (${suffix})` : ''}`;
}

/**
 * The absent group, as a count.
 *
 * The names are not listed: on a machine that has never run the install this group
 * holds every skill the package ships, and a line with a hundred names in it is a
 * line nobody reads. What the group MEANT is what the count carries — that many
 * skills were not in the store, and what this run did about them.
 */
function describeAbsent(entries: readonly StoreEntryReport[]): string | null {
  const rows = rowsIn(entries, 'absent');
  if (rows.length === 0) return null;
  const suffix = actionSuffix('absent', rows[0]?.action);
  const label = suffix.length > 0 ? suffix : 'not in the store';
  return `${label}: ${rows.length} skill${rows.length === 1 ? '' : 's'}`;
}

/**
 * The store report line, or null when the installer reported no rows at all.
 *
 * @param entries the rows the installer reported, or undefined when it reported none
 * @param dryRun whether this run wrote nothing
 */
export function renderStoreReport(
  entries: readonly StoreEntryReport[] | undefined,
  dryRun: boolean
): string | null {
  if (entries === undefined) return null;

  const counts = STATE_ORDER.map((state) => `${rowsIn(entries, state).length} ${state}`).join(', ');
  const detail = [
    describeGroup(entries, 'stale', 'stale'),
    describeGroup(entries, 'retired', 'retired (this release does not ship them)'),
    describeGroup(entries, 'unmanaged', "left alone (not peaks-loop's to replace)"),
    describeAbsent(entries)
  ].filter((line): line is string => line !== null);
  const reading = dryRun ? 'state as found; dry run: nothing written' : 'state as found';
  return `skill store: ${counts} (${reading})${detail.length > 0 ? ` — ${detail.join('; ')}` : ''}`;
}
