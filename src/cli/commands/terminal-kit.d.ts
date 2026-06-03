// Ambient module declaration for `terminal-kit` (which ships no
// own .d.ts and is not on @types/terminal-kit). The shape we
// use is the minimal slice the watch loop needs: a Term-like
// object with `fullscreen`, `eraseLine`, `moveTo`, `column`,
// and `style.color` / `style.bg`. Anything beyond this slice is
// not imported here.
//
// If we ever need more of terminal-kit, extend this declaration
// rather than casting to `any` (the project's coding-style
// guide disallows `any` in application code).

declare module 'terminal-kit' {
  interface TermStyle {
    color(name: string): string;
    bg(name: string): string;
  }

  interface TermLike {
    fullscreen(on: boolean): void;
    eraseLine(): void;
    moveTo(column: number, row: number): void;
    column(n: number): string;
    style: TermStyle;
  }

  const termkit: { terminal: TermLike };
  // terminal-kit uses CommonJS `module.exports = ...`; the
  // canonical ambient-module shape for that is `export = ...`
  // with the receiver typed as a single object.
  export = termkit;
}
