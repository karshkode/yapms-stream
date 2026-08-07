<script lang="ts">
	import { tick } from 'svelte';
	import type { RaceTemplate } from '../../race-profile';
	import { applyTemplate } from '../../picker/applyTemplate';
	import { findRegionAttrByName } from '../../picker/civicapiResolver';
	import { pushRecent } from '../../picker/recent';
	import { searchTemplates } from '../../picker/searchIndex';
	import type { SavedRacesState, SavedRaceRef } from '../../stream-state';
	import { streamStore } from '../../stream-store.svelte';
	import CivicApiSearch from './CivicApiSearch.svelte';
	import SavedList from './SavedList.svelte';
	import TemplateList from './TemplateList.svelte';

	interface Props {
		/**
		 * When true, render the picker as a centered modal overlay. When false,
		 * the component returns nothing (host controls visibility via Cmd+K /
		 * the Templates button in TopBar). Kept as a prop so the picker can also
		 * run inline if future callers want that — just pass `open={true}`.
		 */
		open?: boolean;
		/** Called after a successful apply or when the host dismisses the modal. */
		onclose?: () => void;
	}

	let { open = true, onclose }: Props = $props();

	type Tab = 'templates' | 'civicapi' | 'saved';
	let activeTab: Tab = $state('templates');
	let query = $state('');
	let searchEl: HTMLInputElement | null = $state(null);
	let highlightedId = $state<string | null>(null);

	// When the modal opens we read `streamStore.state.ui.pickerQuery` /
	// `pickerInitialTab` and use them to seed the search box and active tab.
	// This is what powers "Browse all races for Texas" from StateRacesCard
	// (and any future "open picker pre-filled with X" entry points). After
	// applying the seeds we clear them on the store so the next plain
	// Cmd+K open isn't unexpectedly pre-filled. `tick()` is still needed to
	// wait for the input element to mount before focusing it.
	let lastOpen = false;
	$effect(() => {
		const isOpen = open ?? false;
		if (isOpen && !lastOpen) {
			const seedQuery = streamStore.state.ui.pickerQuery;
			const seedTab = streamStore.state.ui.pickerInitialTab;
			if (seedQuery) query = seedQuery;
			if (seedTab) activeTab = seedTab;
			// Reset the seeds so a subsequent plain open lands on Templates
			// with an empty query, matching the historical Cmd+K behavior.
			if (seedQuery || seedTab !== 'templates') {
				streamStore.state.ui.pickerQuery = '';
				streamStore.state.ui.pickerInitialTab = 'templates';
			}
			tick().then(() => {
				searchEl?.focus();
				searchEl?.select();
			});
		}
		lastOpen = isOpen;
	});

	function close() {
		onclose?.();
	}

	const hits = $derived(query ? searchTemplates(query, 60) : []);

	// Keep the highlighted row in sync with the current query results.
	$effect(() => {
		if (hits.length === 0) {
			highlightedId = null;
		} else if (!hits.some((h) => h.template.id === highlightedId)) {
			highlightedId = hits[0].template.id;
		}
	});

	function moveHighlight(delta: number) {
		if (hits.length === 0) return;
		const idx = hits.findIndex((h) => h.template.id === highlightedId);
		const nextIdx = Math.max(0, Math.min(hits.length - 1, (idx === -1 ? 0 : idx) + delta));
		highlightedId = hits[nextIdx].template.id;
	}

	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			moveHighlight(1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			moveHighlight(-1);
		} else if (e.key === 'Enter' && highlightedId) {
			e.preventDefault();
			const hit = hits.find((h) => h.template.id === highlightedId);
			if (hit) handleApply(hit.template);
		} else if (e.key === 'Escape') {
			// First Escape clears the query; second dismisses the modal. Lets the
			// host refine a search without losing the picker.
			if (query) {
				query = '';
			} else {
				close();
			}
		}
	}

	function handleApply(
		template: RaceTemplate,
		civicApiRaceId?: string,
		civicApiTitle?: string,
		subtitle?: string,
		preselectCountyName?: string | null
	) {
		if (streamStore.state.ui.dirty) {
			const ok = confirm(
				`Loading '${template.name}' will replace your candidates and region results. Replace?`
			);
			if (!ok) return;
		}
		streamStore.state = applyTemplate(streamStore.state, template);

		// If the civicAPI entry targets a specific county (e.g. a Yorktown
		// Town Council race scoped to Delaware County, IN), fuzzy-match that
		// county name against the freshly-stamped state-statewide regions
		// and pre-select it. MapView's click-to-zoom effect notices the
		// selectedRegionAttr change and auto-frames the county — so the host
		// lands on the relevant geography instead of a pan-around statewide
		// map. Statewide/federal races pass null and skip this step.
		if (preselectCountyName) {
			const regions = streamStore.state.regions;
			const regionAttr = findRegionAttrByName(regions, preselectCountyName);
			if (regionAttr) {
				streamStore.state.ui.selectedRegionAttr = regionAttr;
			}
		}

		// Register in Recent list. When this is a civicAPI race we stash the
		// raceId + its original civicAPI title so clicking the Recent entry
		// re-resumes polling and shows the human name rather than the
		// template's generic label.
		streamStore.state = {
			...streamStore.state,
			savedRaces: pushRecent(streamStore.state.savedRaces, {
				templateId: template.id,
				label: civicApiTitle ?? template.name,
				parameters: {},
				civicApiRaceId: civicApiRaceId ?? null,
				civicApiTitle: civicApiTitle ?? null,
				subtitle: subtitle ?? null,
				preselectCountyName: preselectCountyName ?? null
			})
		};

		// Data-source handling:
		//  - civicAPI path  → attach adapter + start polling for the new race.
		//  - plain template → *stop* any polling that was running against the
		//    previously-loaded race. Otherwise the next civicAPI tick (up to
		//    intervalMs later) will clobber the template's title/candidates/
		//    regions with whatever the old raceId returned. This was the
		//    "load Alabama, instantly snaps back to Kansas City Bonds" bug.
		if (civicApiRaceId) {
			streamStore.state.dataSource = {
				...streamStore.state.dataSource,
				adapter: 'civicapi',
				raceId: civicApiRaceId,
				running: true
			};
		} else {
			streamStore.state.dataSource = {
				...streamStore.state.dataSource,
				adapter: 'manual',
				raceId: null,
				running: false
			};
		}

		// Dismiss so the host lands back on the stage map with the new template
		// loaded. Matches Cmd+K palette UX in VS Code / Linear / etc.
		close();
	}

	function handleLoadSaved(ref: SavedRaceRef) {
		if (ref.state) {
			streamStore.state = ref.state;
		}
		close();
	}

	function onSavedMutate(next: SavedRacesState) {
		streamStore.state = { ...streamStore.state, savedRaces: next };
	}
