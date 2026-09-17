import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
            ],
            'no-console': 'off'
        }
    },
    {
        files: ['examples/**/*.ts'],
        rules: { '@typescript-eslint/no-non-null-assertion': 'off' }
    },
    {
        // Plain Node scripts, run directly rather than bundled.
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            globals: { console: 'readonly', process: 'readonly', Response: 'readonly' }
        }
    }
);
