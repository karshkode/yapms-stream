<script lang="ts">
	import type { StreamState } from '../stream-state';
	import CandidatesTable from './CandidatesTable.svelte';
	import GeographySection from './GeographySection.svelte';
	import PerformanceSection from './PerformanceSection.svelte';
	import RaceHeader from './RaceHeader.svelte';
	import RegionsTable from './RegionsTable.svelte';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();

	// A section renders iff the profile permits it AND the host left it visible.
	// Profile decides what's possible; visibility decides what's currently shown.
	const show = $derived({
		header: (state.profile?.sections.header ?? true) && state.ui.visible.header,
		candidates: (state.profile?.sections.candidates ?? true) && state.ui.visible.candidates,
		performance: (state.profile?.sections.performance ?? false) && state.ui.visible.performance,
		geography:
			!!state.profile?.geography && state.profile.sections.geography && state.ui.visible.geography,
		regions:
			!!state.profile?.geography && state.profile.sections.regions && state.ui.visible.regions
	});
</script>

<article class="race-page mx-auto flex max-w-[720px] flex-col">
	{#if show.header}
		<RaceHeader {state} />
	{/if}

	{#if show.candidates}
		<CandidatesTable {state} />
	{/if}

	{#if show.performance}
		<PerformanceSection {state} />
	{/if}

	{#if show.geography}
		<GeographySection />
	{/if}

	{#if show.regions}
		<RegionsTable {state} />
	{/if}
</article>

<style>
	.race-page {
		padding: 1rem;
	}
</style>
