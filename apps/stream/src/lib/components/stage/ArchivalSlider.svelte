<script lang="ts">
	import type { StreamState } from '$lib/stream-state';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();

	// Ordered stops: "Live" on the left (null = live-first, default), then the
	// 5 bake years oldest -> newest. Matches how election-night producers
	// narrate history — start in the present, scrub back in time for context.
	const STOPS: { value: '2008' | '2012' | '2016' | '2020' | '2024' | null; label: string }[] = [
		{ value: null, label: 'Live' },
		{ value: '2008', label: '2008' },
		{ value: '2012', label: '2012' },
		{ value: '2016', label: '2016' },
		{ value: '2020', label: '2020' },
		{ value: '2024', label: '2024' }
	];

	function setYear(v: (typeof STOPS)[number]['value']) {
		state.ui.archivalYear = v;
	}

	function label(v: (typeof STOPS)[number]['value']): string {
		const match = STOPS.find((s) => s.value === v);
		return match ? match.label : 'Live';
	}
</script>

<div
	class="archival-slider"
	role="tablist"
	aria-label="Archival year"
	title={state.ui.archivalYear
		? `Showing ${label(state.ui.archivalYear)} presidential baseline`
		: 'Live results only — click a year to overlay that election as the baseline'}
>
	{#each STOPS as stop (stop.value ?? 'live')}
		<button
			type="button"
			role="tab"
			class="stop"
			class:active={state.ui.archivalYear === stop.value}
			class:live={stop.value === null}
			aria-selected={state.ui.archivalYear === stop.value}
			onclick={() => setYear(stop.value)}
		>
			{stop.label}
		</button>
	{/each}
</div>

<style>
	.archival-slider {
		display: inline-flex;
		align-items: center;
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		border-radius: 999px;
		padding: 0.15rem;
		gap: 0.1rem;
	}
	.stop {
		appearance: none;
		background: transparent;
		border: 1px solid transparent;
		color: rgb(from var(--color-base-content) r g b / 0.7);
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-family: ui-monospace, monospace;
		letter-spacing: 0.02em;
		cursor: pointer;
		line-height: 1;
	}
	.stop:hover {
		color: var(--color-base-content);
		background: rgb(from var(--color-secondary) r g b / 0.5);
	}
	.stop.active {
		background: var(--color-primary);
		color: var(--color-primary-content);
	}
	.stop.live {
		font-weight: 700;
	}
	.stop.live.active {
		/* "Live" gets a distinct green-family tint when active so the host can
		   tell at a glance that the map is reading live data, not a year. */
		background: #16a34a;
		color: #fff;
	}
	/* Six pills at ~2.9rem each overrun a phone's width on their own. Let the
	   pill row scroll sideways rather than wrap mid-control or push the rest
	   of the toolbar off-screen, and keep the track shape intact. */
	@media (max-width: 640px) {
		.archival-slider {
			display: flex;
			max-width: 100%;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.archival-slider::-webkit-scrollbar {
			display: none;
		}
		.stop {
			padding: 0.4rem 0.6rem;
			font-size: 0.78rem;
			flex: 0 0 auto;
			/* Padding alone left these at 27px tall, under the ~36px a thumb
			   needs, and these six pills are the most-used control on the bar. */
			min-height: 2.25rem;
		}
	}
</style>
