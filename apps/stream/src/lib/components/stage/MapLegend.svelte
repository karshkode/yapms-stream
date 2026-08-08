<script lang="ts">
	import type { MapTab } from '$lib/race-profile';
	import { isPartisanField, resolveBaseline } from '$lib/map/metrics';
	import { streamStore } from '$lib/stream-store.svelte';

	/**
	 * What the colours on the map mean right now.
	 *
	 * The shading modes were doing real work with no way to read them: a county
	 * painted pale teal, or one shade of red among several, told the host
	 * nothing without a key, and nothing on screen said which race the swing was
	 * measured against. A margin of "R +4" against last spring's primary and
	 * against the 2024 presidential are different claims, and only one of them
	 * is safe to say on air — so the baseline is named here rather than left
	 * implicit in a panel the host set once and forgot.
	 *
	 * Read-only by design. Clicking it opens the Compare drawer tab, which owns
	 * baseline selection and capture; this stays a caption so it can sit over
	 * the map without becoming another control to mis-click during a broadcast.
	 */

	interface Props {
		tab: MapTab;
		/** False on /overlay: the OBS capture gets the key, not the click target. */
		interactive?: boolean;
	}

	let { tab, interactive = true }: Props = $props();

	const state = $derived(streamStore.state);
	let baseline = $derived(resolveBaseline(state));

	interface Ramp {
		/** Left-to-right swatches. */
		stops: string[];
		lowLabel: string;
		highLabel: string;
		/** One line on what the shading is measuring. */
		note: string;
		/** True when this mode measures against the baseline. */
		usesBaseline: boolean;
	}

	let ramp = $derived.by<Ramp | null>(() => {
		if (tab === 'results') {
			const parties = state.candidates
				.filter((c) => !c.hidden)
				.slice(0, 6)
				.map((c) => c.partyColor);
			if (parties.length === 0) return null;
			return {
				stops: parties,
				lowLabel: 'Leading candidate',
				highLabel: '',
				note: 'Each region takes the colour of whoever leads it.',
				usesBaseline: false
			};
		}
		if (tab === 'margin') {
			return {
				stops: ['#ffffff', '#d98b91', '#BF1D29'],
				lowLabel: 'Tied',
				highLabel: 'Landslide',
				note: 'Leader’s colour, paler the closer the region is.',
				usesBaseline: false
			};
		}
		if (tab === 'swing') {
			return {
				stops: ['#1C408C', '#8fa3c8', '#6b7280', '#d98b91', '#BF1D29'],
				lowLabel: 'Toward D',
				highLabel: 'Toward R',
				note: 'Margin shift since the baseline race. Full colour at 20 points.',
				usesBaseline: true
			};
		}
		if (tab === 'turnout') {
			return {
				stops: ['#b45309', '#d9a86b', '#6b7280', '#6bc0b8', '#0d9488'],
				lowLabel: 'Smaller share',
				highLabel: 'Bigger share',
				note: 'Share of the vote versus the baseline race, projected to a full count.',
				usesBaseline: true
			};
		}
		return {
			stops: ['#3a3a44', '#f5e6a8', '#eab308'],
			lowLabel: 'Counted',
			highLabel: 'Most left to count',
			note: 'Estimated votes still outstanding, scaled to the largest pile on the map.',
			usesBaseline: false
		};
	});

	/**
	 * Why a baseline-driven mode is showing nothing, phrased as the thing to do
	 * about it. Blank when the mode is fine.
	 */
	let problem = $derived.by<string | null>(() => {
		if (!ramp?.usesBaseline) return null;
		if (!baseline) return 'No baseline data for this map. Pick another in Compare.';
		if (tab === 'swing' && !baseline.partisan) {
			return `${baseline.label} wasn’t a two-party race, so a swing against it means nothing. Turnout still works.`;
		}
		// Only worth saying once there's a field to say it about; an empty roster
		// isn't a same-party contest, it's a map waiting for a race.
		if (tab === 'swing' && state.candidates.length >= 2 && !isPartisanField(state.candidates)) {
			return 'This race’s top two are from the same party, so its margin isn’t a partisan one and a swing against any baseline means nothing. Turnout still works.';
		}
		if (tab === 'turnout' && !baseline.hasVotes) {
			return `${baseline.label} has no vote totals to compare turnout against. Pick a past Senate or Governor race in Compare to use this mode.`;
		}
		return null;
	});

	function openCompare() {
		streamStore.state.ui.activeDrawerTab = 'compare';
		streamStore.state.ui.drawerOpen = true;
	}
