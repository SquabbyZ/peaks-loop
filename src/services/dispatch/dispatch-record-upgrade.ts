import type { DispatchRecord } from './dispatch-record-types.js';
import { buildUpgradedRecord } from './dispatch-record-upgrade-fields.js';
import { isObject } from './dispatch-record-upgrade-guards.js';

export { isDispatchStatus, isOutcome } from './dispatch-record-upgrade-guards.js';

export function upgradeRecord(parsed: unknown): DispatchRecord {
  if (!isObject(parsed)) {
    throw new Error('Dispatch record root must be an object');
  }
  const obj = parsed;
  // Slice 4.0.8: 3.2 → 4.0.0 schema bump. Phase A Task 8: 4.0.0 → 4.1.0
  // (additive). The literal type narrows to '4.1.0' but legacy v4.0.0 /
  // v3.2 / v3.1 / 3 / 2 / 1 records are accepted transparently and
  // upgraded on read.
  const rawVersion = obj.version;
  if (
    rawVersion !== '4.1.0' &&
    rawVersion !== '4.0.0' &&
    rawVersion !== '3.2' &&
    rawVersion !== '3.1' &&
    rawVersion !== 3 &&
    rawVersion !== 2 &&
    rawVersion !== 1
  ) {
    throw new Error(
      `Dispatch record version mismatch: expected '4.1.0', '4.0.0', '3.2', '3.1', 3, 2, or 1, got ${JSON.stringify(rawVersion)}. ` +
        'The v1 → v4.1.0 migration is in-file; records from much older or newer builds must be regenerated.'
    );
  }

  return buildUpgradedRecord(obj, readUpgradeRecordVendorField(obj));
}

/**
 * Parse the 4.1.0 `vendor` migration field. It stays in this module —
 * NOT in `dispatch-record-upgrade-fields.ts` — because the vendor-neutral
 * identity guard (`tests/unit/runtime/vendor-neutral-identity-guard.test.ts`)
 * pins the `vendor === 'codex'` comparison here by file path; moving the
 * comparison would move a pinned census entry. Pure read; the original
 * block defaulted anything else to `null`, exactly as here.
 */
function readUpgradeRecordVendorField(obj: Record<string, unknown>): DispatchRecord['vendor'] {
  return obj.vendor === 'claude' || obj.vendor === 'codex' || obj.vendor === 'copilot'
    ? obj.vendor
    : null;
}
