import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Base JS recommended
  js.configs.recommended,

  // TypeScript-aware rules
  ...tseslint.configs.recommended,

  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', 'drizzle/**', 'postinstall.cjs'],
  },

  // Project overrides
  {
    rules: {
      // These are caught by tsc strict mode; eslint warnings are noise
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow empty catch blocks with a comment
      'no-empty': ['error', { allowEmptyCatch: false }],
      // Consistent use of type imports
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    },
  },
  // Test-specific overrides (allow mock objects and fixtures to use any)
  {
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
