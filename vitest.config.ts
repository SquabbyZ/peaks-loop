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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli/index.ts',
        'src/cli/program.ts',
        'src/shared/paths.ts',
        'src/shared/result.ts',
        'src/services/recommendations/recommendation-types.ts',
        'src/services/artifacts/artifact-service.ts',
        'src/services/artifacts/workspace-service.ts',
        'src/services/config/config-service.ts',
        'src/shared/frontmatter.ts',
        'src/services/skills/skill-registry.ts',
        'src/services/doctor/doctor-service.ts',
        'src/services/proxy/proxy-service.ts',
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