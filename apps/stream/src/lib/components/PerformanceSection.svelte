<script lang="ts">
	import type { StreamState } from '../stream-state';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();
</script>

<section class="race-card">
	<h3 class="heading">Performance</h3>
	<div class="table" role="table">
		<div class="row head" role="row">
			<span class="col-race">Race</span>
			<span class="col-margin">Margin</span>
			<span class="col-shift">Shift</span>
		</div>
		{#each state.performance as row, i (i)}
			<div class="row" role="row">
				<span class="col-race">
					<span class="badge" style:background-color={row.marginColor} aria-hidden="true">
						{row.partyBadge}
					</span>
					{row.raceName}
				</span>
				<span class="col-margin" style:color={row.marginColor}>{row.marginLabel}</span>
				<span class="col-shift">{row.shiftLabel}</span>
			</div>
		{/each}
	</div>
</section>

<style>
	.heading {
		margin: 0;
		padding: 0.75rem 1rem;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgb(from var(--color-base-content) r g b / 0.7);
		border-bottom: 1px solid var(--color-secondary);
	}
	.table {
		padding: 0 0.5rem;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.5rem 0.5rem;
		font-size: 0.85rem;
	}
	.row.head {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.row + .row {
		border-top: 1px solid var(--color-secondary);
	}
	.col-race {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border-radius: 999px;
		color: white;
		font-weight: 700;
		font-size: 0.625rem;
	}
	.col-margin {
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}
	.col-shift {
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}
</style>
