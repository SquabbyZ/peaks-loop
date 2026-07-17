/**
 * Frontmatter parser — copy of `src/shared/frontmatter.ts` from main peaks-loop.
 *
 * Duplicated into peaks-loop-mut to keep this package zero-dependency on the
 * main package (avoids circular workspace deps). The two files MUST stay in
 * sync. If `src/shared/frontmatter.ts` changes upstream, mirror the change
 * here. See `.peaks/_runtime/2026-07-17-session-1d5ac0/rd/slice-2-mut.md` §3.5
 * for the duplication rationale (frontmatter is a 176-LOC pure function with
 * no transitive deps; lift-into-shared-package is a future slice).
 */

export type SkillFrontmatter = {
  name: string;
  description: string;
  [key: string]: string;
};

const KEY_PATTERN = /^([A-Za-z0-9_.-]+):\s*(.*)$/;

/**
 * Flatten a nested YAML mapping (max 2 levels deep) into dotted keys.
 * `metadata:\n  appliesTo: v2.12.0+` → `metadata.appliesTo: v2.12.0+`.
 * `metadata:\n  sources:\n    - foo\n    - bar` →
 *   `metadata.sources: foo, bar`.
 *
 * Skills only use this shape for the `metadata:` block (v2.12.0
 * skill-versioning contract); deeper nesting is not currently emitted.
 */
function flattenNestedFrontmatter(frontmatterLines: string[]): string[] {
  const flat: string[] = [];
  let i = 0;
  while (i < frontmatterLines.length) {
    const line = frontmatterLines[i];
    if (line === undefined) {
      i += 1;
      continue;
    }
    if (line.trim().length === 0) {
      flat.push(line);
      i += 1;
      continue;
    }
    const parentMatch = /^([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (!parentMatch || parentMatch[1] === undefined) {
      flat.push(line);
      i += 1;
      continue;
    }
    const parent = parentMatch[1];
    // Collect children (2nd-level keys OR list items OR a 2nd-level parent key).
    const children: Array<{ key: string; listItems: string[]; grandChildren: string[] }> = [];
    let listItemsAtParent: string[] = [];
    let grandTotalConsumed = 0;
    let j = i + 1;
    while (j < frontmatterLines.length) {
      const childLine = frontmatterLines[j];
      if (childLine === undefined || childLine.trim().length === 0) break;
      // 2nd-level parent key (e.g. "  sources:") — recurse one level.
      const subParentMatch = /^\s{2,}([A-Za-z0-9_-]+):\s*$/.exec(childLine);
      if (subParentMatch && subParentMatch[1] !== undefined) {
        const subParent = subParentMatch[1];
        const subList: string[] = [];
        let k = j + 1;
        let subConsumed = 0;
        while (k < frontmatterLines.length) {
          const gcLine = frontmatterLines[k];
          if (gcLine === undefined || gcLine.trim().length === 0) break;
          const li = /^\s+-\s+(.+)$/.exec(gcLine);
          if (li && li[1] !== undefined) {
            subList.push(li[1].trim());
            subConsumed += 1;
            k += 1;
            continue;
          }
          break;
        }
        if (subList.length > 0) {
          children.push({ key: subParent, listItems: subList, grandChildren: [] });
        } else {
          // Empty sub-parent; preserve as bare key (no value).
          children.push({ key: subParent, listItems: [], grandChildren: [] });
        }
        grandTotalConsumed += subConsumed + 1;
        j = k;
        continue;
      }
      // Direct list item under parent (no nested key).
      const directList = /^\s+-\s+(.+)$/.exec(childLine);
      if (directList && directList[1] !== undefined) {
        listItemsAtParent.push(directList[1].trim());
        grandTotalConsumed += 1;
        j += 1;
        continue;
      }
      // 2nd-level scalar key.
      const scalarMatch = /^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/.exec(childLine);
      if (scalarMatch && scalarMatch[1] !== undefined) {
        children.push({
          key: scalarMatch[1],
          listItems: [],
          grandChildren: [`${parent}.${scalarMatch[1]}: ${scalarMatch[2] ?? ''}`.trimEnd()]
        });
        grandTotalConsumed += 1;
        j += 1;
        continue;
      }
      break;
    }
    if (listItemsAtParent.length > 0) {
      flat.push(`${parent}: ${listItemsAtParent.join(', ')}`);
    } else if (children.length > 0) {
      for (const child of children) {
        if (child.listItems.length > 0) {
          flat.push(`${parent}.${child.key}: ${child.listItems.join(', ')}`);
        } else if (child.grandChildren.length > 0) {
          for (const gc of child.grandChildren) flat.push(gc);
        } else {
          flat.push(`${parent}.${child.key}:`);
        }
      }
    } else {
      flat.push(line);
    }
    i += grandTotalConsumed + 1;
  }
  return flat;
}

export function parseFrontmatter(markdown: string): SkillFrontmatter {
  const lines = markdown.split(/\r?\n/);

  if (lines[0] !== '---') {
    throw new Error('Missing YAML frontmatter opening marker');
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (endIndex === -1) {
    throw new Error('Missing YAML frontmatter closing marker');
  }

  const rawLines = lines.slice(1, endIndex);
  const frontmatterLines = flattenNestedFrontmatter(rawLines);

  const metadata: Record<string, string> = {};

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

    const match = line.match(KEY_PATTERN);
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
