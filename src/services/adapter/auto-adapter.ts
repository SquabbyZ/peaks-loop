/**
 * ⚠ DEAD CODE — zero importers in `src/`, `tests/`, `packages/`, `scripts/`.
 * See the block comment on `src/services/adapter/adapter.ts`.
 *
 * `detectAndPick()` picks the first adapter whose `detect()` returns true.
 * It cannot pick anything today: its only candidate implementations are its
 * three dead siblings, and the codex/copilot pair hardcode `detect()` to
 * `false` while the claude one hardcodes `true` — so the "pick" is a
 * constant that never varies with the environment. It is not wired to
 * `peaks skill adapter set-active` either; that CLI verb
 * (`src/cli/commands/adapter-commands.ts`) echoes back the name it was given
 * and reads no adapter file.
 */
import type { Adapter } from './adapter.js';

type Detectable = Pick<Adapter, 'name' | 'detect'>;

export class AutoAdapter {
  constructor(
    private readonly _o: { home: string },
    private readonly _adapters: Detectable[]
  ) {}
  async detectAndPick(): Promise<Detectable> {
    for (const a of this._adapters) {
      if (await a.detect()) return a;
    }
    throw new Error(
      'No adapter detected. Use `peaks skill adapter set-active <name>` to force one.'
    );
  }
}
