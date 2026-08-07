<script lang="ts">
	import type { MapTab } from '../race-profile';
	import { streamStore } from '../stream-store.svelte';
	import MapView from './MapView.svelte';

	// GeographySection is the legacy tab used by the /overlay RacePage — it
	// shares the same stream store as the stage panel so we just reach in
	// directly instead of prop-drilling (which Svelte 5 flags as a
	// cross-component mutation).
	const state = $derived(streamStore.state);

	const tabs: { id: MapTab; label: string }[] = [
		{ id: 'results', label: 'Results' },
		{ id: 'margin', label: 'Margin' },
		{ id: 'swing', label: 'Swing' },
		{ id: 'remaining', label: 'Remaining' }
	];
</script>

<section class="race-card">
	<div class="tabs" role="tablist">
		{#each tabs as t (t.id)}
			<button
				type="button"
				class="tab"
				class:active={state.ui.activeMapTab === t.id}
				role="tab"
				aria-selected={state.ui.activeMapTab === t.id}
				onclick={() => (streamStore.state.ui.activeMapTab = t.id)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<MapView
		tab={state.ui.activeMapTab}
		onselect={(attr) => {
			// Toggle selection when the same region is re-clicked so the host can
			// dismiss without aiming at empty space. The RegionsTable reacts via a
			// pure-derived `forcedPage` so we don't have to reset regionsPage here.
			streamStore.state.ui.selectedRegionAttr =
				state.ui.selectedRegionAttr === attr ? null : attr;
		}}
		onregionsextracted={(rows) => {
			// Only fill in regions when the template didn't seed any; otherwise
			// we'd wipe baked county registrations / performance margins.
			if (state.regions.length > 0) return;
			streamStore.state.regions = rows;
		}}
	/>
</section>

<style>
	.tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.5rem;
		border-bottom: 1px solid var(--color-secondary);
	}
	.tab {
		background: transparent;
		border: 1px solid transparent;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.tab:hover {
		color: var(--color-base-content);
	}
	.tab.active {
		color: var(--color-base-content);
		border-color: var(--color-secondary);
	}
</style>
