<script lang="ts">
	import { listAvailableSvgs } from '../../map/load-svg';
	import type { RaceTemplate } from '../../race-profile';

	interface Props {
		onapply: (template: RaceTemplate) => void;
	}

	let { onapply }: Props = $props();

	const all = listAvailableSvgs();
	let search = $state('');
	const filtered = $derived(
		search.trim().length > 0
			? all.filter((p) => p.toLowerCase().includes(search.trim().toLowerCase()))
			: all.slice(0, 50)
	);

	function applyCustom(svgPath: string) {
		const template: RaceTemplate = {
			id: `custom-${svgPath}`,
			name: `Custom: ${svgPath}`,
			category: 'custom',
			tags: [svgPath],
			profile: {
				id: `custom-${svgPath}`,
				label: svgPath,
				category: 'custom',
				geography: {
					svgPath,
					filterAttr: null,
					filterValue: null,
					regionLabel: 'Districts'
				},
				sections: {
					header: true,
					candidates: true,
					performance: false,
					geography: true,
					regions: false
				},
				subTabs: ['Results'],
				expectedCandidates: [2, 6]
			},
			seed: {
				title: 'Custom SVG race',
				candidates: [],
				regions: [],
				performance: []
			}
		};
		onapply(template);
	}
</script>

<div class="svg-picker">
	<input type="search" placeholder="Filter SVG filename..." bind:value={search} />
	<p class="hint">
		Power-user fallback for races nobody templated. Picking an SVG stamps a minimal profile — the
		host enters candidates, region results, and meta from scratch.
	</p>
	<div class="list">
		{#each filtered as svg (svg)}
			<button type="button" class="svg-row" onclick={() => applyCustom(svg)}>
				{svg}
			</button>
		{/each}
		{#if filtered.length === 0}
			<p class="empty">No match for '{search}'</p>
		{/if}
	</div>
</div>

<style>
	.svg-picker {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	input {
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.375rem 0.5rem;
		border-radius: 0.25rem;
	}
	.hint {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		margin: 0;
	}
	.list {
		max-height: 16rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}
	.svg-row {
		padding: 0.25rem 0.5rem;
		background: transparent;
		border: none;
		color: var(--color-base-content);
		text-align: left;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		cursor: pointer;
		border-radius: 0.25rem;
	}
	.svg-row:hover {
		background: var(--color-base-300);
	}
	.empty {
		padding: 0.5rem;
		color: rgb(from var(--color-base-content) r g b / 0.5);
	}
</style>
