<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { applyStreamColors } from '$lib/map/apply-colors';
	import { loadProfileSvg } from '$lib/map/load-svg';
	import { streamStore } from '$lib/stream-store.svelte';
	import { formatTimeInZone } from '$lib/time-zone';

	/**
	 * The graphic a desk puts up when it calls a race.
	 *
	 * This is the one moment of an election broadcast that is a moment. Everything
	 * else on screen is a running total nobody watches change; the call is an
	 * announcement and has to arrive as one. So it takes the scene: the stage dims
	 * behind it and a card slides up carrying the geography it's a call about, the
	 * face, the check and the numbers it was called on.
	 *
	 * The map inside it is the point of the layout rather than decoration. A name
	 * and a percentage could be any race in the country; the same card showing the
	 * five boroughs, or the outline of Michigan, says which one without a word.
	 * It's rendered from the same SVG and the same colours the stage is using, so
	 * it is the map the audience was just looking at, not an illustration of it.
	 *
	 * Every number is a copy taken when the host pressed the button, never a live
	 * read. A projection is a claim made at a time — "at 9:41, with 62% counted" —
	 * and a card that kept updating would drift away from its own timestamp within
	 * minutes, then quietly rewrite what the desk said if the count later tightened.
	 */

	interface Props {
		/**
		 * True on /control, where this is the operator's confirmation rather than
		 * the on-air graphic: smaller, in a corner, and dismissable. On air the
		 * card owns the scene and is cleared by the desk or by its own timeout.
		 */
		compact?: boolean;
	}
	let { compact = false }: Props = $props();

	const streamState = $derived(streamStore.state);
	const call = $derived(streamState.ui.broadcast.call);

	const stamp = $derived(
		call ? formatTimeInZone(new Date(call.at), streamState.race.timeZone) : ''
	);

	// "PROJECTED WINNER" against "WINNER" is not decoration. One says the desk's
	// model has decided ahead of the count, the other says the count itself has;
	// broadcasts get sued over the difference.
	const kicker = $derived(call?.kind === 'winner' ? 'Winner' : 'Projected winner');

	/**
	 * "(D)", not "(Democratic)". civicAPI sends party names in full, which is
	 * right for a roster row and wrong beside a name set at this size.
	 */
	const party = $derived.by(() => {
		const label = call?.party?.trim() ?? '';
		if (label.length <= 3) return label.toUpperCase();
		return label.charAt(0).toUpperCase();
	});

	/**
	 * The race's own map, drawn inside the card.
	 *
	 * A second copy of the SVG rather than a second MapView: this needs no panning,
	 * no zooming, no click targets and no camera, and mounting the interactive
	 * component would put a second panzoom instance on the page every time a race
	 * is called. The filtered SVG already carries a viewBox fitted to the race's
	 * geography, so it centres itself — a citywide race shows the city, a statewide
	 * one the state, with no framing work at all.
	 */
	let mapHost = $state<HTMLDivElement | null>(null);
	let mapMarkup = $state<string | null>(null);
	// Deliberately not `$state`: the effect below both reads and writes this to
	// avoid re-fetching the same map, and a reactive write would re-run the effect,
	// firing the previous run's cleanup and marking its own in-flight load stale.
	// The result: the SVG loads and is then thrown away, every time.
	let mapKey: string | null = null;

	$effect(() => {
		const profile = call ? streamState.profile : null;
		if (!profile?.geography) {
			mapMarkup = null;
			mapKey = null;
			return;
		}
		const key = profile.id;
		if (key === mapKey) return;
		mapKey = key;
		let stale = false;
		loadProfileSvg(profile)
			.then((markup) => {
				if (!stale) mapMarkup = markup;
			})
			.catch(() => {
				// A card with no map is still a call. Better a smaller graphic than a
				// broken one, and the stage behind it still has the real map.
				if (!stale) mapMarkup = null;
			});
		return () => {
			stale = true;
		};
	});

	// Painted with the live tally, not the frozen one: the numbers on the card are
	// the claim, and the map beside them is the picture the audience already has.
	$effect(() => {
		if (!mapHost || !mapMarkup) return;
		const svg = mapHost.querySelector('svg');
		if (!svg) return;
		applyStreamColors(svg, streamState, 'results', null);
	});
</script>

