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
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        chrome: 'readonly'
      }
    }
  }
]
