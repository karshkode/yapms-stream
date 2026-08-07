import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// SvelteKit translates `kit.alias` into Vite's resolver; the `@yapms` alias
// is defined in svelte.config.js. We still need to let Vite's dev server
// serve files from the sibling workspace (outside apps/stream/) since the
// loaded SVGs live there.
const yapmsLib = fileURLToPath(new URL('../yapms/src/lib', import.meta.url));

// Vite 5+ rejects requests with a `Host:` header that doesn't match
// localhost / the bind address unless it's listed here. The host
// runs the dev stream behind a reverse proxy that rewrites Host to
// the short name "kube" (their k3s node), so without this the
// browser gets a "Blocked request" wall. We explicitly list known
// proxy hostnames rather than opening it wide (`true`) so we don't
// become a DNS-rebinding target on a LAN.
//
// Reviewing the overlay from a phone means going through a public tunnel,
// which hands out a fresh random hostname on every boot, so those can't be
// enumerated ahead of time. The wildcard suffixes cover the two brokers we
// use, and STREAM_ALLOWED_HOSTS takes a comma-separated list for anything
// else so a one-off tunnel doesn't need a config edit.
const allowedHosts = [
	'kube',
	'kube.local',
	'localhost',
	'.local',
	'.trycloudflare.com',
	'.ngrok-free.app',
	...(process.env.STREAM_ALLOWED_HOSTS ?? '')
		.split(',')
		.map((host) => host.trim())
		.filter((host) => host.length > 0)
];

const config = defineConfig({
	plugins: [sveltekit(), tailwindcss()],
	server: {
		host: '0.0.0.0',
		// 8082 is reserved on this host by a docker container, so Vite would
		// silently auto-increment to 8083 every time it booted. Pinning to
		// 8083 directly so the URL is stable across restarts and matches the
		// host's `localhost:8083` bookmark / OBS browser-source URL.
		port: 8083,
		allowedHosts,
		fs: {
			allow: [yapmsLib, fileURLToPath(new URL('.', import.meta.url))]
		}
	},
	preview: {
		host: '0.0.0.0',
		port: 8083,
		allowedHosts
	},
	build: {
		rollupOptions: {
			external: ['fs']
		}
	}
});

export default config;
