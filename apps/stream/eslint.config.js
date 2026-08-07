import globals from 'globals';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';

import svelteParser from 'svelte-eslint-parser';

const config = [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	...svelte.configs['flat/prettier'],
	prettier,
	{
		ignores: [
			'node_modules',
			'build',
			'.svelte-kit',
			'.env*',
			'package-lock.json',
			'postcss.config.js',
			'svelte.config.js',
			'tailwind.config.js',
			'eslint.config.js',
			'vite.config.ts'
		]
	},
	{
		files: ['**/*.ts', '*.ts'],
		languageOptions: {
			parser: ts.parser,
			parserOptions: {
				project: './tsconfig.json',
				extraFileExtensions: ['.svelte']
			},
			globals: {
				...globals.browser
			}
		},
		rules: {
			'svelte/no-navigation-without-resolve': 'off',
			// The deferred data adapters (ballotpedia, ddhq) keep their real
			// signatures with `_`-prefixed parameters so the shape is documented
			// while the body still throws "not implemented".
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_'
				}
			]
		}
	},
	{
		files: ['**/*.svelte', '*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: ts.parser
			},
			globals: {
				...globals.browser
			}
		},
		rules: {
			'svelte/require-each-key': 'off',
			'svelte/no-at-html-tags': 'off',
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/block-lang': [
				'error',
				{
					enforceScriptPresent: true,
					script: ['ts']
				}
			]
		}
	},
	{
		// One-time bake scripts (county seeds, historical margins). They run under
		// Node rather than in the browser, so they need Node globals, and their
		// `.ts` copies sit outside the SvelteKit tsconfig — the type-aware parser
		// errors out on them rather than linting. Last in the array so it wins
		// over the browser-globals blocks above.
		files: ['scripts/**'],
		languageOptions: {
			globals: {
				...globals.node
			},
			parserOptions: {
				project: null
			}
		}
	}
];

export default config;
