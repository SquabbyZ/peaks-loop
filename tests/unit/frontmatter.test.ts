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

  test('flattens nested metadata keys (v2.12.0 skill-versioning contract)', () => {
    const frontmatter = parseFrontmatter(`---\nname: demo\ndescription: Demo skill\nmetadata:\n  appliesTo: peaks-cli v2.12.0+\n  replaces: peaks-rd security-reviewer slot\n---\n# Demo\n`);

    expect(frontmatter['metadata.appliesTo']).toBe('peaks-cli v2.12.0+');
    expect(frontmatter['metadata.replaces']).toBe('peaks-rd security-reviewer slot');
  });

  test('flattens metadata lists (sources, deps) as comma-joined strings', () => {
    const frontmatter = parseFrontmatter(`---\nname: demo\ndescription: Demo skill\nmetadata:\n  sources:\n    - handoff: foo\n    - template: bar\n---\n# Demo\n`);

    expect(frontmatter['metadata.sources']).toBe('handoff: foo, template: bar');
  });

  test('still rejects genuinely malformed lines after flattening', () => {
    expect(() => parseFrontmatter(`---\nname: demo\ndescription: Demo\nno-colon-here\n---\n`)).toThrow('Invalid frontmatter line');
  });
});
