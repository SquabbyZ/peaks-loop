/**
 * The field vocabulary both directions of the entry format share: the magic
 * line, the markers for an absent or repeated field, the per-field patterns,
 * and the reader that splits a line without breaking quoted text.
 */

export const MAGIC = 'lg 1';
export const ABSENT = '-';
export const SAME_TEXT = '~';
export const SIDE_COUNT = 4;

export const ID_PATTERN = /^[0-9a-f]{12}(-\d+)?$/;
export const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;
export const ROLE_PATTERN = /^[a-z][a-z-]*$/;
export const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;
export const PX_PATTERN = /^\d+(?:\.\d+)?px$/;
export const DIGEST_PATTERN = /^[0-9a-f]{16}$/;

export function singleToken(value: string): boolean {
  return value !== '' && !/\s/.test(value);
}

/** Split a line into fields; a JSON string is one field even when it holds spaces. */
export function splitFields(line: string): string[] {
  const fields: string[] = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] === '"') {
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === '\\') end += 2;
        else if (line[end] === '"') break;
        else end += 1;
      }
      const stop = Math.min(end + 1, line.length);
      fields.push(line.slice(index, stop));
      index = stop + 1;
      continue;
    }
    const space = line.indexOf(' ', index);
    if (space === -1) {
      fields.push(line.slice(index));
      break;
    }
    fields.push(line.slice(index, space));
    index = space + 1;
  }
  return fields;
}

const UNREADABLE = Symbol('unreadable');

function parseJson(field: string): unknown {
  try {
    return JSON.parse(field) as unknown;
  } catch {
    return UNREADABLE;
  }
}

export function decodeText(field: string, ownText: string): string | null {
  if (field === ABSENT) return '';
  if (field === SAME_TEXT) return ownText;
  const parsed = parseJson(field);
  return typeof parsed === 'string' ? parsed : null;
}

export function numbersOf(field: string, integer: boolean): number[] | null {
  const parts = field.split(',');
  if (parts.length !== SIDE_COUNT) return null;
  const values = parts.map((part) => (NUMBER_PATTERN.test(part) ? Number(part) : Number.NaN));
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (integer && values.some((value) => !Number.isInteger(value))) return null;
  return values;
}
