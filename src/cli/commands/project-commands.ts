import { Command } from 'commander';
import { loadProjectDashboard } from '../../services/dashboard/project-dashboard-service.js';
import { generateProjectContext, readProjectContext } from '../../services/memory/project-context-service.js';
import { extractSessionMemories, readMemoryIndex, readProjectMemories, readProjectMemoryBody } from '../../services/memory/project-memory-service.js';
import { readBusinessKnowledge } from '../../services/prd/project-scan-reader.js';
import { applyStalePolicy, DEFAULT_STALE_DAYS } from '../../shared/stale-policy.js';
import { formatMdCompact } from '../../shared/format-md-compact.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type ProjectDashboardOptions = {
  project: string;
  json?: boolean;
  strict?: boolean;
};

export function registerProjectCommands(program: Command, io: ProgramIO): void {
  const project = program.command('project').description('Aggregate Peaks state for a target project (read-only)');

  addJsonOption(
    project
      .command('dashboard')
      .description('One-call snapshot of doctor / MCP / OpenSpec / requests / Understand Anything / capabilities for a project')
      .requiredOption('--project <path>', 'target project root')
      .option('--strict', 'ok follows the doctor aggregate (legacy semantics). Default: workspace-only (ok tracks the runbook health)', false)
  ).action(async (options: ProjectDashboardOptions) => {
    try {
      const dashboard = await loadProjectDashboard({
        projectRoot: options.project,
        okPolicy: options.strict === true ? 'strict' : 'workspace-only'
      });
      if (!dashboard.runbookHealth.ok) {
        const suggestions = [
          dashboard.runbookHealth.missingRunbook.length > 0
            ? `Add a ## Default runbook section to: ${dashboard.runbookHealth.missingRunbook.join(', ')}`
            : null,
          dashboard.runbookHealth.applyNoteFailed.length > 0
            ? `Add authorization/--dry-run notes next to destructive --apply lines in: ${dashboard.runbookHealth.applyNoteFailed.join(', ')}`
            : null
        ].filter((line): line is string => line !== null);
        printResult(
          io,
          fail(
            'project.dashboard',
            'PROJECT_DASHBOARD_RUNBOOK_UNHEALTHY',
            `Skill runbook health failing: ${dashboard.runbookHealth.healthy}/${dashboard.runbookHealth.required} healthy`,
            dashboard,
            suggestions
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (dashboard.skillPresence.active && !dashboard.skillPresence.fresh) {
        printResult(
          io,
          fail(
            'project.dashboard',
            'PROJECT_DASHBOARD_STALE_SKILL_PRESENCE',
            `Active Peaks skill presence ${dashboard.skillPresence.skill ?? '<unknown>'} is stale (set ${dashboard.skillPresence.setAt ?? '<unknown>'})`,
            dashboard,
            ['Run `peaks skill presence:clear` if the role has ended, or `peaks skill presence:set <skill>` to refresh it']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (!dashboard.doctor.ok && options.strict === true) {
        printResult(
          io,
          fail(
            'project.dashboard',
            'PROJECT_DASHBOARD_DOCTOR_STRICT_FAIL',
            `Doctor reports ${dashboard.doctor.failed} failed check(s) (${dashboard.doctor.passed} passed) — --strict mode requires the doctor aggregate to pass`,
            dashboard,
            ['Run `peaks doctor --json` and resolve the failing checks, or drop --strict to use the workspace-only policy']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('project.dashboard', dashboard), options.json);
    } catch (error) {
      printResult(
        io,
        fail('project.dashboard', 'PROJECT_DASHBOARD_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    project
      .command('context')
      .description('Generate or read persistent project context for cross-session Peaks understanding. Generates BOTH `.peaks/PROJECT.md` (session history) AND `.peaks/project-scan/project-scan.md` (tech stack + archetypes) — see `peaks workspace init` for the full 5-template boot (G4b/AC9).')
      .requiredOption('--project <path>', 'target project root')
      .option('--read', 'read existing PROJECT.md without regenerating')
  ).action(async (options: { project: string; read?: boolean; json?: boolean }) => {
    try {
      if (options.read) {
        const content = readProjectContext(options.project);
        if (content === null) {
          printResult(io, ok('project.context', { exists: false, path: `${options.project}/.peaks/PROJECT.md` }), options.json);
          return;
        }
        printResult(io, ok('project.context', { exists: true, path: `${options.project}/.peaks/PROJECT.md`, content }), options.json);
        return;
      }
      const result = await generateProjectContext(options.project);
      printResult(io, ok('project.context', {
        path: result.path,
        sessionCount: result.sessionCount,
        content: result.content,
        // Slice 2026-07-15-project-scan-bootstrap (G1 + G2): the
        // context command also bootstraps the project-scan tree.
        // The envelope surfaces write counts + duration so the LLM
        // (and the user) see what landed.
        projectScan: result.projectScan
      }), options.json);
    } catch (error) {
      printResult(io, fail('project.context', 'PROJECT_CONTEXT_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and .peaks directory']), options.json);
      process.exitCode = 1;
    }
  });

  // --- Extract memories from a session's artifacts into .peaks/memory ---
  addJsonOption(
    project
      .command('memories:extract')
      .description('Scan a session artifact directory and extract <!-- peaks-memory:start --> blocks into .peaks/memory/')
      .requiredOption('--session-id <id>', 'session id (e.g. 2026-05-29-session-89ff35)')
      .requiredOption('--project <path>', 'target project root')
      // Slice #015: drop the `--dry-run true` default. With the default
      // set to true, `options.dryRun === true && options.apply === true`
      // fired on every `--apply` call (because dryRun was true by
      // default), permanently breaking `--apply`. `--dry-run` is now
      // opt-in; the mutual-exclusion check below is correct without a
      // special-case.
      .option('--dry-run', 'preview writes without changing files')
      .option('--apply', 'write extracted memories into .peaks/memory/')
  ).action((options: { sessionId: string; project: string; dryRun?: boolean; apply?: boolean; json?: boolean }) => {
    if (options.dryRun === true && options.apply === true) {
      printResult(io, fail('project.memories:extract', 'INVALID_MEMORY_EXTRACT_FLAGS', 'Use either --dry-run or --apply, not both', { sessionId: options.sessionId, projectRoot: options.project }, ['Run without --apply to preview writes, or pass --apply to write memories']), options.json);
      process.exitCode = 1;
      return;
    }
    try {
      const result = extractSessionMemories({
        projectRoot: options.project,
        sessionId: options.sessionId,
        apply: options.apply === true
      });
      printResult(io, ok('project.memories:extract', {
        scannedFiles: result.scannedFiles,
        extractedCount: result.extractedCount,
        writtenFiles: result.writtenFiles,
        memoryDir: result.primaryMemoryDir,
        indexUpdated: result.updatedIndex
      }), options.json);
    } catch (error) {
      printResult(io, fail('project.memories:extract', 'MEMORY_EXTRACT_FAILED', getErrorMessage(error), { sessionId: options.sessionId, projectRoot: options.project }, ['Check the session-id and project path']), options.json);
      process.exitCode = 1;
    }
  });

  // --- Read memory index (lightweight, always-safe to load) ---
  addJsonOption(
    project
      .command('memory-index')
      .description('Read the memory index — lightweight hot/warm分层 view of all project memories')
      .requiredOption('--project <path>', 'target project root')
  ).action((options: { project: string; json?: boolean }) => {
    try {
      const index = readMemoryIndex(options.project);
      if (!index) {
        printResult(io, ok('project.memory-index', { exists: false, message: 'No memory index found. Run `peaks project memories:extract` first.' }), options.json);
        return;
      }
      printResult(io, ok('project.memory-index', { exists: true, index }), options.json);
    } catch (error) {
      printResult(io, fail('project.memory-index', 'MEMORY_INDEX_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and .peaks/memory directory']), options.json);
      process.exitCode = 1;
    }
  });

  // --- Structured project memory (durable, LLM-authored, stored under .peaks/memory) ---
  addJsonOption(
    project
      .command('memories')
      .description('Read durable project memories (decisions, conventions, modules, rules) from .peaks/memory for LLM consumption')
      .requiredOption('--project <path>', 'target project root')
      .option('--kind <kind>', 'filter by kind: project, rule, decision, reference, feedback, convention, module, lesson')
  ).action((options: { project: string; kind?: string; json?: boolean }) => {
    try {
      const result = readProjectMemories(options.project);
      if (options.kind) {
        const memories = result.memories.filter((memory) => memory.kind === options.kind);
        printResult(io, ok('project.memories', {
          memoryDir: result.memoryDir,
          kind: options.kind,
          total: memories.length,
          memories
        }), options.json);
        return;
      }
      printResult(io, ok('project.memories', {
        memoryDir: result.memoryDir,
        total: result.total,
        byKind: result.byKind,
        memories: result.memories
      }), options.json);
    } catch (error) {
      printResult(io, fail('project.memories', 'PROJECT_MEMORIES_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and .peaks/memory directory']), options.json);
      process.exitCode = 1;
    }
  });

  // --- Show one project memory's body (R3: default = compact) ---
  addJsonOption(
    project
      .command('memories:show <name>')
      .description('Show one project memory body by name. Default format is `compact` (LLM-primary); pass --pretty for the disk verbatim. Stale entries (default ≥30 days) are excluded; pass --include-stale or --stale-days <N> to override.')
      .requiredOption('--project <path>', 'target project root')
      .option('--pretty', 'return the on-disk body verbatim; overrides the compact default')
      .option('--include-stale', 'include stale entries (the default excludes them)')
      .option('--stale-days <n>', 'override the 30-day stale threshold (must be > 0)', (value: string) => Number(value))
  ).action((name: string, options: { project: string; pretty?: boolean; includeStale?: boolean; staleDays?: number; json?: boolean }) => {
    try {
      const memory = readProjectMemoryBody(options.project, name);
      if (memory === null) {
        printResult(
          io,
          fail('project.memories:show', 'MEMORY_NOT_FOUND', `memory ${name} not found in .peaks/memory`, { name, projectRoot: options.project }, ['Run `peaks project memories --json` to see available names']),
          options.json
        );
        process.exitCode = 1;
        return;
      }

      // Compute the stale decision. R4: stale is computed at CLI load time
      // only; the source `.md` file is never modified.
      const updatedAt = memory.updatedAt;
      const thresholdDays = options.staleDays !== undefined && Number.isFinite(options.staleDays) && options.staleDays > 0
        ? options.staleDays
        : DEFAULT_STALE_DAYS;
      const policy = applyStalePolicy([{ name: memory.name, updatedAt }], {
        thresholdDays,
        includeStale: options.includeStale === true
      });
      if (policy.entries.length === 0) {
        const ageDays = policy.entries.length === 0 && policy.droppedCount > 0
          ? applyStalePolicy([{ name: memory.name, updatedAt }], { thresholdDays, includeStale: true }).entries[0]?.ageDays ?? 0
          : 0;
        printResult(
          io,
          fail('project.memories:show', 'MEMORY_STALE',
            `memory ${name} is stale (age ${ageDays} days > ${thresholdDays} day threshold); pass --include-stale to override`,
            { name, ageDays, thresholdDays },
            ['Pass --include-stale to load stale memories; pass --stale-days <N> to override the threshold'])
        , options.json);
        process.exitCode = 1;
        return;
      }
      const ageDays = policy.entries[0]?.ageDays ?? 0;
      const isStale = policy.entries[0]?.stale ?? false;

      const format: 'compact' | 'pretty' = options.pretty === true ? 'pretty' : 'compact';
      const body = format === 'pretty' ? memory.body : formatMdCompact(memory.body);
      printResult(io, ok('project.memories:show', {
        name: memory.name,
        title: memory.title,
        kind: memory.kind,
        sourcePath: memory.filePath,
        updatedAt,
        ageDays,
        stale: isStale,
        body,
        format,
        bodyBytes: Buffer.byteLength(body, 'utf8')
      }), options.json);
    } catch (error) {
      printResult(io, fail('project.memories:show', 'PROJECT_MEMORY_SHOW_FAILED', getErrorMessage(error), { name, projectRoot: options.project }, ['Check the project path and .peaks/memory directory']), options.json);
      process.exitCode = 1;
    }
  });

  // --- Read business-knowledge sediment (v2.11.0 Group B — D3) ---
  addJsonOption(
    project
      .command('knowledge')
      .description('Read .peaks/project-scan/business-knowledge.md (the schema-sedimented concept table). LLM-consumable; use --filter for a concept substring.')
      .requiredOption('--project <path>', 'target project root')
      .option('--filter <glob>', 'substring filter on the concept name (case-insensitive)')
  ).action(async (options: { project: string; filter?: string; json?: boolean }) => {
    try {
      const knowledge = await readBusinessKnowledge(options.project);
      if (knowledge === null) {
        printResult(
          io,
          ok('project.knowledge', { exists: false, projectRoot: options.project, path: `${options.project}/.peaks/project-scan/business-knowledge.md` }),
          options.json
        );
        return;
      }
      const concepts = options.filter
        ? knowledge.concepts.filter((c) => c.concept.toLowerCase().includes(options.filter!.toLowerCase()))
        : knowledge.concepts;
      printResult(
        io,
        ok('project.knowledge', {
          exists: true,
          schemaVersion: knowledge.schemaVersion,
          total: knowledge.concepts.length,
          matched: concepts.length,
          filter: options.filter ?? null,
          concepts
        }),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail('project.knowledge', 'PROJECT_KNOWLEDGE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check the project path and .peaks/project-scan directory']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
