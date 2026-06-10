/**
 * SID naming guard. Enforces the "two-axis" convention from spec §0:
 * session id: YYYY-MM-DD-session-<3-6 chars lowercase alnum>
 * change id: kebab-case
 *
 * Spec §8.7 — bare forms (sid-3 / sid-h / sid-r / unknown-sid) are
 * migrated to `_archive/invalid-sids/`, NOT tolerated.
 */

export const SID_FORMAT_DESCRIPTION =
 '<YYYY-MM-DD>-session-<3-6 chars lowercase alnum>, e.g. 2026-06-11-session-abc123';

const VALID_SID_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-session-[0-9a-z]{3,6}$/;
const BARE_SID_REGEX = /^(sid-[a-z0-9]+|unknown-sid)$/;
const VALID_CHANGE_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSessionId(sid: string): boolean {
 return VALID_SID_REGEX.test(sid);
}

export function isValidChangeId(cid: string): boolean {
 return VALID_CHANGE_ID_REGEX.test(cid);
}

export function isBareSid(name: string): boolean {
 return BARE_SID_REGEX.test(name);
}

export function assertValidSessionId(sid: string): void {
 if (!isValidSessionId(sid)) {
 throw new Error(
 `NAMING_INVALID: session id "${sid}" does not match required format ${SID_FORMAT_DESCRIPTION}`
 );
 }
}

export function assertValidChangeId(cid: string): void {
 if (!isValidChangeId(cid)) {
 throw new Error(
 `NAMING_INVALID: change id "${cid}" must be kebab-case (lowercase alnum and dashes only)`
 );
 }
}
