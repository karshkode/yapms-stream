<script lang="ts">
	import type { RaceTemplate } from '../../race-profile';
	import type { SearchHit } from '../../picker/searchIndex';
	import { searchTemplates } from '../../picker/searchIndex';
	import type { StreamState } from '../../stream-state';
	import { ALL_TEMPLATES } from '../../templates';
	import ParameterizedRow from './ParameterizedRow.svelte';
	import PickerCategory from './PickerCategory.svelte';
	import PickerResultRow from './PickerResultRow.svelte';
	import SvgPicker from './SvgPicker.svelte';

	/**
	 * The static-template corpus, and only that: ranked hits while the host is
	 * searching, collapsible categories when they aren't. Recent races and the
	 * live civicAPI tier used to be stitched in here too, which meant the same
	 * recent list rendered in three places; both now live in FindRace, which
	 * composes this component as one section of the unified results.
	 */

	interface Props {
		query: string;
		state: StreamState;
		highlightedId: string | null;
		onapply: (template: RaceTemplate) => void;
		onhover: (templateId: string | null) => void;
	}

	let { query, state, highlightedId, onapply, onhover }: Props = $props();

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
			// The category id still says "no map" because it predates any local
			// race having one; the group now also holds the city maps, so the
			// heading says what's in it rather than what the id is called.
			label: 'Local & municipal',
			filter: (t) => t.category === 'local-no-map'
		},
		{
			id: 'custom',
			label: 'Custom SVG (advanced)',
			filter: () => false
		}
	];

	const hits = $derived<SearchHit[]>(query ? searchTemplates(query, 60) : []);

	// Every category starts collapsed. `statewide-primary` used to default open,
	// which meant the browse view opened with 51 statewide-primary rows — the
	// least specific thing on offer — burying the recents and live races that
	// FindRace lists above it. The counts on the headers make the corpus
	// discoverable without spending the whole viewport on it.
	function expanded(id: string): boolean {
		return state.ui.pickerExpanded[id] ?? false;
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
			<p class="empty">No templates match '{query}'.</p>
		{/if}
	</div>
{:else}
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
	.empty {
		padding: 0.75rem 0.5rem;
		font-size: 0.85rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
</style>
