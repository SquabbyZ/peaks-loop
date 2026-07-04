import { Adapter } from "./adapter.js";

type Detectable = Pick<Adapter, "name" | "detect">;

export class AutoAdapter {
  constructor(
    private readonly _o: { home: string },
    private readonly _adapters: Detectable[],
  ) {}
  async detectAndPick(): Promise<Detectable> {
    for (const a of this._adapters) {
      if (await a.detect()) return a;
    }
    throw new Error("No adapter detected. Use `peaks skill adapter set-active <name>` to force one.");
  }
}