</script>

{#if ramp}
	<div class="legend" class:readonly={!interactive}>
		<div class="ramp" aria-hidden="true">
			{#each ramp.stops as stop, i (i)}
				<span class="stop" style:background-color={stop}></span>
			{/each}
		</div>
		<div class="scale">
			<span>{ramp.lowLabel}</span>
			{#if ramp.highLabel}<span>{ramp.highLabel}</span>{/if}
		</div>
		<p class="note">{ramp.note}</p>
		{#if ramp.usesBaseline}
			{#if interactive}
				<button type="button" class="baseline" onclick={openCompare}>
					vs <strong>{baseline?.label ?? 'nothing selected'}</strong>
					<span class="cue">Change</span>
				</button>
			{:else}
				<p class="baseline-static">vs {baseline?.label ?? 'nothing selected'}</p>
			{/if}
		{/if}
		{#if problem}
			<p class="problem">{problem}</p>
		{/if}
	</div>
{/if}

<style>
	.legend {
		position: absolute;
		bottom: 0.5rem;
		left: 0.5rem;
		z-index: 6;
		max-width: 15rem;
		padding: 0.45rem 0.55rem;
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
		border-radius: 0.4rem;
		background: rgb(from var(--color-base-100) r g b / 0.88);
		backdrop-filter: blur(6px);
		font-size: 0.7rem;
		/* The legend explains the map; it must never be the thing that eats a
		   click meant for a county underneath it. Only its own button re-enables
		   pointer events. */
		pointer-events: none;
	}
	.ramp {
		display: flex;
		height: 0.4rem;
		border-radius: 999px;
		overflow: hidden;
	}
	.stop {
		flex: 1;
	}
	.scale {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 0.2rem;
		font-size: 0.6rem;
		color: rgb(from var(--color-base-content) r g b / 0.65);
	}
	.note {
		margin: 0.25rem 0 0;
		font-size: 0.65rem;
		line-height: 1.3;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.baseline,
	.baseline-static {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		width: 100%;
		margin: 0.3rem 0 0;
		padding: 0.2rem 0.3rem;
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
		border-radius: 0.25rem;
		background: rgb(from var(--color-base-300) r g b / 0.7);
		color: inherit;
		font: inherit;
		font-size: 0.65rem;
		text-align: left;
	}
	.baseline {
		pointer-events: auto;
		cursor: pointer;
	}
	.baseline strong {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.baseline:hover {
		border-color: var(--color-primary);
	}
	.cue {
		flex-shrink: 0;
		font-size: 0.6rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.baseline:hover .cue {
		color: var(--color-primary);
	}
	.problem {
		margin: 0.3rem 0 0;
		font-size: 0.63rem;
		line-height: 1.3;
		color: var(--color-warning, #eab308);
	}
	/* On a phone the legend would cover a third of the map, and the host has the
	   region detail card for specifics anyway — so drop the prose and keep the
	   key itself, which is the part that can't be inferred. */
	@media (max-width: 640px) {
		.legend {
			max-width: 11rem;
			padding: 0.35rem 0.4rem;
		}
		.note {
			display: none;
		}
		.baseline,
		.baseline-static {
			min-height: 1.9rem;
			align-items: center;
		}
	}
</style>
