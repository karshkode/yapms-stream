<script lang="ts">
	import type { StreamState } from '../stream-state';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();

	const sorted = $derived(
		[...state.candidates].filter((c) => !c.hidden).sort((a, b) => b.votes - a.votes)
	);
	const total = $derived(
		Math.max(
			sorted.reduce((a, c) => a + c.votes, 0),
			1
		)
	);
	// Winner is the leader if called; otherwise leave all rows un-filled.
	const winner = $derived(sorted.find((c) => c.called) ?? null);

	const DEFAULT_INITIAL = 4;
	const visibleRows = $derived(
		state.ui.candidatesExpanded ? sorted : sorted.slice(0, DEFAULT_INITIAL)
	);
	const hiddenCount = $derived(Math.max(sorted.length - DEFAULT_INITIAL, 0));

	const reportedLabel = $derived(
		state.race.reportedPctLabel ??
			(state.race.reportedPct != null ? `${state.race.reportedPct.toFixed(1)}%` : null)
	);
	const reportedPctValue = $derived(state.race.reportedPct ?? 0);
</script>

<section class="race-card">
	<ul class="list">
		{#each visibleRows as c (c.id)}
			{@const pct = (c.votes / total) * 100}
			{@const isWinner = winner?.id === c.id}
			<li
				class="row"
				class:winner={isWinner}
				style:--party-color={c.partyColor}
				style:--winner-bg={isWinner ? c.partyColor : 'transparent'}
			>
				<div class="name-col">
					{#if c.headshotUrl}
						<img class="headshot" src={c.headshotUrl} alt="" />
					{:else}
						<span class="headshot headshot--empty">{c.name.slice(0, 1)}</span>
					{/if}
					<div class="name-stack">
						<span class="name">{c.name}</span>
						{#if c.partyLabel}
							<span class="party">{c.partyLabel}</span>
						{/if}
					</div>
					{#if isWinner}
						<span class="called-check" aria-label="Called">&#10003;</span>
					{/if}
				</div>
				<div class="votes-col">
					<span class="votes">{c.votes.toLocaleString()}</span>
					<span class="pct">{pct.toFixed(1)}%</span>
				</div>
			</li>
		{/each}
	</ul>

	{#if hiddenCount > 0}
		<button
			type="button"
			class="show-more"
			onclick={() => (state.ui.candidatesExpanded = !state.ui.candidatesExpanded)}
		>
			{state.ui.candidatesExpanded
				? 'Collapse'
				: `Show ${hiddenCount} more candidate${hiddenCount === 1 ? '' : 's'}`}
		</button>
	{/if}

	{#if reportedLabel}
		<div class="reported">
			<span class="reported-label">{reportedLabel} reported</span>
			<div class="reported-bar" aria-hidden="true">
				<div class="fill" style:width={`${Math.min(100, reportedPctValue)}%`}></div>
			</div>
		</div>
	{/if}

	{#if state.race.totalVotes != null}
		<div class="total">Total votes: {state.race.totalVotes.toLocaleString()}</div>
	{/if}
</section>

<style>
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 1rem;
		border-left: 4px solid var(--party-color);
		background: transparent;
		transition: background 200ms ease;
	}
	.row + .row {
		border-top: 1px solid var(--color-secondary);
	}
	.row.winner {
		background: color-mix(in srgb, var(--winner-bg) 65%, black);
		border-left-color: transparent;
		color: white;
	}
	.name-col {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}
	.headshot {
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		background: var(--color-secondary);
		object-fit: cover;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 600;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.headshot--empty {
		font-size: 0.9rem;
	}
	.name-stack {
		display: flex;
		flex-direction: column;
		line-height: 1.1;
	}
	.name {
		font-weight: 500;
	}
	.party {
		font-size: 0.7rem;
		opacity: 0.7;
	}
	.called-check {
		color: var(--color-accent);
		font-weight: 700;
		margin-left: 0.5rem;
	}
	.row.winner .called-check {
		color: white;
	}
	.votes-col {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		font-variant-numeric: tabular-nums;
	}
	.votes {
		font-weight: 600;
	}
	.pct {
		font-size: 0.8rem;
		opacity: 0.7;
	}
	.row.winner .pct {
		opacity: 0.85;
	}

	.show-more {
		display: block;
		width: 100%;
		padding: 0.5rem;
		background: transparent;
		border: none;
		border-top: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.show-more:hover {
		background: var(--color-secondary);
	}

	.reported {
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--color-secondary);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.75);
	}
	.reported-bar {
		height: 6px;
		background: var(--color-secondary);
		border-radius: 3px;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--color-accent);
		transition: width 300ms ease;
	}

	.total {
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--color-secondary);
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.65);
	}
</style>
