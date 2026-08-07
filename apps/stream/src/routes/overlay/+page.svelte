<script lang="ts">
	import { onMount } from 'svelte';
	import StagePanel from '$lib/components/stage/StagePanel.svelte';
	import { streamStore } from '$lib/stream-store.svelte';
	import { createBroadcastSync } from '$lib/sync/broadcast';

	// Transparent overlay that OBS points its Browser Source at. Purely
	// read-only: subscribes to BroadcastChannel messages from /control and
	// re-renders whenever state arrives.
	//
	// As of the "CNN Stage V2" pass, this route renders the exact same
	// `<StagePanel>` that /control does — just with `interactive={false}`.
	// That keeps the two surfaces in visual lockstep (same map, same tabs,
	// same detail card selection, same archival slider painting the map)
	// without us having to maintain two separate render trees. `/overlay`
	// picks up `ui.archivalYear`, `ui.selectedRegionAttr`, `ui.activeMapTab`,
	// etc. automatically via the BroadcastChannel payload, so the host's
	// every move on /control mirrors into the OBS stream in real time.

	onMount(() => {
		const html = document.documentElement;
		html.classList.add('overlay-transparent');

		const sync = createBroadcastSync('overlay');
		const unsub = sync.onState((next) => {
			streamStore.replace(next);
		});

		return () => {
			unsub();
			sync.dispose();
			html.classList.remove('overlay-transparent');
		};
	});
</script>

<svelte:head>
	<title>YAPms Overlay</title>
	<style>
		html,
		body {
			background: transparent !important;
			margin: 0;
			padding: 0;
			overflow: hidden;
		}
	</style>
</svelte:head>

<div class="overlay-root">
	{#if streamStore.state.profile}
		<StagePanel interactive={false} showPip={false} />
	{:else}
		<p class="standby">Waiting for /control to load a race…</p>
	{/if}
</div>

<style>
	.overlay-root {
		color: var(--color-base-content);
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		/* The stage's own background is opaque; clear it here so OBS's
		   Browser Source sees transparency everywhere the stage doesn't
		   paint (e.g. when profile is null). */
		background: transparent;
	}
	.overlay-root :global(.stage) {
		/* Match /control's behavior where the stage fills its container. The
		   BroadcastChannel-replaced state still includes `profile` so the
		   stage renders its map straight away. */
		flex: 1 1 auto;
		min-height: 0;
	}
	.standby {
		padding: 2rem;
		text-align: center;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		font-family: sans-serif;
	}
</style>
