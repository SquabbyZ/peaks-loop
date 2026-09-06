/**
 * Slice 2026-09-06-ui-lib-dispatch-priority: render a `## Project stack`
 * markdown block for the RD/UI sub-agent dispatch system prompt, and the
 * dispatch-site convenience wrapper that computes it from a project root.
 *
 * Kept in its own small module so the block rendering does NOT grow
 * `project-standards-service.ts` past the 800-line cap (the slice only
 * surfaces the existing standards rule in a second surface — it does not
 * add to the standards service itself).
 */
import {
  buildToolLabel,
  componentLibraryLabel,
  cssFrameworkLabel,
  detectProjectContext,
  type ProjectContext,
} from './project-context.js';
import { renderUiLibraryPriorityRule } from './project-standards-service.js';

/**
 * Render the block. The library-first directive reuses
 * `renderUiLibraryPriorityRule` (the single source of truth for that prose —
 * no second copy to drift). Returns `null` when the project has no detected
 * component library (or a library the rule does not cover), so the dispatch
 * prompt degrades byte-identically to the legacy shape (no empty or dangling
 * "Project stack" heading).
 */
export function renderUiLibraryPriorityDispatchBlock(ctx: ProjectContext): string | null {
  const rule = renderUiLibraryPriorityRule(ctx);
  if (rule === null) return null;
  const lines: string[] = ['## Project stack', ''];
  lines.push(`- Component library: ${componentLibraryLabel(ctx.componentLibrary)}`);
  lines.push(`- Build tool: ${buildToolLabel(ctx.buildTool)}`);
  if (ctx.cssFrameworks.length > 0) {
    lines.push(`- CSS: ${ctx.cssFrameworks.map(cssFrameworkLabel).join(', ')}`);
  }
  lines.push('');
  lines.push(rule);
  return lines.join('\n');
}

/**
 * Dispatch-site convenience wrapper: detect the project context and render
 * the block. Fail-soft — any detection error degrades to `null` (no block)
 * so a bad package.json or unreadable source sample never hard-blocks the
 * dispatch.
 */
export function computeUiLibraryDispatchBlock(projectRoot: string): string | null {
  try {
    return renderUiLibraryPriorityDispatchBlock(detectProjectContext(projectRoot));
  } catch {
    return null;
  }
}
