import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

export default [
	{ ignores: ['dist/**', 'node_modules/**', '_reference/**'] },
	{
		files: ['src/**/*.ts', 'test/**/*.js'],
		languageOptions: {
			parser: tsParser,
			parserOptions: { ecmaVersion: 2022, sourceType: 'module' }
		},
		plugins: { '@typescript-eslint': tsPlugin },
		rules: {
			...tsPlugin.configs.recommended.rules,
			// dynamic binding surfaces (WebIDL / Blockbench runtime) are intentionally `any`
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			'no-console': 'off'
		}
	}
]
