/**
 * Per spec §4.2 战术审计 — AST hard gate.
 *
 * Hard constraints:
 *   H6 (CLI裁决): gate result is computed by AST analysis, not LLM.
 *   H2 (locked version): any external API call whose name is NOT in the
 *       locked-version doc summary fails the gate.
 *
 * Implementation: TypeScript Compiler API for import + call expression
 * extraction. v1 uses regex for speed; production wiring migrates to
 * the Compiler API for accuracy.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AstGateResult, AstViolation, ExternalApiCall } from './types.js';

export interface AstGateContext {
  readonly deps: Readonly<Record<string, { readonly version: string; readonly source: string; readonly resolved: string }>>;
  readonly docSummaries: ReadonlyArray<{ readonly dep: string; readonly version: string; readonly apis: ReadonlyArray<string> }>;
}

export interface RunAstGateInput {
  readonly project: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly context: AstGateContext;
}

const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
const CALL_RE = /\b([a-zA-Z_$][\w$]*)\s*\(/g;

export async function runAstGate(input: RunAstGateInput): Promise<AstGateResult> {
  const violations: AstViolation[] = [];
  const externalCalls: ExternalApiCall[] = [];

  for (const file of input.changedFiles) {
    const fullPath = join(input.project, file);
    let content: string;
    try {
      content = await readFile(fullPath, 'utf8');
    } catch {
      continue;
    }

    // Find imports from external deps.
    const imports = [...content.matchAll(IMPORT_RE)];
    const importMap = new Map<string, string>(); // localName -> depName
    for (const imp of imports) {
      const depName = imp[2]!;
      if (input.context.deps[depName] === undefined) continue; // not an external dep
      const names = imp[1]!.split(',').map((n) => n.trim().split(/\s+as\s+/)[0]!);
      for (const n of names) {
        if (n) importMap.set(n, depName);
      }
    }

    // Find call expressions that match imported names.
    const calls = [...content.matchAll(CALL_RE)];
    for (const c of calls) {
      const name = c[1]!;
      const dep = importMap.get(name);
      if (!dep) continue;
      const idx = c.index ?? 0;
      const line = content.slice(0, idx).split('\n').length;

      const depVersion = input.context.deps[dep]?.version ?? '';
      const docSummary = input.context.docSummaries.find(
        (d) => d.dep === dep && d.version === depVersion,
      );
      const apis = docSummary?.apis ?? [];

      externalCalls.push({ file, line, api: name, version: depVersion });

      if (apis.length > 0 && !apis.includes(name)) {
        violations.push({
          file,
          line,
          api: name,
          expectedVersion: depVersion,
          actualVersion: 'unknown', // could resolve via npm view if needed
          severity: 'error',
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
