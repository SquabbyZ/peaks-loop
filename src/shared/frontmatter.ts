export type SkillFrontmatter = {
  name: string;
  description: string;
  [key: string]: string;
};

export function parseFrontmatter(markdown: string): SkillFrontmatter {
  const lines = markdown.split(/\r?\n/);

  if (lines[0] !== '---') {
    throw new Error('Missing YAML frontmatter opening marker');
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (endIndex === -1) {
    throw new Error('Missing YAML frontmatter closing marker');
  }

  const metadata: Record<string, string> = {};
  const frontmatterLines = lines.slice(1, endIndex);

  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index];
    if (!line || line.trim().length === 0) {
      continue;
    }

    const blockMatch = line.match(/^([A-Za-z0-9_-]+):\s*[|>]\s*$/);
    if (blockMatch?.[1]) {
      const key = blockMatch[1];
      const blockLines: string[] = [];
      index += 1;
      while (index < frontmatterLines.length) {
        const blockLine = frontmatterLines[index];
        if (blockLine && /^\S[^:]*:/.test(blockLine)) {
          index -= 1;
          break;
        }
        blockLines.push(blockLine?.replace(/^\s{2}/, '') ?? '');
        index += 1;
      }
      metadata[key] = blockLines.join('\n').trim();
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match?.[1]) {
      throw new Error(`Invalid frontmatter line: ${line}`);
    }

    metadata[match[1]] = (match[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
  }

  if (!metadata.name) {
    throw new Error('Missing required frontmatter field: name');
  }

  if (!metadata.description) {
    throw new Error('Missing required frontmatter field: description');
  }

  return metadata as SkillFrontmatter;
}
