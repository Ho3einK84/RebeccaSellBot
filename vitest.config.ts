import { defineConfig } from 'vitest/config';
import path from 'node:path';

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
    // Keep CI and small production hosts stable; each worker loads the full
    // TypeScript/grammY graph and the suite does not benefit from wide fan-out.
    maxWorkers: 2,
    include: ['tests/**/*.test.ts'],
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
