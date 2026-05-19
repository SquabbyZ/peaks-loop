import { describe, expect, test } from 'vitest';
import { parseFrontmatter } from '../../src/shared/frontmatter.js';

describe('parseFrontmatter', () => {
  test('parses required name and description fields', () => {
    const frontmatter = parseFrontmatter(`---\nname: demo\ndescription: Demo skill\n---\n# Demo\n`);

    expect(frontmatter).toEqual({ name: 'demo', description: 'Demo skill' });
  });

  test('parses block descriptions', () => {
    const frontmatter = parseFrontmatter(`---\nname: demo\ndescription: |\n  First line\n  Second line\n---\n# Demo\n`);

    expect(frontmatter.description).toBe('First line\nSecond line');
  });

  test('throws when required fields are missing', () => {
    expect(() => parseFrontmatter(`---\nname: demo\n---\n# Demo\n`)).toThrow('Missing required frontmatter field: description');
  });

  test('throws when opening marker is missing', () => {
    expect(() => parseFrontmatter('name: demo')).toThrow('Missing YAML frontmatter opening marker');
  });

  test('throws when closing marker is missing', () => {
    expect(() => parseFrontmatter(`---\nname: demo\ndescription: Demo`)).toThrow('Missing YAML frontmatter closing marker');
  });

  test('throws when a frontmatter line is invalid', () => {
    expect(() => parseFrontmatter(`---\nname: demo\ndescription: Demo\ninvalid-line\n---\n`)).toThrow('Invalid frontmatter line');
  });

  test('parses block scalar description', () => {
    const frontmatter = parseFrontmatter(`---\nname: demo\ndescription: |\n  First line\n  Second line\n---\n# Demo\n`);

    expect(frontmatter.description).toBe('First line\nSecond line');
  });

  test('skips empty frontmatter lines', () => {
    const frontmatter = parseFrontmatter(`---\nname: demo\ndescription: Demo\n\n  \n---\n# Demo\n`);

    expect(frontmatter.description).toBe('Demo');
  });

  test('throws when name is missing', () => {
    expect(() => parseFrontmatter(`---\ndescription: Demo\n---\n# Demo\n`)).toThrow('Missing required frontmatter field: name');
  });
});
