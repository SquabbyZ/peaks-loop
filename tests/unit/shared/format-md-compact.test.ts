import { describe, expect, test } from 'vitest';
import { formatMdCompact } from '../../../src/shared/format-md-compact.js';

describe('formatMdCompact', () => {
  test('collapses 3+ blank lines into 1 (TC-UNIT-COMPACT-1)', () => {
    const input = 'Paragraph A.\n\n\n\nParagraph B.';
    expect(formatMdCompact(input)).toBe('Paragraph A.\n\nParagraph B.');
  });

  test('strips trailing whitespace per line (TC-UNIT-COMPACT-2)', () => {
    const input = '# Title   \nBody line\t  \nMore body   \n';
    expect(formatMdCompact(input)).toBe('# Title\nBody line\nMore body\n');
  });

  test('strips decorative --- surrounded by blank lines (TC-UNIT-COMPACT-3)', () => {
    const input = 'Intro paragraph.\n\n---\n\nNext section.';
    expect(formatMdCompact(input)).toBe('Intro paragraph.\n\nNext section.');
  });

  test('strips decorative --- at the very end of the file (TC-UNIT-COMPACT-3 variant)', () => {
    const input = 'Heading\n\n---\n';
    expect(formatMdCompact(input)).toBe('Heading\n');
  });

  test('preserves --- as setext H2 underline when it sits under a heading (TC-UNIT-COMPACT-3 negative)', () => {
    const input = 'Heading\n---\n';
    expect(formatMdCompact(input)).toBe('Heading\n---\n');
  });

  test('strips frontmatter description repeat (TC-UNIT-COMPACT-4)', () => {
    const input = [
      '---',
      'title: foo',
      'description: My Title',
      '---',
      '',
      '# My Title',
      '',
      'Body.'
    ].join('\n');
    const result = formatMdCompact(input);
    // The frontmatter stays verbatim; the body's `# My Title` heading is
    // removed (and the leading description paragraph if present).
    expect(result.startsWith('---\ntitle: foo\ndescription: My Title\n---')).toBe(true);
    expect(result).not.toContain('# My Title');
    expect(result).toContain('Body.');
  });

  test('preserves frontmatter verbatim when description is not repeated in the body (TC-UNIT-COMPACT-4 variant)', () => {
    const input = [
      '---',
      'description: foo',
      '---',
      '',
      '# Title',
      '',
      'Body content.'
    ].join('\n');
    const result = formatMdCompact(input);
    expect(result).toContain('description: foo');
    expect(result).toContain('# Title');
    expect(result).toContain('Body content.');
  });

  test('preserves content inside ``` code fences (TC-UNIT-COMPACT-5)', () => {
    const input = [
      'Intro.',
      '',
      '```ts',
      'function foo() {',
      '    return 42;',
      '}',
      '```',
      '',
      'Outro.'
    ].join('\n');
    const result = formatMdCompact(input);
    // The fence content must remain byte-identical, including leading
    // whitespace inside the code block.
    expect(result).toContain('    return 42;');
    // The fence markers survive.
    expect(result).toContain('```ts');
    expect(result).toContain('```');
  });

  test('preserves setext === underline (TC-UNIT-COMPACT-6)', () => {
    const input = 'Big Title\n=========\n\nBody.';
    expect(formatMdCompact(input)).toBe('Big Title\n=========\n\nBody.');
  });

  test('preserves setext --- underline (TC-UNIT-COMPACT-6 variant)', () => {
    const input = 'Big Title\n---------\n\nBody.';
    expect(formatMdCompact(input)).toBe('Big Title\n---------\n\nBody.');
  });

  test('preserves GFM table syntax (TC-UNIT-COMPACT-7)', () => {
    const input = '| Col A | Col B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    expect(formatMdCompact(input)).toBe(input);
  });

  test('preserves list indentation by default (TC-UNIT-COMPACT-8 default)', () => {
    const input = '  - item one\n  - item two\n\n\n  - item three\n';
    const result = formatMdCompact(input);
    // Multi-blank collapsed, but leading 2-space indent preserved.
    expect(result).toBe('  - item one\n  - item two\n\n  - item three\n');
  });

  test('empty input is a no-op (TC-UNIT-COMPACT-9)', () => {
    expect(formatMdCompact('')).toBe('');
  });

  test('already-compact input is byte-identical (TC-UNIT-COMPACT-10)', () => {
    const input = '# Title\n\nBody line.\n\nAnother line.\n';
    expect(formatMdCompact(input)).toBe(input);
  });

  test('decorative --- between two non-blank lines is preserved (setext H2)', () => {
    const input = 'Heading\n---\nMore text';
    expect(formatMdCompact(input)).toBe('Heading\n---\nMore text');
  });

  test('multi --- runs are all stripped when surrounded by blanks', () => {
    const input = 'A\n\n---\n\n---\n\nB';
    expect(formatMdCompact(input)).toBe('A\n\nB');
  });
});
