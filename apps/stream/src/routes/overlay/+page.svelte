<script lang="ts">
	import { onMount } from 'svelte';
	import BroadcastFrame from '$lib/components/broadcast/BroadcastFrame.svelte';
	import FullscreenButton from '$lib/components/broadcast/FullscreenButton.svelte';
	import StagePanel from '$lib/components/stage/StagePanel.svelte';
	import { streamStore } from '$lib/stream-store.svelte';
	import { createOverlaySync } from '$lib/sync';
	import { roomFromUrl } from '$lib/sync/room-code';

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

	// `?room=ABCD` watches that desk through the server, which is the only thing
	// that reaches OBS (its Browser Source is a separate browser) or another
	// person's phone. Without a code this stays on the same-browser channel it
	// always used.
	let room = $state('');

	onMount(() => {
		const html = document.documentElement;
		html.classList.add('overlay-transparent');

		room = roomFromUrl(location.search);
		const sync = createOverlaySync(room);
		const unsub = sync.onState((next) => {
			streamStore.replace(next);
		});
		// A pan or zoom arrives on its own rather than as a fresh copy of every
		// county, so it's applied to the state already here. Ignored before the
		// first full snapshot, when there is nothing to apply it to.
		const unsubCamera = sync.onCamera?.((camera) => {
			if (streamStore.state.profile) streamStore.state.ui.mapCamera = camera;
		});

		return () => {
			unsub();
			unsubCamera?.();
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
		/* Phone-only, and never an OBS canvas — a Browser Source is sized in
		   pixels and is 1280 or 1920 wide, so nothing below this ever applies on
		   air. On a phone the overlay isn't a broadcast, it's a thing someone is
		   checking, and a fixed-height package there means the bottom of the
		   candidate list sits under the lower third with a name cut in half.
		   Letting the document scroll costs the on-air layout nothing and makes
		   the whole package reachable. */
		@media (max-width: 640px) {
			html,
			body {
				overflow-y: auto;
				overflow-x: hidden;
			}
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
		<p class="standby">
			Waiting for the control desk{#if room}
				in room <strong>{room}</strong>{:else}
				in this browser{/if}…
		</p>
		{#if !room}
			<!-- The commonest way to get a blank overlay is pointing OBS at a bare
			     /overlay, which can only ever see a desk in the same browser — and
			     OBS is never in the same browser. Say so here rather than leaving a
			     blank scene to be debugged. -->
			<p class="standby hint">
				No room code in this URL. Copy the overlay link from the control desk's top bar so this can
				follow a desk in another browser or on another machine.
			</p>
		{/if}
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
	.standby.hint {
		padding: 0 2rem 2rem;
		max-width: 32rem;
		margin: 0 auto;
		font-size: 0.85rem;
		line-height: 1.5;
	}

	/*
	 * The phone review layout.
	 *
	 * Everything here is behind a width no OBS Browser Source has, so the on-air
	 * package is untouched. What changes is the one assumption that doesn't hold
	 * on a phone: that the whole graphic fits the viewport. It doesn't — a 390px
	 * portrait window has to hold a map, a scoreboard with three or more
	 * candidates, a lower third and a crawl — so instead of squeezing them until
	 * the last candidate's name is sliced by the chyron, each part gets the height
	 * it needs and the page scrolls.
	 */
	@media (max-width: 640px) {
		.overlay-root {
			width: 100%;
			height: auto;
			min-height: 100dvh;
		}
		.overlay-root > :global(.frame) {
			height: auto;
			min-height: 100dvh;
		}
		/* The map still needs a definite height or it collapses to nothing once
		   it stops being the flexible part of a fixed-height column. */
		.overlay-root :global(.stage-main) {
			flex: 0 0 auto;
			min-height: 42dvh;
		}
		/* Reaching into the stage's own phone rules on purpose: its 50% cap keeps
		   a scoreboard from burying the map when the stage owns a fixed box, and
		   here the page scrolls instead, so the cap is the thing doing the
		   clipping. */
		.overlay-root :global(.results-rail),
		.overlay-root :global(.detail-slot) {
			max-height: none;
		}
		/* Docked or floating, the card belongs under the map in this layout rather
		   than on top of it — there is no spare screen to overlap with. */
		.overlay-root :global(.detail-slot) {
			position: static;
			inset: auto;
		}
	}
</style>