{#if call}
	<div
		class="call-wrap"
		class:compact
		transition:fade={{ duration: compact ? 120 : 260 }}
		aria-live="polite"
	>
		<article
			class="call"
			style:--party={call.partyColor}
			in:fly={{ y: compact ? 8 : 40, duration: compact ? 160 : 420, easing: cubicOut }}
		>
			{#if mapMarkup}
				<!-- Left of the face, because it answers "where" before "who" — and
				     because the card reads as part of the scene when it opens on the
				     same shape the stage is showing. -->
				<div class="map" bind:this={mapHost} aria-hidden="true">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html mapMarkup}
				</div>
			{/if}

			<div class="portrait">
				{#if call.headshotUrl}
					<img src={call.headshotUrl} alt="" />
				{:else}
					<!-- A call card with an empty grey square where the face goes looks
					     broken, so the initial stands in as a deliberate monogram. -->
					<span class="monogram">{call.name.trim().charAt(0) || '?'}</span>
				{/if}
				<span class="check" aria-hidden="true">
					<svg viewBox="0 0 24 24" role="none">
						<path
							d="M4.5 12.5l5 5 10-11"
							fill="none"
							stroke="currentColor"
							stroke-width="3.2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</span>
			</div>

			<div class="body">
				<p class="kicker">{kicker}</p>
				<h2 class="name">
					{call.name}{#if party}<span class="party">({party})</span>{/if}
				</h2>
				{#if call.raceTitle}
					<p class="race">{call.raceTitle}</p>
				{/if}

				<dl class="figures">
					<div>
						<dt>Share</dt>
						<dd>{call.pct.toFixed(1)}%</dd>
					</div>
					<div>
						<dt>Votes</dt>
						<dd>{call.votes.toLocaleString()}</dd>
					</div>
					<div>
						<dt>Lead</dt>
						<dd>+{call.marginPct.toFixed(1)}</dd>
					</div>
					{#if call.reportedPct != null}
						<div>
							<dt>Counted</dt>
							<dd>{call.reportedPct.toFixed(0)}%</dd>
						</div>
					{/if}
				</dl>

				<p class="stamp">
					{#if call.source}<span class="source">{call.source}</span>{/if}
					<!-- The time is the whole claim: the numbers above are what they were
					     then, not what they are now, and the rail beside this card will
					     already disagree with them. -->
					<span>Called {stamp}</span>
				</p>
				{#if call.note}
					<p class="note">{call.note}</p>
				{/if}
			</div>

			{#if compact}
				<!-- The desk's copy can be waved away. The on-air one can't be clicked
				     at all, and clears itself. -->
				<button
					type="button"
					class="dismiss"
					aria-label="Clear the call"
					title="Clear the call"
					onclick={() => (streamStore.state.ui.broadcast.call = null)}
				>
					&times;
				</button>
			{/if}
		</article>
	</div>
{/if}

<style>
	.call-wrap {
		position: absolute;
		inset: 0;
		z-index: 9;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 0 1.5rem 1.75rem;
		/* Dim the stage rather than hide it: the audience keeps the context of the
		   map they were just looking at, and the card reads as a scene the show
		   moved into rather than a page it replaced. */
		background: linear-gradient(
			to bottom,
			rgb(from var(--color-base-300) r g b / 0.25),
			rgb(from var(--color-base-300) r g b / 0.82)
		);
		pointer-events: none;
	}
	.call {
		display: flex;
		align-items: stretch;
		gap: 1.5rem;
		width: min(100%, 62rem);
		padding: 1.25rem 1.75rem 1.25rem 1.25rem;
		background: linear-gradient(
			100deg,
			rgb(from var(--party) r g b / 0.3) 0%,
			var(--color-base-100) 42%
		);
		border: 1px solid rgb(from var(--party) r g b / 0.8);
		border-left: 0.55rem solid var(--party);
		border-radius: 0.6rem;
		box-shadow: 0 18px 54px rgba(0, 0, 0, 0.7);
	}

	/* --- the map inside the card --- */
	.map {
		flex: 0 0 auto;
		width: 11rem;
		display: flex;
		align-items: center;
		justify-content: center;
		padding-right: 1.25rem;
		border-right: 1px solid rgb(from var(--color-secondary) r g b / 0.4);
	}
	.map :global(svg) {
		width: 100%;
		height: 100%;
		max-height: 9.5rem;
		display: block;
		/* The card is small, so the per-region borders that read well at full stage
		   size would be most of the shape here. */
		--call-map-stroke: 0.6;
	}
	.map :global([map-type='regions'] path) {
		stroke-width: var(--call-map-stroke);
	}
	/* Nothing in here is a control, and the labels the stage draws on regions are
	   sized for the stage. */
	.map :global([for-region]),
	.map :global([map-type='cities']) {
		display: none;
	}

	.portrait {
		position: relative;
		flex-shrink: 0;
		width: 9rem;
		height: 9rem;
		align-self: center;
	}
	.portrait img,
	.monogram {
		width: 100%;
		height: 100%;
		border-radius: 0.4rem;
		border: 3px solid var(--party);
		object-fit: cover;
		object-position: top center;
		background: var(--color-base-200);
	}
	.monogram {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 3.6rem;
		font-weight: 800;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.check {
		position: absolute;
		right: -0.55rem;
		bottom: -0.55rem;
		width: 2.9rem;
		height: 2.9rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		/* Green regardless of party. The check means "this one is decided", and
		   painting it red for a Republican would read as an error mark. */
		background: #17913c;
		color: #fff;
		border: 3px solid var(--color-base-100);
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
	}
	.check svg {
		width: 1.7rem;
		height: 1.7rem;
	}
	.body {
		min-width: 0;
		align-self: center;
	}
	.kicker {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.18em;
		color: var(--party);
	}
	.name {
		margin: 0.15rem 0 0;
		font-size: 2.5rem;
		line-height: 1.05;
		font-weight: 900;
		letter-spacing: -0.01em;
	}
	.party {
		margin-left: 0.4rem;
		font-size: 1.2rem;
		font-weight: 700;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.race {
		margin: 0.3rem 0 0;
		font-size: 0.95rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.figures {
		display: flex;
		gap: 1.4rem;
		margin: 0.85rem 0 0;
	}
	.figures dt {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.figures dd {
		margin: 0.1rem 0 0;
		font-size: 1.2rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.stamp {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.7rem 0 0;
		font-size: 0.8rem;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.source {
		padding: 0.1rem 0.4rem;
		border: 1px solid rgb(from var(--color-base-content) r g b / 0.35);
		border-radius: 0.2rem;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.note {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		font-style: italic;
		color: rgb(from var(--color-base-content) r g b / 0.75);
	}
	.dismiss {
		align-self: flex-start;
		margin-left: auto;
		padding: 0 0.35rem;
		background: transparent;
		border: none;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		pointer-events: auto;
	}
	.dismiss:hover {
		color: var(--color-base-content);
	}

	/*
	 * The operator's copy. Same component so the host is looking at the same
	 * graphic — a separate layout would be a second thing to keep in step, and the
	 * one that drifts is always the preview. It does not dim and it sits at the
	 * bottom edge, because the operator needs the map they are about to talk about.
	 */
	.compact {
		align-items: flex-end;
		justify-content: flex-start;
		padding: 0 0 0.6rem 0.6rem;
		background: none;
	}
	.compact .call {
		gap: 0.85rem;
		width: auto;
		max-width: 30rem;
		padding: 0.6rem 0.5rem 0.6rem 0.7rem;
		border-left-width: 0.35rem;
	}
	.compact .map {
		width: 4.25rem;
		padding-right: 0.6rem;
	}
	.compact .map :global(svg) {
		max-height: 3.5rem;
		--call-map-stroke: 1.2;
	}
	.compact .portrait {
		width: 3.75rem;
		height: 3.75rem;
	}
	.compact .monogram {
		font-size: 1.5rem;
	}
	.compact .check {
		width: 1.4rem;
		height: 1.4rem;
		right: -0.25rem;
		bottom: -0.25rem;
		border-width: 2px;
	}
	.compact .check svg {
		width: 0.85rem;
		height: 0.85rem;
	}
	.compact .kicker {
		font-size: 0.55rem;
		letter-spacing: 0.12em;
	}
	.compact .name {
		font-size: 1.05rem;
	}
	.compact .party {
		font-size: 0.7rem;
	}
	.compact .race {
		font-size: 0.6rem;
	}
	.compact .figures {
		gap: 0.7rem;
		margin-top: 0.35rem;
	}
	.compact .figures dt {
		font-size: 0.5rem;
	}
	.compact .figures dd {
		font-size: 0.75rem;
	}
	.compact .stamp,
	.compact .note {
		font-size: 0.6rem;
		margin-top: 0.3rem;
	}

	@media (max-width: 860px) {
		/* The map is the first thing to go: at this width the card is already
		   choosing between a face and a shape, and the face is the announcement. */
		.map {
			display: none;
		}
		.call {
			gap: 0.85rem;
			padding: 0.85rem 1rem 0.85rem 0.75rem;
		}
		.portrait {
			width: 5rem;
			height: 5rem;
		}
		.name {
			font-size: 1.35rem;
		}
		.figures {
			gap: 0.75rem;
		}
		.figures dd {
			font-size: 0.9rem;
		}
	}
</style>
