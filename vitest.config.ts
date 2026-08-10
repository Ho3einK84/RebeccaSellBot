import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Keep CI and small production hosts stable; each worker loads the full
    // TypeScript/grammY graph and the suite does not benefit from wide fan-out.
    maxWorkers: 2,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        // Current whole-repository floor (including Telegram route assembly
        // and declarative schema/catalog files). Raise these as route-level
        // integration coverage is added; never lower them silently.
        statements: 34,
        branches: 31,
        functions: 37,
        lines: 36,
      },
    },
  },
});
