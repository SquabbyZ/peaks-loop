import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const stableCoverageRoot = process.platform === 'win32'
  ? projectRoot.replace(/^[A-Z]:/, (drive) => drive.toLowerCase())
  : projectRoot;

export default defineConfig({
  root: stableCoverageRoot,
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/vitest.setup.ts'],
    // Run tests in a single forked process. Reasons:
    //
    // 1. tests/vitest.setup.ts stashes the project's .peaks/.session.json
    //    so buildArtifactRelativePath (which walks process.cwd() to find
    //    the project root and reads .peaks/.session.json from it) falls
    //    into the legacy changeId-based path the tests assert on. With
    //    multiple workers, each worker runs the setup independently and
    //    races on the rename — some workers see the file, others don't,
    //    and the file gets restored at the wrong time, leading to flaky
    //    failures.
    //
    // 2. The test suite is small enough (121 files, 1739 tests, ~18s) that
    //    the parallelism benefit is marginal. Determinism is more
    //    valuable than a few seconds of wall-clock here.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli/index.ts',
        'src/cli/program.ts',
        'src/cli/commands/shadcn-commands.ts',
        'src/cli/commands/core-artifact-commands.ts',
        'src/cli/commands/codegraph-commands.ts',
        'src/cli/commands/project-commands.ts',
        'src/cli/commands/workflow-commands.ts',
        'src/cli/commands/request-commands.ts',
        'src/cli/commands/scan-commands.ts',
        'src/shared/paths.ts',
        'src/shared/result.ts',
        'src/services/recommendations/recommendation-types.ts',
        'src/services/artifacts/artifact-service.ts',
        'src/services/artifacts/workspace-service.ts',
        'src/services/config/config-service.ts',
        'src/services/config/config-safety.ts',
        'src/shared/frontmatter.ts',
        'src/services/skills/skill-registry.ts',
        'src/services/doctor/doctor-service.ts',
        'src/services/proxy/proxy-service.ts',
        'src/services/codegraph/codegraph-process-runner.ts',
        'src/services/shadcn/shadcn-service.ts',
        'src/services/mcp/mcp-types.ts',
        'src/services/mcp/mcp-stdio-transport.ts',
        'src/services/openspec/openspec-types.ts',
        'src/services/understand/understand-types.ts',
        'src/services/scan/scan-types.ts',
        'src/services/session/index.ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});