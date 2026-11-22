import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const maxWorkers = process.env.CI ? 2 : Math.min(4, Math.max(2, os.availableParallelism() - 1));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'webapp/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    unstubEnvs: true,
    unstubGlobals: true,
    // Keep CI stable at 2 workers; locally scale to available cores minus 1 (capped at 4).
    maxWorkers,
    projects: [
      {
        extends: true,
        test: {
          // Pure DI suites (zero vi.mock / vi.resetModules / process.chdir): reuse module
          // graph per thread worker so grammY / Fastify / React / catalogs load once.
          name: 'shared',
          pool: 'threads',
          isolate: false,
          include: ['tests/telegram/**/*.test.ts', 'tests/webapp/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          // Suites using vi.mock, vi.resetModules, process.chdir, or process-level state.
          name: 'isolated',
          pool: 'forks',
          isolate: true,
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/telegram/**/*.test.ts', 'tests/webapp/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'webapp/src/**/*.{ts,tsx}'],
      exclude: [
        'src/infra/schema.ts',
        '**/*.d.ts',
        'webapp/src/main.tsx',
        'webapp/src/vite-env.d.ts',
        'webapp/src/index.css',
      ],
      thresholds: {
        // Whole-repository floor. Calibrated in Phase 3 verification; never lower silently.
        statements: 34,
        branches: 31,
        functions: 37,
        lines: 36,
      },
    },
  },
});
