<script lang="ts">
	import type { StreamState } from '../stream-state';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();

	// Column set varies by region label (counties carry totalReg; districts and
	// states drop that column since it's not meaningful).
	const label = $derived(state.profile?.geography?.regionLabel ?? 'Regions');
	const showTotalReg = $derived(label === 'Counties');

	function candidateName(id: string | null): string {
		if (!id) return '-';
		return state.candidates.find((c) => c.id === id)?.name ?? id;
	}

	const filtered = $derived.by(() => {
		const q = state.ui.regionsSearch.trim().toLowerCase();
		return q ? state.regions.filter((r) => r.name.toLowerCase().includes(q)) : state.regions;
	});

	const sorted = $derived.by(() => {
		const col = state.ui.regionsSort.col;
		const dir = state.ui.regionsSort.dir === 'desc' ? -1 : 1;
		const rows = [...filtered];
		rows.sort((a, b) => {
			const av = (a as unknown as Record<string, unknown>)[col];
			const bv = (b as unknown as Record<string, unknown>)[col];
			if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
			return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
		});
		return rows;
	});

	const total = $derived(sorted.length);
	const pageSize = $derived(state.ui.regionsPageSize);
	const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	// If the user clicked a region on the map, override the visible page so the
	// resulting row shows up. This is a pure derived — no effect, no writes, so
	// no update-depth loops.
	const forcedPage = $derived.by(() => {
		const attr = state.ui.selectedRegionAttr;
		if (!attr) return null;
		const idx = sorted.findIndex((r) => r.regionAttr === attr);
		if (idx < 0) return null;
		return Math.floor(idx / pageSize) + 1;
	});
	const page = $derived(Math.min(forcedPage ?? state.ui.regionsPage, totalPages));
	const start = $derived((page - 1) * pageSize);
	const rows = $derived(sorted.slice(start, start + pageSize));

	function toggleSort(col: string) {
		if (state.ui.regionsSort.col === col) {
			state.ui.regionsSort.dir = state.ui.regionsSort.dir === 'asc' ? 'desc' : 'asc';
		} else {
			state.ui.regionsSort = { col, dir: 'asc' };
		}
		state.ui.regionsPage = 1;
	}
</script>

<section class="race-card">
	<header class="bar">
		<h3 class="heading">{label}</h3>
		<input
			type="search"
			placeholder={`Search ${label.toLowerCase()}...`}
			bind:value={state.ui.regionsSearch}
			oninput={() => (state.ui.regionsPage = 1)}
		/>
	</header>

	<div class="table" role="table">
		<div class="row head" role="row">
			<button class="col-name" type="button" onclick={() => toggleSort('name')}>
				{label.slice(0, -1)}
			</button>
			<button class="col-leader" type="button" onclick={() => toggleSort('leaderId')}>
				Leader
			</button>
			<button class="col-votes" type="button" onclick={() => toggleSort('votes')}>Votes</button>
			<button class="col-pct" type="button" onclick={() => toggleSort('reportedPct')}>
				Reporting
			</button>
			{#if showTotalReg}
				<button class="col-reg" type="button" onclick={() => toggleSort('totalReg')}>
					Registered
				</button>
			{/if}
		</div>

		{#each rows as r (r.regionAttr)}
			{@const leader = r.leaderId ? state.candidates.find((c) => c.id === r.leaderId) : undefined}
			{@const isSelected = state.ui.selectedRegionAttr === r.regionAttr}
			<button
				type="button"
				class="row row-button"
				class:selected={isSelected}
				role="row"
				onclick={() => {
					state.ui.selectedRegionAttr = isSelected ? null : r.regionAttr;
				}}
			>
				<span class="col-name" class:leader-stripe={leader}>
					{#if leader}
						<span class="stripe" style:background-color={leader.partyColor}></span>
					{/if}
					{r.name}
				</span>
				<span class="col-leader" style:color={leader?.partyColor ?? undefined}>
					{candidateName(r.leaderId)}
				</span>
				<span class="col-votes">{r.votes.toLocaleString()}</span>
				<span class="col-pct">{r.reportedPct.toFixed(1)}%</span>
				{#if showTotalReg}
					<span class="col-reg">{r.totalReg > 0 ? r.totalReg.toLocaleString() : '-'}</span>
				{/if}
			</button>
		{/each}

		{#if rows.length === 0}
			<div class="empty">No {label.toLowerCase()} matching search.</div>
		{/if}
	</div>

	<footer class="pager">
		<span>Page {page} of {totalPages} — {total} {label.toLowerCase()}</span>
		<div class="pager-btns">
			<button
				type="button"
				disabled={page <= 1}
				onclick={() => {
					state.ui.selectedRegionAttr = null;
					state.ui.regionsPage = Math.max(1, page - 1);
				}}
			>
				Prev
			</button>
			<button
				type="button"
				disabled={page >= totalPages}
				onclick={() => {
					state.ui.selectedRegionAttr = null;
					state.ui.regionsPage = Math.min(totalPages, page + 1);
				}}
			>
				Next
			</button>
		</div>
	</footer>
</section>

<style>
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--color-secondary);
		gap: 0.5rem;
	}
	.heading {
		margin: 0;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	input[type='search'] {
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		width: 10rem;
	}
	.table {
		padding: 0;
	}
	.row {
		display: grid;
		grid-template-columns: 1.4fr 1fr auto auto auto;
		gap: 0.75rem;
		padding: 0.375rem 1rem;
		font-size: 0.85rem;
		align-items: center;
	}
	.row.head {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.row.head button {
		background: transparent;
		border: none;
		color: inherit;
		text-transform: uppercase;
		text-align: left;
		cursor: pointer;
		font: inherit;
	}
	.row + .row {
		border-top: 1px solid var(--color-secondary);
	}
	.row-button {
		background: transparent;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		width: 100%;
	}
	.row-button:hover {
		background: rgb(from var(--color-base-content) r g b / 0.03);
	}
	.row.selected {
		background: rgb(from var(--color-primary) r g b / 0.08);
		box-shadow: inset 2px 0 0 var(--color-primary);
	}
	.col-name {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.stripe {
		display: inline-block;
		width: 0.25rem;
		height: 1rem;
		border-radius: 2px;
	}
	.col-votes,
	.col-pct,
	.col-reg {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	/* Phone layout. Five columns plus 0.75rem gutters and 1rem side padding
	   don't fit, and the registration total is the least useful of them
	   during live coverage, so it goes rather than letting the whole table
	   scroll sideways. */
	@media (max-width: 640px) {
		.row {
			grid-template-columns: 1.5fr 1fr auto auto;
			gap: 0.4rem;
			padding-inline: 0.6rem;
			font-size: 0.8rem;
		}
		/* Registration totals are the least useful column during live
		   coverage and the widest after the name, so dropping it buys the
		   room the other four need. Hides the matching header cell too,
		   which carries the same class. */
		.col-reg {
			display: none;
		}
		input[type='search'] {
			width: 100%;
			min-height: 2.25rem;
		}
		.bar {
			flex-wrap: wrap;
			padding-inline: 0.6rem;
		}
	}
	.empty {
		padding: 1rem;
		text-align: center;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		font-size: 0.85rem;
	}
	.pager {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 1rem;
		border-top: 1px solid var(--color-secondary);
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.pager-btns button {
		background: transparent;
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.pager-btns button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
