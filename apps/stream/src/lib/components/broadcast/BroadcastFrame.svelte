<script lang="ts">
	import type { Snippet } from 'svelte';
	import { streamStore } from '$lib/stream-store.svelte';
	import { formatTimeInZone } from '$lib/time-zone';
	import RaceTicker from './RaceTicker.svelte';

	/**
	 * News-channel chrome around the OBS scene: branded banner across the top,
	 * a lower third naming the race, and the results crawl beneath it. The
	 * scene itself (map + results rail) is passed in as a child so this stays a
	 * pure layout shell and /overlay keeps rendering the same StagePanel that
	 * /control does.
	 *
	 * Sizing is deliberately in rem against a 1080p-ish Browser Source rather
	 * than viewport units: OBS captures at a fixed canvas size, so a banner
	 * that scales with the viewport would come out a different thickness every
	 * time the host resized the source.
	 */

	interface Props {
		children: Snippet;
	}
	let { children }: Props = $props();

	// Named `streamState`, not `state`: a local `state` binding makes
	// svelte-check read the `$state('')` clock below as a store subscription.
	const streamState = $derived(streamStore.state);
	const config = $derived(streamState.ui.broadcast);

	// Headline: the host's manual override wins, otherwise the race title. Falls
	// back to a neutral string so the lower third never renders as a bare bar.
	const headline = $derived(config.headline.trim() || streamState.race.title || 'Election results');

	// Wall clock in the banner corner, the way every results broadcast carries
	// one — and on the election's clock, not the desk's. Everything else in the
	// banner is already in local election time: the polls-close label, the
	// "we're expecting Wayne around 10" the host says over it. A desk run from
	// another zone that captions itself in its own is the one element on screen
	// telling the audience the wrong time about their own election.
	//
	// Read reactively so the clock switches zones the moment a race loads,
	// rather than at the next tick.
	const zone = $derived(streamState.race.timeZone);
	let clock = $state('');
	$effect(() => {
		const inZone = zone;
		// Local scratch instance for formatting, not reactive state — the
		// formatted string is what the banner reads.
		const tick = () => (clock = formatTimeInZone(new Date(), inZone));
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	});

	const reporting = $derived.by<string | null>(() => {
		if (streamState.race.reportedPctLabel) return streamState.race.reportedPctLabel;
		if (streamState.race.reportedPct != null) return `${streamState.race.reportedPct.toFixed(1)}%`;
		return null;
	});
</script>

<div class="frame">
	<header class="banner">
		<span class="brand">{config.networkName}</span>
		<span class="banner-mid">{streamState.race.dateLabel || streamState.race.pollsCloseLabel}</span>
		<span class="banner-right">
			{#if config.liveBadge}
				<span class="live"><span class="pulse"></span>Live</span>
			{/if}
			<span class="clock">{clock}</span>
		</span>
	</header>

	<div class="scene">
		{@render children()}
	</div>

	<div class="lower-third">
		<span class="accent"></span>
		<span class="headline">{headline}</span>
		{#if reporting}
			<span class="reporting">{reporting} reporting</span>
		{/if}
		{#if streamState.race.decisionMadeLabel}
			<span class="decision">{streamState.race.decisionMadeLabel}</span>
		{/if}
	</div>

	{#if config.ticker}
		<RaceTicker />
	{/if}
</div>

<style>
	.frame {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: var(--color-base-100);
		/* The border the host asked to "pull up around the scene". Inset rather
		   than a plain outline so it reads as a graphic package edge even when
		   OBS crops a pixel or two off the source. */
		border: 2px solid rgb(from var(--color-primary) r g b / 0.55);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
		overflow: hidden;
	}
	.banner {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-shrink: 0;
		height: 2.75rem;
		padding-right: 1rem;
		background: linear-gradient(
			90deg,
			var(--color-base-200) 0%,
			var(--color-base-100) 55%,
			var(--color-base-100) 100%
		);
		border-bottom: 1px solid rgb(from var(--color-primary) r g b / 0.35);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		height: 100%;
		padding: 0 1rem;
		background: var(--color-primary);
		color: var(--color-primary-content);
		font-weight: 900;
		font-size: 0.95rem;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		white-space: nowrap;
	}
	.banner-mid {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.banner-right {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}
	.live {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: var(--color-error);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		padding: 0.2rem 0.5rem;
		border-radius: 0.2rem;
	}
	.pulse {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: #fff;
		animation: blink 2s ease-in-out infinite;
	}
	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.25;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulse {
			animation: none;
		}
	}
	.clock {
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		color: rgb(from var(--color-base-content) r g b / 0.75);
		white-space: nowrap;
	}
	.scene {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		position: relative;
	}
	/* The stage is the only child and has to claim the whole scene box. Global
	   because it's rendered through the children snippet from /overlay. */
	.scene :global(.stage) {
		flex: 1 1 auto;
		min-height: 0;
	}
	.lower-third {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
		padding: 0.5rem 1rem 0.5rem 0;
		background: rgb(from var(--color-base-200) r g b / 0.95);
		border-top: 1px solid var(--color-secondary);
	}
	.accent {
		width: 0.375rem;
		align-self: stretch;
		background: var(--color-primary);
		flex-shrink: 0;
	}
	.headline {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1.35rem;
		font-weight: 800;
		letter-spacing: 0.01em;
	}
	.reporting,
	.decision {
		flex-shrink: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.7);
		white-space: nowrap;
	}
	.decision {
		color: var(--color-accent);
		font-weight: 700;
	}
	@media (max-width: 640px) {
		.banner {
			height: 2.25rem;
		}
		.brand {
			font-size: 0.75rem;
			letter-spacing: 0.08em;
			padding: 0 0.6rem;
		}
		/* The date/polls-close line is the first thing to go — the lower third
		   below already carries the race identity. */
		.banner-mid {
			display: none;
		}
		.headline {
			font-size: 1rem;
		}
		.reporting,
		.decision {
			font-size: 0.7rem;
		}
	}
</style>
