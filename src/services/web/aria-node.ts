/**
 *
 * Split out of `snapshot-pruner.ts` to keep the pruner under the
 * 300-raw-line file cap; it is the data model the pruner, the renderer and
 * external consumers (browser-session-manager, tests) all share. The pruner
 * re-exports this name, so importers keep using `snapshot-pruner.js`
 * unchanged.
 */
export interface AriaNode {
  readonly role: string;
  readonly name?: string;
  readonly text?: string;
  readonly children?: readonly AriaNode[];
  readonly checked?: boolean | 'mixed';
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly active?: boolean;
  readonly invalid?: boolean | 'mixed';
  readonly level?: number;
  readonly pressed?: boolean | 'mixed';
  readonly selected?: boolean;
  readonly url?: string;
  readonly placeholder?: string;
  readonly ref?: string;
  readonly cursor?: string;
}
