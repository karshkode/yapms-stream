import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter(),
		env: {
			dir: '../../'
		},
		// Cross-workspace alias so we can reuse the yapms SVG catalog and
		// importMap sanitizer config without duplicating them here.
		alias: {
			'@yapms': '../yapms/src/lib',
			'@yapms/*': '../yapms/src/lib/*'
		}
	}
};

export default config;
