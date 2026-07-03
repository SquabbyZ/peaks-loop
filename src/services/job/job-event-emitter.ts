// src/services/job/job-event-emitter.ts
/**
 * Stub Job event emitter. Logs to stderr so Job lifecycle is visible during CLI runs.
 * M7.5 batch-fix task will wire to a real statusline event bus if/when the project
 * adds one. Until then, this is the only Job-event surface.
 */
export type JobEvent =
  | { kind: 'job-started'; jobId: string; total: number; strategy: 'single' | 'rotating' }
  | { kind: 'job-progress'; jobId: string; done: number; total: number; currentSlice?: string }
  | { kind: 'job-blocked'; jobId: string; sliceId: string; reason: string }
  | { kind: 'job-completed'; jobId: string; done: number; failed: number; blocked: number; skipped: number };

export function emitJobEvent(event: JobEvent): void {
  // Write to stderr so it doesn't pollute the JSON-envelope stdout that the CLI emits.
  // Prepend a tag so downstream tools can grep for it.
  process.stderr.write(`[job-event] ${JSON.stringify(event)}\n`);
}
