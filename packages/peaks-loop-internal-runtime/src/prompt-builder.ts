const FORBIDDEN = '@@@ORCHESTRATOR_SESSION_HISTORY_BOUNDARY@@@';

export interface AssembleInput {
  rid: string;
  role: 'rd' | 'qa' | 'ui' | 'txt' | 'general-purpose';
  vendor: string;
  files: string[];
  refs: string[];
  userTask: string;
  verbatimBlocks?: string[];
}

export class PromptBuilder {
  assemble(i: AssembleInput): string {
    if (i.userTask.includes(FORBIDDEN)) throw new Error('forbidden marker in user task');
    const parts = [
      `rid: ${i.rid}`,
      `role: ${i.role}`,
      `vendor: ${i.vendor}`,
      ``,
      `## Task`,
      i.userTask,
      ``,
      `## Files (read-only)`,
      ...i.files.map(f => `- ${f}`),
      ``,
      `## References`,
      ...i.refs.map(r => `- ${r}`),
      ``,
      ...(i.verbatimBlocks ?? []),
    ];
    const out = parts.join('\n');
    if (out.includes(FORBIDDEN)) throw new Error('forbidden marker leak');
    return out;
  }
}