</script>

{#if open}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="picker-backdrop"
	onclick={(e) => {
		// Only close when clicking the backdrop itself; let clicks inside the
		// card propagate normally (no stopPropagation at .picker-modal root).
		if (e.target === e.currentTarget) close();
	}}
>
<div class="picker-modal" role="dialog" aria-modal="true" aria-label="Race picker">
<div class="picker">
	<div class="tabs" role="tablist">
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'templates'}
			class:active={activeTab === 'templates'}
			onclick={() => (activeTab = 'templates')}
		>
			Templates
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'civicapi'}
			class:active={activeTab === 'civicapi'}
			onclick={() => (activeTab = 'civicapi')}
		>
			civicAPI live
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'saved'}
			class:active={activeTab === 'saved'}
			onclick={() => (activeTab = 'saved')}
		>
			Saved ({streamStore.state.savedRaces.bookmarked.length})
		</button>
	</div>

	<div class="search-row">
		<input
			type="search"
			placeholder="Search races…"
			bind:this={searchEl}
			bind:value={query}
			onkeydown={onSearchKey}
		/>
		<kbd class="shortcut">Cmd+K</kbd>
	</div>

	<div class="body">
		{#if activeTab === 'templates'}
			<TemplateList
				{query}
				state={streamStore.state}
				{highlightedId}
				onapply={(t) => handleApply(t)}
				onapplyCivic={(t, raceId, title, subtitle, preselect) =>
					handleApply(t, raceId, title, subtitle, preselect)}
				onapplyRecent={(ref, t) =>
					handleApply(
						t,
						ref.civicApiRaceId ?? undefined,
						ref.civicApiTitle ?? undefined,
						ref.subtitle ?? undefined,
						ref.preselectCountyName ?? undefined
					)}
				onhover={(id) => (highlightedId = id)}
			/>
		{:else if activeTab === 'civicapi'}
			<CivicApiSearch
				{query}
				onapply={(t, raceId, title, subtitle, preselect) =>
					handleApply(t, raceId, title, subtitle, preselect)}
			/>
		{:else}
			<SavedList
				state={streamStore.state}
				onload={handleLoadSaved}
				onmutate={onSavedMutate}
			/>
		{/if}
	</div>
</div>
</div>
</div>
{/if}

<style>
	.picker-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(2px);
		z-index: 50;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 6vh 1rem 1rem;
	}
	.picker-modal {
		width: min(100%, 44rem);
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
		border-radius: var(--radius-box);
		overflow: hidden;
	}
	.picker {
		background: var(--color-base-200);
		border: 1px solid var(--color-secondary);
		border-radius: var(--radius-box);
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		flex: 1 1 auto;
		min-height: 0;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
	}
	.tabs button {
		padding: 0.375rem 0.75rem;
		background: transparent;
		border: 1px solid transparent;
		color: rgb(from var(--color-base-content) r g b / 0.65);
		border-radius: 999px;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.tabs button.active {
		color: var(--color-base-content);
		border-color: var(--color-secondary);
	}
	.search-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	input[type='search'] {
		flex-grow: 1;
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.5rem 0.625rem;
		border-radius: 0.375rem;
	}
	.shortcut {
		font-family: ui-monospace, monospace;
		font-size: 0.7rem;
		padding: 0.125rem 0.375rem;
		border: 1px solid var(--color-secondary);
		border-radius: 0.25rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.body {
		flex: 1 1 auto;
		min-height: 16rem;
		max-height: 60vh;
		overflow-y: auto;
	}
</style>
