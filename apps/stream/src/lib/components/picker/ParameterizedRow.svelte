<script lang="ts">
	import type { RaceTemplate } from '../../race-profile';
	import { STATES } from '../../templates/states';
	import { makeStateLegTemplate } from '../../templates/state-leg';
	import { makeUsHouseTemplate } from '../../templates/us-house';

	interface Props {
		kind: 'us-house' | 'state-leg';
		onapply: (template: RaceTemplate) => void;
	}

	let { kind, onapply }: Props = $props();

	// US House state
	let congress = $state(119);
	let houseState = $state('');
	let houseDistrict = $state('');

	// State-leg state
	let legState = $state('');
	let legChamber: 'lower' | 'upper' = $state('lower');
	let legDistrict = $state('');

	const canApplyHouse = $derived(!!houseState && !!houseDistrict);
	const canApplyLeg = $derived(!!legState && !!legChamber && !!legDistrict);

	function applyHouse() {
		if (!canApplyHouse) return;
		onapply(
			makeUsHouseTemplate({
				congress,
				stateAbbr: houseState,
				districtNumber: houseDistrict
			})
		);
	}

	function applyLeg() {
		if (!canApplyLeg) return;
		onapply(
			makeStateLegTemplate({
				stateAbbr: legState,
				chamber: legChamber,
				districtNumber: legDistrict
			})
		);
	}
</script>

{#if kind === 'us-house'}
	<div class="row">
		<label class="field">
			Congress
			<select bind:value={congress}>
				<option value={118}>118</option>
				<option value={119}>119</option>
				<option value={120}>120</option>
			</select>
		</label>
		<label class="field">
			State
			<select bind:value={houseState}>
				<option value="">—</option>
				{#each STATES as s (s.fips)}
					<option value={s.abbr}>{s.abbr}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			District
			<input type="text" bind:value={houseDistrict} placeholder="1, 5, 52..." />
		</label>
		<button type="button" class="apply" disabled={!canApplyHouse} onclick={applyHouse}>
			Apply
		</button>
	</div>
{:else}
	<div class="row">
		<label class="field">
			State
			<select bind:value={legState}>
				<option value="">—</option>
				{#each STATES as s (s.fips)}
					<option value={s.abbr}>{s.abbr}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			Chamber
			<select bind:value={legChamber}>
				<option value="lower">Lower (House)</option>
				<option value="upper">Upper (Senate)</option>
			</select>
		</label>
		<label class="field">
			District
			<input type="text" bind:value={legDistrict} placeholder="1, 7, 42..." />
		</label>
		<button type="button" class="apply" disabled={!canApplyLeg} onclick={applyLeg}> Apply </button>
	</div>
{/if}

<style>
	.row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
		gap: 0.5rem;
		align-items: end;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	select,
	input {
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.25rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.85rem;
	}
	.apply {
		padding: 0.375rem 0.75rem;
		background: var(--color-primary);
		color: var(--color-primary-content);
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
		font-weight: 600;
	}
	.apply:disabled {
		background: var(--color-secondary);
		color: rgb(from var(--color-base-content) r g b / 0.4);
		cursor: not-allowed;
	}
</style>
