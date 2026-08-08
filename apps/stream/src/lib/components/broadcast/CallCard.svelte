<script lang="ts">
	import { streamStore } from '$lib/stream-store.svelte';
	import { formatTimeInZone } from '$lib/time-zone';

	/**
	 * The graphic a desk puts up when it calls a race: the face, the check, and
	 * the numbers it was called on.
	 *
	 * This is the one moment of an election broadcast that is a moment. Everything
	 * else on screen is a running total that nobody watches change; the call is an
	 * announcement, and it needs to arrive as one — which is why it takes over the
	 * scene rather than lighting up a chip in the corner. The rail already shows a
	 * "Winner" chip next to a name, and that chip is invisible on a stream.
	 *
	 * It is pushed and pulled by hand from /control. A card that appeared by itself
	 * the instant a feed flipped `winner: true` would put a call on air before the
	 * host had said it out loud, and a wire correction would yank it back the same
	 * way. Deciding when to show it is the desk's job; this renders the decision.
	 *
	 * Every number is read from the frozen `ui.broadcast.call` and never from live
	 * state, so the card still says what the desk said at the time it said it.
	 */

	interface Props {
		/**
		 * True on /control's inline preview, where the card is a smaller version of
		 * itself sitting in the operator's stage. The on-air copy runs at full size.
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
	 * "(D)", not "(Democratic)".
	 *
	 * civicAPI sends party names in full, which is right for a roster row and
	 * wrong next to a name set at 2.4rem — "Abdul El-Sayed (Democratic)" wraps the
	 * headline of the card. The single letter is what a broadcast uses anyway.
	 */
	const party = $derived.by(() => {
		const label = call?.party?.trim() ?? '';
		if (label.length <= 3) return label.toUpperCase();
		return label.charAt(0).toUpperCase();
	});
</script>

{#if call}
	<div class="call-wrap" class:compact>
		<article class="call" style:--party={call.partyColor} aria-live="polite">
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
		</article>
	</div>
{/if}

<style>
	.call-wrap {
		position: absolute;
		inset: 0;
		z-index: 9;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		/* Dim rather than hide the map behind it: the audience keeps the context
		   of the state they were just looking at, and the card still reads as an
		   overlay rather than a page change. */
		background: rgb(from var(--color-base-300) r g b / 0.72);
		backdrop-filter: blur(3px);
		pointer-events: none;
		animation: rise 320ms ease-out;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(0.75rem);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.call-wrap {
			animation: none;
		}
	}
	.call {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		max-width: 44rem;
		padding: 1.5rem 2rem 1.5rem 1.5rem;
		background: linear-gradient(
			100deg,
			rgb(from var(--party) r g b / 0.28) 0%,
			var(--color-base-100) 45%
		);
		border: 1px solid rgb(from var(--party) r g b / 0.8);
		border-left: 0.6rem solid var(--party);
		border-radius: 0.6rem;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.65);
	}
	.portrait {
		position: relative;
		flex-shrink: 0;
		width: 8.5rem;
		height: 8.5rem;
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
		font-size: 3.5rem;
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
		font-size: 2.4rem;
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
		gap: 1.25rem;
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
		font-size: 1.15rem;
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

	/* The operator's copy shares every rule above so the host is looking at the
	   same graphic, only smaller — a separate layout would be a second thing to
	   keep in step, and the one that drifts is always the preview.
	   
	   It does not dim, and it sits at the bottom edge rather than the middle: the
	   operator needs the map they're about to talk about, and a confirmation that
	   covered it would get closed. On air the dim is the point; here it isn't. */
	.compact {
		align-items: flex-end;
		justify-content: flex-start;
		padding: 0 0 0.6rem 0.6rem;
		background: none;
		backdrop-filter: none;
		animation: none;
	}
	.compact .call {
		gap: 0.85rem;
		max-width: 26rem;
		padding: 0.75rem 1rem 0.75rem 0.75rem;
		border-left-width: 0.35rem;
	}
	.compact .portrait {
		width: 4.5rem;
		height: 4.5rem;
	}
	.compact .monogram {
		font-size: 1.8rem;
	}
	.compact .check {
		width: 1.6rem;
		height: 1.6rem;
		right: -0.3rem;
		bottom: -0.3rem;
		border-width: 2px;
	}
	.compact .check svg {
		width: 0.95rem;
		height: 0.95rem;
	}
	.compact .kicker {
		font-size: 0.6rem;
		letter-spacing: 0.12em;
	}
	.compact .name {
		font-size: 1.2rem;
	}
	.compact .party {
		font-size: 0.75rem;
	}
	.compact .race {
		font-size: 0.65rem;
	}
	.compact .figures {
		gap: 0.75rem;
		margin-top: 0.4rem;
	}
	.compact .figures dd {
		font-size: 0.8rem;
	}
	.compact .stamp,
	.compact .note {
		font-size: 0.65rem;
		margin-top: 0.35rem;
	}

	@media (max-width: 640px) {
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
