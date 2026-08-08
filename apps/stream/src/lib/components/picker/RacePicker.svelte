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
	import FindRace from './FindRace.svelte';
	import SavedList from './SavedList.svelte';
	import TemplateList from './TemplateList.svelte';
	import type { RecentRaceRef } from '../../stream-state';

	interface Props {
		/**
		 * When true, render the picker as a centered modal overlay. When false,
		 * the component returns nothing (host controls visibility via Cmd+K /
		 * the search button in TopBar). Kept as a prop so the picker can also
		 * run inline if future callers want that — just pass `open={true}`.
		 */
		open?: boolean;
		/** Called after a successful apply or when the host dismisses the modal. */
		onclose?: () => void;
		/**
		 * Open the state race list (StateRacesCard) for a two-letter abbr. Owned
		 * by /control because resetting to the browse-us shell and re-selecting
		 * the state touches the template + dataSource lifecycle. Drives both the
		 * "States" search results and the browse-by-state grid.
		 */
		onbrowsestate?: (abbr: string) => void;
	}

	let { open = true, onclose, onbrowsestate }: Props = $props();

	// Scopes, not tabs: "All" searches every corpus at once and is where the
	// host lands. The rest narrow to one source for when they already know
	// which they want. 'templates' / 'civicapi' / 'saved' keep their old names
	// so persisted `pickerInitialTab` values and StateRacesCard's deep link
	// still resolve.
	type Scope = 'all' | 'civicapi' | 'templates' | 'saved';
	let activeTab: Scope = $state('all');
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
			// Reset the seeds so a subsequent plain open lands on the unified
			// search with an empty query.
			if (seedQuery || seedTab !== 'all') {
				streamStore.state.ui.pickerQuery = '';
				streamStore.state.ui.pickerInitialTab = 'all';
			}
			tick().then(() => {
				searchEl?.focus();
				searchEl?.select();
			});
		}
		lastOpen = isOpen;
	});

	const SCOPES: Array<{ id: Scope; label: string }> = [
		{ id: 'all', label: 'All' },
		{ id: 'civicapi', label: 'Live' },
		{ id: 'templates', label: 'Templates' },
		{ id: 'saved', label: 'Saved' }
	];

	// navigator.platform is deprecated but still the most widely-shipped way to
	// detect macOS client-side without UA parsing. Same derivation as TopBar.
	let modKey = $derived(
		typeof navigator !== 'undefined' && /Mac|iP(ad|od|hone)/.test(navigator.platform) ? '⌘' : 'Ctrl'
	);

	function close() {
		onclose?.();
	}

	function browseState(abbr: string) {
		onbrowsestate?.(abbr);
		close();
	}

	// Re-applying a recent entry is `handleApply` with the civicAPI identity
	// unpacked from the stored ref, so polling resumes against the original
	// race rather than restarting it as a bare template.
	function applyRecent(ref: RecentRaceRef, template: RaceTemplate) {
		handleApply(
			template,
			ref.civicApiRaceId ?? undefined,
			ref.civicApiTitle ?? undefined,
			ref.subtitle ?? undefined,
			ref.preselectCountyName ?? undefined
		);
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

		// Name the race the moment it's applied. The template's seed title is a
		// generic placeholder — one statewide template serves every race in a
		// state, so it says "New York Statewide Race" — and until now that
		// placeholder stayed on screen until the first poll landed. The host
		// clicked "New York City Mayor" and got a stage captioned with another
		// race's name, which is worse than useless while on air. We already know
		// the real title here; the poll will confirm it.
		if (civicApiTitle) {
			streamStore.state.race.title = civicApiTitle;
		}

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
				<div class="search-row">
					<span class="search-icon" aria-hidden="true">⌕</span>
					<input
						type="search"
						placeholder="Search a state, race, or template…"
						aria-label="Search races"
						bind:this={searchEl}
						bind:value={query}
						onkeydown={onSearchKey}
					/>
					<kbd class="shortcut">{modKey}+K</kbd>
				</div>

				<div class="tabs" role="tablist">
					{#each SCOPES as scope (scope.id)}
						<button
							type="button"
							role="tab"
							aria-selected={activeTab === scope.id}
							class:active={activeTab === scope.id}
							onclick={() => (activeTab = scope.id)}
						>
							{scope.label}{#if scope.id === 'saved'}<span class="scope-count"
									>({streamStore.state.savedRaces.bookmarked.length})</span
								>{/if}
						</button>
					{/each}
				</div>

				<div class="body">
					{#if activeTab === 'all'}
						<FindRace
							{query}
							streamState={streamStore.state}
							{highlightedId}
							onapply={(t) => handleApply(t)}
							onapplyCivic={(t, raceId, title, subtitle, preselect) =>
								handleApply(t, raceId, title, subtitle, preselect)}
							onapplyRecent={(ref, t) => applyRecent(ref, t)}
							onbrowsestate={browseState}
							onhover={(id) => (highlightedId = id)}
						/>
					{:else if activeTab === 'templates'}
						<TemplateList
							{query}
							state={streamStore.state}
							{highlightedId}
							onapply={(t) => handleApply(t)}
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
	.scope-count {
		margin-left: 0.3rem;
		opacity: 0.6;
		font-variant-numeric: tabular-nums;
	}
	/* The query box leads, above the scope chips: the picker is a search
	   surface first and a browser second, so the caret should be the first
	   thing the host sees. */
	.search-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.search-icon {
		position: absolute;
		left: 0.6rem;
		font-size: 1.1rem;
		line-height: 1;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		pointer-events: none;
	}
	input[type='search'] {
		flex-grow: 1;
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.5rem 0.625rem 0.5rem 2rem;
		border-radius: 0.375rem;
		font-size: 0.95rem;
	}
	input[type='search']:focus {
		outline: none;
		border-color: var(--color-primary);
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
	/* Phone layout: the modal becomes a near-full-screen sheet. At 390px the
	   6vh top inset plus a 60vh body left the results in a letterbox with
	   dead space above and below. */
	@media (max-width: 640px) {
		.picker-backdrop {
			padding: 0;
			align-items: stretch;
		}
		.picker-modal {
			width: 100%;
			max-height: 100%;
			border-radius: 0;
		}
		.picker {
			border-radius: 0;
			border: none;
			padding: 0.5rem;
		}
		.body {
			max-height: none;
		}
		.tabs {
			/* Four scopes at thumb size overflow 390px, so let them scroll
			   sideways rather than wrap onto a second row. */
			overflow-x: auto;
			scrollbar-width: none;
		}
		.tabs::-webkit-scrollbar {
			display: none;
		}
		.tabs button {
			flex-shrink: 0;
			min-height: 2.25rem;
		}
		input[type='search'] {
			/* Anything under 16px makes iOS Safari zoom the whole page on focus. */
			font-size: 1rem;
			min-height: 2.75rem;
		}
		.shortcut {
			display: none;
		}
	}
</style>
