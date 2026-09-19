import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['docs/**', 'node_modules/**', 'dist/**', 'scripts/**', 'cloud/dist/**', 'cloud/.wrangler/**', 'cloud/test/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Forbid type-coercion via `as`. Use type guards (typeof, instanceof,
      // user-defined predicates) or proper typing instead.
      '@typescript-eslint/consistent-type-assertions': ['error', {
        assertionStyle: 'never',
      }],
      // Unused parameters required only by an interface signature: prefix `_`.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
      }],
    },
  },
);
