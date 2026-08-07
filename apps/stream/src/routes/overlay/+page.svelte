<script lang="ts">
	import { onMount } from 'svelte';
	import BroadcastFrame from '$lib/components/broadcast/BroadcastFrame.svelte';
	import FullscreenButton from '$lib/components/broadcast/FullscreenButton.svelte';
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
		{#if streamStore.state.ui.broadcast.frame}
			<!-- Broadcast package: banner, lower third and results crawl wrapped
			     around the same stage. Turning the frame off leaves the bare stage
			     for hosts who build their own chrome in OBS. -->
			<BroadcastFrame>
				<StagePanel interactive={false} showPip={false} />
			</BroadcastFrame>
		{:else}
			<StagePanel interactive={false} showPip={false} />
		{/if}
	{:else}
		<p class="standby">Waiting for /control to load a race…</p>
	{/if}

	<!-- Outside the profile guard: a host setting up a second-monitor
	     program-out wants to size the window before /control has picked a
	     race. Hidden until a pointer or key says a human is here, so OBS's
	     Browser Source never captures it. -->
	<FullscreenButton belowBanner={streamStore.state.ui.broadcast.frame} />
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
	/* The frame is the outermost element in framed mode and owns the full
	   capture area; the stage inside it is sized by the frame's own grid. */
	.overlay-root > :global(.frame) {
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
