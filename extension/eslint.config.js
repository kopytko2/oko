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
      'oko-extension.zip'
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
      // Catch floating promises (common LLM mistake)
      '@typescript-eslint/no-floating-promises': 'error',
      
      // Consistent imports
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      
      // Catch implicit any in catch blocks
      '@typescript-eslint/use-unknown-in-catch-variables': 'error',
      
      // No unused variables
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      
      // Prefer const
      'prefer-const': 'error',
      
      // No console in production (warn only)
      'no-console': 'warn',
      
      // Require explicit return types on exported functions
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true
      }]
    }
  }
]
