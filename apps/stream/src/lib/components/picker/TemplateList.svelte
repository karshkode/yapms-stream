<script lang="ts">
	import type { RaceTemplate } from '../../race-profile';
	import type { SearchHit } from '../../picker/searchIndex';
	import { searchTemplates } from '../../picker/searchIndex';
	import type { RecentRaceRef, StreamState } from '../../stream-state';
	import { ALL_TEMPLATES, hydrateTemplateById } from '../../templates';
	import ParameterizedRow from './ParameterizedRow.svelte';
	import PickerCategory from './PickerCategory.svelte';
	import PickerResultRow from './PickerResultRow.svelte';
	import SvgPicker from './SvgPicker.svelte';
	import CivicApiSearch from './CivicApiSearch.svelte';

	interface Props {
		query: string;
		state: StreamState;
		highlightedId: string | null;
		onapply: (template: RaceTemplate) => void;
		/** Called when the host picks a civicAPI row; same semantics as the
		 * civicAPI tab's onapply — hands back the template + civicAPI race id
		 * for polling. Left optional so existing callers (e.g. the /picker
		 * page) still compile. */
		onapplyCivic?: (
			template: RaceTemplate,
			civicApiRaceId: string,
			title?: string,
			subtitle?: string,
			// Fuzzy-matched county name so the parent can auto-zoom the
			// stage to that county on apply. See civicapiResolver.ts.
			preselectCountyName?: string | null
		) => void;
		/** Called when the host re-loads a Recent row. For civicAPI-backed
		 * recents we plumb the raceId / title through so polling resumes
		 * against the original race. Optional — callers that don't care
		 * just pass nothing and we fall back to `onapply`. */
		onapplyRecent?: (ref: RecentRaceRef, template: RaceTemplate) => void;
		onhover: (templateId: string | null) => void;
	}

	let {
		query,
		state,
		highlightedId,
		onapply,
		onapplyCivic,
		onapplyRecent,
		onhover
	}: Props = $props();

	const CATEGORY_ORDER: Array<{
		id: string;
		label: string;
		filter: (t: RaceTemplate) => boolean;
	}> = [
		{
			id: 'statewide-primary',
			label: 'State-wide partisan primaries',
			filter: (t) => t.category === 'statewide-primary'
		},
		{
			id: 'us-wide',
			label: 'US-wide (President, Senate, Governors)',
			filter: (t) => t.category === 'us-wide'
		},
		{
			id: 'us-house',
			label: 'US House districts (parameterized)',
			filter: (t) => t.id === 'us-house-generic'
		},
		{
			id: 'state-leg',
			label: 'State legislative (parameterized)',
			filter: (t) => t.id === 'state-leg-generic'
		},
		{
			id: 'local-no-map',
			label: 'Local / no map',
			filter: (t) => t.category === 'local-no-map'
		},
		{
			id: 'custom',
			label: 'Custom SVG (advanced)',
			filter: () => false
		}
	];

	const hits = $derived<SearchHit[]>(query ? searchTemplates(query, 60) : []);
	const flatHits = $derived(hits.map((h) => h.template));

	// Hydrate each Recent entry's template. Uses `hydrateTemplateById` instead
	// of a direct map lookup so parameterized ids (us-house-119-TX-15,
	// state-leg-lower-FL-43, ...) round-trip correctly — otherwise the host
	// loads TX-15 via civicAPI, refreshes the page, and the Recent list
	// silently drops the entry because TEMPLATES_BY_ID doesn't know about
	// concrete parameterized instances.
	const recentHydrated = $derived(
		state.savedRaces.recent
			.map((r) => ({ ref: r, template: hydrateTemplateById(r.templateId) }))
			.filter((r) => r.template !== null) as {
			ref: (typeof state.savedRaces.recent)[number];
			template: RaceTemplate;
		}[]
	);

	function expanded(id: string): boolean {
		return state.ui.pickerExpanded[id] ?? id === 'statewide-primary';
	}
	function toggle(id: string) {
		state.ui.pickerExpanded[id] = !expanded(id);
	}
</script>

