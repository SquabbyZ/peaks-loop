import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickFromList, type FzfPickOptions } from '../../../src/services/fuzzy-matching/fzf-pick-service.js';

// Mock child_process so tests don't actually spawn fzf
const mockExec = vi.fn();
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => mockExec(...args)
  };
});

interface Item {
  id: string;
  name: string;
}

const formatLine = (item: Item): string => `${item.id} | ${item.name}`;
const parseLine = (line: string): Item | null => {
  const parts = line.split('|').map((p) => p.trim());
  if (parts.length < 2) return null;
  const id = parts[0];
  const name = parts[1];
  if (!id || !name) return null;
  return { id, name };
};

const ITEMS: Item[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' }
];

function makeOptions(overrides: Partial<FzfPickOptions<Item>> = {}): FzfPickOptions<Item> {
  return {
    items: ITEMS,
    formatLine,
    parseLine,
    outputPath: '', // overridden per-test
    meta: { rid: 'test-rid' },
    projectRoot: '',
    ...overrides
  };
}

describe('fzf-pick-service', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'peaks-fzf-pick-test-'));
    mockExec.mockReset();
  });

  it('throws with one-line install hint when fzf is missing', async () => {
    mockExec.mockImplementation(() => {
      const err = new Error('fzf: command not found') as Error & { code?: string };
      err.code = 'ENOENT';
      throw err;
    });
    const outPath = join(workDir, 'picked.json');
    await expect(pickFromList(makeOptions({ outputPath: outPath }))).rejects.toThrow(/brew install fzf|apt-get install fzf/);
  });

  it('throws when fzf version is < 0.38', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') {
        return '0.32\n';
      }
      return '';
    });
    const outPath = join(workDir, 'picked.json');
    await expect(pickFromList(makeOptions({ outputPath: outPath }))).rejects.toThrow(/older than required 0\.38/);
  });

  it('picks a single item when fzf returns one line', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      return 'a | Alpha\n';
    });
    const outPath = join(workDir, 'picked.json');
    const result = await pickFromList(makeOptions({ outputPath: outPath }));
    expect(result.picked).toHaveLength(1);
    expect(result.picked[0]).toEqual({ id: 'a', name: 'Alpha' });
  });

  it('picks multiple items when fzf returns multiple lines', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      return ['a | Alpha', 'c | Gamma', ''].join('\n');
    });
    const outPath = join(workDir, 'picked.json');
    const result = await pickFromList(makeOptions({ outputPath: outPath }));
    expect(result.picked).toHaveLength(2);
    expect(result.picked.map((i) => i.id).sort()).toEqual(['a', 'c']);
  });

  it('returns empty picked when fzf exits 130 (Esc)', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      const err = new Error('interrupted') as Error & { status?: number };
      err.status = 130;
      throw err;
    });
    const outPath = join(workDir, 'picked.json');
    const result = await pickFromList(makeOptions({ outputPath: outPath }));
    expect(result.picked).toHaveLength(0);
  });

  it('drops lines that parseLine rejects', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      return 'malformed line\na | Alpha\nb | Beta\n'.split('\n').join('\n');
    });
    const outPath = join(workDir, 'picked.json');
    const result = await pickFromList(makeOptions({ outputPath: outPath }));
    // `malformed line` has only 1 `|`-field, parseLine rejects it.
    expect(result.picked.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('dedupes identical lines (parseLine returns same id)', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      return ['a | Alpha', 'a | Alpha', 'b | Beta'].join('\n');
    });
    const outPath = join(workDir, 'picked.json');
    const result = await pickFromList(makeOptions({ outputPath: outPath }));
    expect(result.picked).toHaveLength(2);
  });

  it('writes artifact at outputPath with rid + pickedAt + fzfVersion + picked', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      return 'a | Alpha\n';
    });
    const outPath = join(workDir, 'picked.json');
    const result = await pickFromList(makeOptions({ outputPath: outPath }));
    expect(existsSync(result.outputPath)).toBe(true);
    const json = JSON.parse(readFileSync(result.outputPath, 'utf8'));
    expect(json.rid).toBe('test-rid');
    expect(json.fzfVersion).toBe('0.38');
    expect(json.picked).toHaveLength(1);
    expect(typeof json.pickedAt).toBe('string');
  });

  it('uses overrideStdin to bypass fzf spawn', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      throw new Error('should not spawn fzf in override mode');
    });
    const outPath = join(workDir, 'picked.json');
    const result = await pickFromList(makeOptions({ outputPath: outPath, overrideStdin: 'b | Beta\n' }));
    expect(result.picked).toHaveLength(1);
    expect(result.picked[0]).toEqual({ id: 'b', name: 'Beta' });
  });

  it('returns empty picked + writes artifact when items is empty', async () => {
    mockExec.mockImplementation((_cmd: unknown, args: unknown) => {
      if (Array.isArray(args) && args[0] === '--version') return '0.38\n';
      throw new Error('should not spawn fzf for empty items');
    });
    const outPath = join(workDir, 'picked.json');
    const result = await pickFromList(makeOptions({ items: [], outputPath: outPath }));
    expect(result.picked).toHaveLength(0);
    const json = JSON.parse(readFileSync(result.outputPath, 'utf8'));
    expect(json.picked).toEqual([]);
  });
});
