<script lang="ts">
	import type { RaceTemplate } from '../../race-profile';
	import { searchStates } from '../../picker/searchStates';
	import { searchTemplates } from '../../picker/searchIndex';
	import type { RecentRaceRef, StreamState } from '../../stream-state';
	import { hydrateTemplateById } from '../../templates';
	import { STATES, STATES_BY_ABBR } from '../../templates/states';
	import CivicApiSearch from './CivicApiSearch.svelte';
	import PickerCategory from './PickerCategory.svelte';
	import TemplateList from './TemplateList.svelte';

	/**
	 * FindRace — the default pane of the race picker, and the one place the host
	 * goes to answer "which race am I covering?".
	 *
	 * This replaces a split where the TopBar had a "Templates" button next to a
	 * separate "Recent" dropdown, and the picker opened on a list of static
	 * templates with live civicAPI races hidden behind a second tab. Templates
	 * are the least common thing the host actually wants; a specific state or a
	 * live race is the common thing. So one query box now searches all three
	 * corpora at once and the results are ordered by how likely they are to be
	 * what was meant:
	 *
	 *   1. States      — pivot into the state-scoped civicAPI lookup, because
	 *                    civicAPI's own text search only matches election names
	 *                    and so can't answer "what's happening in Kentucky".
	 *   2. Live races  — civicAPI text search.
	 *   3. Templates   — the static archival/parameterized maps.
	 *
	 * With no query it answers "where was I?" and "what's on right now?"
	 * instead: recent races and recent states (both absorbed from the old
	 * TopBar dropdown), then today's live races, then the full state list, with
	 * the template categories last.
	 */

	interface Props {
		query: string;
		// Named `streamState` rather than `state` because Svelte 5 reads a local
		// `state` binding as ambiguous with the `$state` rune. Same workaround
		// as TopBar / FormsDrawer / StateRacesCard.
		streamState: StreamState;
		highlightedId: string | null;
		onapply: (template: RaceTemplate) => void;
		onapplyCivic: (
			template: RaceTemplate,
			civicApiRaceId: string,
			title?: string,
			subtitle?: string,
			preselectCountyName?: string | null
		) => void;
		onapplyRecent: (ref: RecentRaceRef, template: RaceTemplate) => void;
		/** Open the state's race list (StateRacesCard) for `abbr`. */
		onbrowsestate: (abbr: string) => void;
		onhover: (templateId: string | null) => void;
	}

	let {
		query,
		streamState,
		highlightedId,
		onapply,
		onapplyCivic,
		onapplyRecent,
		onbrowsestate,
		onhover
	}: Props = $props();

	// Deliberately not persisted to `ui.pickerExpanded` like the template
	// categories: the grid is a fallback, so every open of the picker should
	// start from the compact header rather than however it was left.
	let stateGridOpen = $state(false);

	const stateHits = $derived(searchStates(query));
	// Only used to decide whether the Templates section is worth a header — the
	// rows themselves are rendered by TemplateList so there's one implementation
	// of template row markup, highlighting and hover.
	const templateHitCount = $derived(query ? searchTemplates(query, 60).length : 0);

	// Hydrate each Recent entry's template. `hydrateTemplateById` rather than a
	// plain map lookup so parameterized ids (us-house-119-TX-15) round-trip —
	// TEMPLATES_BY_ID only knows the generic shells.
	const recentRaces = $derived(
		streamState.savedRaces.recent
			.map((ref) => ({ ref, template: hydrateTemplateById(ref.templateId) }))
			.filter((r): r is { ref: RecentRaceRef; template: RaceTemplate } => r.template !== null)
	);

	const recentStates = $derived(
		streamState.ui.recentStates
			.map((abbr) => STATES_BY_ABBR[abbr.toUpperCase()])
			.filter((meta) => meta !== undefined)
	);
</script>