{#if query}
	<!-- Flat ranked hits when the host is searching. -->
	<div class="hits" onmouseleave={() => onhover(null)} role="listbox" tabindex="-1">
		{#each hits as hit (hit.template.id)}
			<div
				onmouseenter={() => onhover(hit.template.id)}
				role="option"
				tabindex="-1"
				aria-selected={highlightedId === hit.template.id}
			>
				<PickerResultRow
					template={hit.template}
					matchedTokens={hit.matched}
					highlighted={highlightedId === hit.template.id}
					onload={() => onapply(hit.template)}
				/>
			</div>
		{/each}
		{#if hits.length === 0}
			<p class="empty">No templates match '{query}'. Try civicAPI or Custom SVG.</p>
		{/if}
	</div>
{:else}
	<!-- Empty-query: civicAPI upcoming + recent + collapsible categories. -->
	{#if recentHydrated.length > 0}
		<div class="recent">
			<h4>Recent</h4>
			{#each recentHydrated as row (row.ref.templateId + JSON.stringify(row.ref.parameters) + (row.ref.civicApiRaceId ?? ''))}
				<button
					type="button"
					class="recent-row"
					class:live={!!row.ref.civicApiRaceId}
					onclick={() =>
						onapplyRecent
							? onapplyRecent(row.ref, row.template)
							: onapply(row.template)}
				>
					<div class="recent-info">
						<strong>{row.ref.label}</strong>
						{#if row.ref.subtitle}
							<span class="recent-sub">{row.ref.subtitle}</span>
						{:else}
							<span class="recent-sub">{row.template.category}</span>
						{/if}
					</div>
					{#if row.ref.civicApiRaceId}
						<span class="badge live-badge">Live</span>
					{:else}
						<span class="badge archival-badge">Template</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	{#if onapplyCivic}
		<!-- Tiered discovery: upcoming civicAPI races up top so the picker
		     answers "what's happening right now?" without the host having to
		     swap tabs. Falls through silently on civicAPI errors. -->
		<div class="civic-tier">
			<h4>Upcoming (civicAPI)</h4>
			<CivicApiSearch
				query=""
				onapply={(t, raceId, title, subtitle, preselect) =>
					onapplyCivic(t, raceId, title, subtitle, preselect)}
			/>
		</div>
	{/if}

	{#each CATEGORY_ORDER as cat (cat.id)}
		{@const items = ALL_TEMPLATES.filter(cat.filter)}
		<PickerCategory
			label={cat.label}
			count={cat.id === 'us-house' || cat.id === 'state-leg' || cat.id === 'custom'
				? 0
				: items.length}
			open={expanded(cat.id)}
			onToggle={() => toggle(cat.id)}
		>
			{#if cat.id === 'us-house'}
				<ParameterizedRow kind="us-house" {onapply} />
			{:else if cat.id === 'state-leg'}
				<ParameterizedRow kind="state-leg" {onapply} />
			{:else if cat.id === 'custom'}
				<SvgPicker {onapply} />
			{:else}
				{#each items as t (t.id)}
					<PickerResultRow template={t} onload={() => onapply(t)} />
				{/each}
			{/if}
		</PickerCategory>
	{/each}
{/if}

<style>
	.hits {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.recent,
	.civic-tier {
		margin-bottom: 0.75rem;
	}
	.recent h4,
	.civic-tier h4 {
		margin: 0.25rem 0.5rem 0.25rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.recent-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		background: var(--color-base-300);
		border: 1px solid transparent;
		border-radius: 0.375rem;
		color: inherit;
		cursor: pointer;
		font: inherit;
		text-align: left;
		margin-bottom: 0.25rem;
	}
	.recent-row:hover {
		border-color: var(--color-primary);
		background: rgb(from var(--color-primary) r g b / 0.12);
	}
	.recent-row.live {
		border-left: 3px solid #16a34a;
	}
	.recent-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.recent-info strong {
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.recent-sub {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.badge {
		padding: 0.1rem 0.4rem;
		border-radius: 0.2rem;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		flex-shrink: 0;
	}
	.live-badge {
		background: #16a34a;
		color: #fff;
	}
	.archival-badge {
		background: var(--color-secondary);
		color: var(--color-base-content);
	}
	.empty {
		padding: 0.75rem 0.5rem;
		font-size: 0.85rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
</style>
