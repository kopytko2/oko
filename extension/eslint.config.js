import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'background.js',
      'picker.js',
      'popup.js',
      'popup-mock.html',
      'icons/**',
      'oko-extension.zip',
      'server.mjs',
      '*.mjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        chrome: 'readonly'
      },
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // Catch floating promises - warn for now, fix incrementally
      // TODO: Change to 'error' once all floating promises are fixed
      '@typescript-eslint/no-floating-promises': 'warn',
      
      // Consistent imports
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      
      // Catch implicit any in catch blocks
      '@typescript-eslint/only-throw-error': 'error',
      
      // No unused variables
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      
      // Prefer const
      'prefer-const': 'error',
      
      // No console in production (warn only)
      'no-console': 'warn',
      
      // Require explicit return types on exported functions
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
        allowDirectConstAssertionInArrowFunctions: true
      }],
      
      // Chrome extension API is not deprecated - disable false positive
      '@typescript-eslint/no-deprecated': 'off',
      
      // Allow void expressions in arrow functions (common pattern)
      '@typescript-eslint/no-confusing-void-expression': 'off',
      
      // Relax unnecessary condition checks (optional chaining is defensive)
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      
      // Allow restrict-template-expressions for logging
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allowNumber: true,
        allowBoolean: true,
        allowNullish: true
      }],
      
      // Relax some strict rules for pragmatic development
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-enum-comparison': 'warn',
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: false
      }],
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'warn'
    }
  },
  // Relaxed rules for test files
  {
    files: ['**/__tests__/**/*.ts', '**/e2e/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      'no-console': 'off'
    }
  }
]