{#if query}
	{#if stateHits.length > 0}
		<section class="group">
			<h4>States</h4>
			<ul class="rows">
				{#each stateHits as hit (hit.state.abbr)}
					<li>
						<button
							type="button"
							class="row state-row"
							onclick={() => onbrowsestate(hit.state.abbr)}
						>
							<span class="state-abbr">{hit.state.abbr}</span>
							<span class="row-info">
								<strong>{hit.state.name}</strong>
								<span class="row-sub">Every race in {hit.state.name}</span>
							</span>
							<span class="row-cue">Browse ›</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="group">
		<h4>Live races</h4>
		<CivicApiSearch
			{query}
			onapply={(t, raceId, title, subtitle, preselect) =>
				onapplyCivic(t, raceId, title, subtitle, preselect)}
		/>
	</section>

	{#if templateHitCount > 0}
		<section class="group">
			<h4>Templates</h4>
			<TemplateList {query} state={streamState} {highlightedId} {onapply} {onhover} />
		</section>
	{/if}
{:else}
	{#if recentRaces.length > 0}
		<section class="group">
			<h4>Jump back in</h4>
			<ul class="rows">
				{#each recentRaces as row (row.ref.templateId + JSON.stringify(row.ref.parameters) + (row.ref.civicApiRaceId ?? ''))}
					<li>
						<button
							type="button"
							class="row recent-row"
							class:live={!!row.ref.civicApiRaceId}
							onclick={() => onapplyRecent(row.ref, row.template)}
						>
							<span class="row-info">
								<strong>{row.ref.label}</strong>
								<span class="row-sub">{row.ref.subtitle ?? row.template.category}</span>
							</span>
							{#if row.ref.civicApiRaceId}
								<span class="badge live-badge">Live</span>
							{:else}
								<span class="badge template-badge">Template</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if recentStates.length > 0}
		<section class="group">
			<h4>Recent states</h4>
			<div class="chips">
				{#each recentStates as meta (meta.abbr)}
					<button type="button" class="chip" onclick={() => onbrowsestate(meta.abbr)}>
						<span class="chip-abbr">{meta.abbr}</span>
						<span class="chip-name">{meta.name}</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Collapsed by default and placed above the race lists: typing a state
	     name is the faster path, so this is the fallback for when the host
	     wants to see the roster. Expanded inline it is 51 rows, which on a
	     phone is a wall between the live races and everything under them. -->
	<section class="group">
		<PickerCategory
			label="Browse by state"
			count={STATES.length}
			open={stateGridOpen}
			onToggle={() => (stateGridOpen = !stateGridOpen)}
		>
			<div class="state-grid">
				{#each STATES as meta (meta.abbr)}
					<button
						type="button"
						class="chip"
						title={`Browse ${meta.name} races`}
						onclick={() => onbrowsestate(meta.abbr)}
					>
						<span class="chip-abbr">{meta.abbr}</span>
						<span class="chip-name">{meta.name}</span>
					</button>
				{/each}
			</div>
		</PickerCategory>
	</section>

	<section class="group">
		<h4>Happening now</h4>
		<CivicApiSearch
			query=""
			onapply={(t, raceId, title, subtitle, preselect) =>
				onapplyCivic(t, raceId, title, subtitle, preselect)}
		/>
	</section>

	<section class="group">
		<h4>Templates</h4>
		<TemplateList query="" state={streamState} {highlightedId} {onapply} {onhover} />
	</section>
{/if}

<style>
	.group + .group {
		margin-top: 1rem;
	}
	h4 {
		margin: 0 0.25rem 0.35rem;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		border-bottom: 1px solid rgb(from var(--color-secondary) r g b / 0.4);
		padding-bottom: 0.25rem;
	}
	.rows {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		background: var(--color-base-300);
		border: 1px solid transparent;
		border-radius: 0.375rem;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.row:hover {
		border-color: var(--color-primary);
		background: rgb(from var(--color-primary) r g b / 0.12);
	}
	.recent-row.live {
		border-left: 3px solid #16a34a;
	}
	.row-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1 1 auto;
	}
	.row-info strong {
		font-size: 0.85rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-sub {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.row-cue {
		flex-shrink: 0;
		font-size: 0.72rem;
		font-weight: 600;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.row:hover .row-cue {
		color: var(--color-primary);
	}
	.state-abbr {
		flex-shrink: 0;
		width: 2rem;
		text-align: center;
		padding: 0.2rem 0;
		border-radius: 0.25rem;
		background: var(--color-secondary);
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.badge {
		flex-shrink: 0;
		padding: 0.1rem 0.4rem;
		border-radius: 0.2rem;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.live-badge {
		background: #16a34a;
		color: #fff;
	}
	.template-badge {
		background: var(--color-secondary);
		color: var(--color-base-content);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	/* Auto-fit rather than a fixed column count so the 51-entry grid reflows
	   from ~6 columns on the desktop modal down to 2 on a phone without a
	   breakpoint per size. */
	.state-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
		gap: 0.3rem;
	}
	.chip {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		padding: 0.35rem 0.5rem;
		background: var(--color-base-300);
		border: 1px solid transparent;
		border-radius: 0.3rem;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.chip:hover {
		border-color: var(--color-primary);
		background: rgb(from var(--color-primary) r g b / 0.12);
	}
	.chip-abbr {
		flex-shrink: 0;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: rgb(from var(--color-base-content) r g b / 0.75);
	}
	.chip-name {
		font-size: 0.75rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 640px) {
		/* Thumb-sized rows and chips. The picker is the primary navigation
		   surface on a phone, so these are the most-tapped controls in the app. */
		.row {
			min-height: 2.75rem;
		}
		.chip {
			min-height: 2.5rem;
		}
		.state-grid {
			grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
		}
	}
</style>
