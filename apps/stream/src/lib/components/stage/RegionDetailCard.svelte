<script lang="ts">
	import { streamStore } from '$lib/stream-store.svelte';
	import { regionSwing, regionTurnoutIndex, resolveBaseline, turnoutScale } from '$lib/map/metrics';
	import { activeHistoryRace } from '$lib/map/office-history.svelte';

	interface Props {
		onclose: () => void;
		interactive?: boolean;
	}

	let { onclose, interactive = true }: Props = $props();

	// RegionDetailCard reaches into the app-level streamStore singleton rather
	// than accepting the whole StreamState through a prop — Svelte 5 flags
	// cross-component $state mutation otherwise, and this card genuinely owns
	// no state of its own. Both /control and /overlay drive the same singleton
	// (overlay via broadcast sync) so the card works on both surfaces.
	const state = $derived(streamStore.state);

	// Candidate nominee names per cycle — only used for the archival bar rows,
	// which we rename from "Trump (R) / Biden (D)" to match whichever election
	// the slider is pointing at. Keeps the card honest when the host scrubs
	// back to 2008/2012.
	const NOMINEES: Record<string, { r: string; d: string }> = {
		'2008': { r: 'McCain', d: 'Obama' },
		'2012': { r: 'Romney', d: 'Obama' },
		'2016': { r: 'Trump', d: 'Clinton' },
		'2020': { r: 'Trump', d: 'Biden' },
		'2024': { r: 'Trump', d: 'Harris' }
	};

	// The active region's result row — `selectedRegionAttr` can be stale after
	// a template swap, so we resolve lazily and render nothing if it has no
	// match rather than throwing.
	let region = $derived(
		state.ui.selectedRegionAttr
			? (state.regions.find((r) => r.regionAttr === state.ui.selectedRegionAttr) ?? null)
			: null
	);

	let leader = $derived(
		region?.leaderId ? (state.candidates.find((c) => c.id === region?.leaderId) ?? null) : null
	);

	// Per-candidate vote rows for this region. We prefer the region's own
	// `candidateVotes` dict when civicAPI provided it (e.g. every AR county has
	// per-candidate splits), so each candidate's bar reflects their actual
	// performance in THIS county/district. When the dict is empty — archival
	// snapshots, or civicAPI races that only carry leader tallies — we degrade
	// gracefully to zeroes while still listing every candidate in the race so
	// the host has a full visual roster to talk to.
	interface CandidateRow {
		id: string;
		name: string;
		partyColor: string;
		partyLabel: string;
		votes: number;
		pct: number;
		isLeader: boolean;
		called: boolean;
	}

	let regionCandidates = $derived.by<CandidateRow[]>(() => {
		if (!region) return [];
		const visible = state.candidates.filter((c) => !c.hidden);
		if (visible.length === 0) return [];
		const totalFromDict = Object.values(region.candidateVotes ?? {}).reduce((a, v) => a + v, 0);
		const hasRegionSplit = totalFromDict > 0;
		const denom = hasRegionSplit ? totalFromDict : 0;
		return visible
			.map((c): CandidateRow => {
				const votes = hasRegionSplit ? (region.candidateVotes[c.id] ?? 0) : 0;
				return {
					id: c.id,
					name: c.name,
					partyColor: c.partyColor,
					partyLabel: c.partyLabel ?? '',
					votes,
					pct: denom > 0 ? (votes / denom) * 100 : 0,
					isLeader: region.leaderId === c.id,
					called: c.called
				};
			})
			.sort((a, b) => b.votes - a.votes);
	});

	let hasRegionSplit = $derived(
		!!region && Object.values(region.candidateVotes ?? {}).reduce((a, v) => a + v, 0) > 0
	);

	// Year snapshot to display in the archival section. Defaults to 2024 when
	// the slider is on "Live" but we still want to show context for an
	// unreported region; hidden entirely if there's no snapshot for any year.
	let displayYear = $derived(state.ui.archivalYear ?? '2024');

	let archival = $derived.by(() => {
		if (!region) return null;
		const snap = region.archivalByYear?.[displayYear];
		if (!snap) return null;
		const total = snap.votesTotal || snap.votesRep + snap.votesDem;
		return {
			year: displayYear,
			rep: snap.votesRep,
			dem: snap.votesDem,
			total,
			repPct: total > 0 ? (snap.votesRep / total) * 100 : 0,
			demPct: total > 0 ? (snap.votesDem / total) * 100 : 0,
			label: snap.label,
			color: snap.color,
			margin: snap.margin
		};
	});

	let nominees = $derived(NOMINEES[displayYear] ?? NOMINEES['2024']);

	// This county's line in the past same-office race, when that's what the
	// comparison is set to. Shown in place of the presidential default below,
	// because it's the race the swing on this card is measured against — the
	// presidential numbers alongside a Senate swing invite reading one as the
	// other. Scrubbing the archival slider is an explicit ask for the
	// presidential figures, so that still wins.
	let history = $derived.by(() => {
		if (!region || state.ui.archivalYear) return null;
		const race = activeHistoryRace(state);
		const snap = race?.regions[region.regionAttr];
		if (!race || !snap) return null;
		// Every candidate's votes, not just the top two, so these percentages are
		// shares of the electorate and agree with what the turnout mode divides by.
		const total = snap.votesTotal || snap.votesRep + snap.votesDem;
		// A race the bake flagged non-partisan is two candidates of the same party
		// (California's top-two Senate races) or one whose source carried no party
		// at all. `votesRep` is then just the side the margin is positive for, so
		// painting it red and labelling it (R) would state something false.
		const rows = [
			{
				name: race.candRep,
				party: race.partisan ? 'R' : '',
				color: race.partisan ? '#BF1D29' : '#8a8a94',
				votes: snap.votesRep
			},
			{
				name: race.candDem,
				party: race.partisan ? 'D' : '',
				color: race.partisan ? '#1375B7' : '#5c5c66',
				votes: snap.votesDem
			}
		].map((row) => ({ ...row, pct: total > 0 ? (row.votes / total) * 100 : 0 }));
		return { label: race.label, total, rows, marginLabel: snap.label, color: snap.color };
	});

	// Comparison figures against whichever baseline the Compare panel selected —
	// the same numbers the map is shaded with, from the same functions, so the
	// card and the county under the cursor can't disagree.
	//
	// These used to be computed here from `state.candidates`, which are the
	// race-wide totals: every county reported the same swing, and it was the
	// statewide one.
	let baseline = $derived(resolveBaseline(state));
	let scale = $derived(turnoutScale(state.regions, baseline));

	let swing = $derived.by(() => {
		if (!region) return null;
		const shift = regionSwing(region, state.candidates, baseline);
		if (shift === null) return null;
		const towardR = shift > 0;
		return {
			shift,
			label: `${towardR ? 'R' : 'D'} +${Math.abs(shift).toFixed(1)} pts`,
			color: towardR ? '#BF1D29' : '#1375B7'
		};
	});

	// Share of the race's projected vote against the baseline's share for the
	// same region. This is the primary-to-general read: a county well above 0
	// is turning out harder relative to the rest of the map than it did last
	// time, whoever it's turning out for.
	let turnout = $derived.by(() => {
		if (!region) return null;
		const index = regionTurnoutIndex(region, scale, baseline);
		if (index === null) return null;
		const pct = (index - 1) * 100;
		return {
			pct,
			label: `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}% of the vote`,
			color: pct > 0 ? '#0d9488' : '#b45309'
		};
	});

	function fmtNum(n: number | null | undefined): string {
		if (n == null) return '—';
		return n.toLocaleString();
	}

	// When the slider is on "Live", we still want to surface historical context
	// for unreported regions — so the archival block is always visible when
	// data exists, but its heading clarifies whether the host explicitly
	// selected that year or we're just using it as a default.
	let archivalSourceNote = $derived(
		state.ui.archivalYear ? null : '(default baseline — slider on Live)'
	);
</script>

{#if region}
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
	<aside class="region-card" role="dialog" aria-label={`${region.name} detail`}>
		<header>
			<div>
				<h3>{region.name}</h3>
				<p class="sub">
					{state.race.title || 'Race'}
				</p>
			</div>
			{#if interactive}
				<button type="button" class="close" aria-label="Close detail" onclick={onclose}
					>&times;</button
				>
			{/if}
		</header>

		<dl class="stats">
			<div>
				<dt>Reg. voters</dt>
				<dd>{fmtNum(region.totalReg)}</dd>
			</div>
			<div>
				<dt>Reporting</dt>
				<dd>{region.reportedPct.toFixed(1)}%</dd>
			</div>
			<div>
				<dt>Votes in</dt>
				<dd>{fmtNum(region.votes)}</dd>
			</div>
		</dl>

		{#if regionCandidates.length > 0}
			<section class="live">
				<div class="section-head">
					{#if hasRegionSplit}
						Candidates in {region.name}
					{:else if leader}
						<span class="dot" style:background-color={leader.partyColor}></span>
						Live leader — {leader.name}
					{:else}
						Candidates
						<span class="source-note">(no reporting yet)</span>
					{/if}
				</div>
				<ul class="cand-list">
					{#each regionCandidates as c (c.id)}
						<li class="cand-row" class:leader={c.isLeader}>
							<div class="row-head">
								<span class="name">
									<span class="dot" style:background-color={c.partyColor}></span>
									<strong>{c.name}</strong>
									{#if c.partyLabel}
										<span class="party">({c.partyLabel})</span>
									{/if}
									{#if c.called}
										<span class="called-chip">Winner</span>
									{/if}
								</span>
								<span class="pct">{hasRegionSplit ? `${c.pct.toFixed(1)}%` : '—'}</span>
							</div>
							<div class="bar-track">
								<div
									class="bar-fill"
									style:width="{hasRegionSplit ? c.pct : 0}%"
									style:background-color={c.partyColor}
								></div>
							</div>
							<div class="row-foot">{fmtNum(c.votes)} votes</div>
						</li>
					{/each}
				</ul>
				{#if swing || turnout}
					<div class="compare">
						{#if swing}
							<p class="swing">
								<span class="swing-arrow" style:color={swing.color}>
									{swing.shift > 0 ? '▲' : '▼'}
								</span>
								Swing: <strong style:color={swing.color}>{swing.label}</strong>
							</p>
						{/if}
						{#if turnout}
							<p class="swing">
								<span class="swing-arrow" style:color={turnout.color}>
									{turnout.pct > 0 ? '▲' : '▼'}
								</span>
								Turnout: <strong style:color={turnout.color}>{turnout.label}</strong>
							</p>
						{/if}
						<!-- Naming the baseline on the card matters more than it looks:
						     "R +4" against last year's primary and against the 2024
						     presidential are different claims, and only one of them
						     is safe to say on air. -->
						<p class="compare-src">vs {baseline?.label}</p>
					</div>
				{/if}
			</section>
		{:else if region.reportedPct === 0 && (history || archival)}
			<section class="live muted">
				<div class="section-head">No reporting yet</div>
				<p class="leader-row">
					Showing the {history ? history.label : `${archival?.year} presidential`} result below.
				</p>
			</section>
		{/if}

		{#if history}
			<section class="archival-section">
				<div class="section-head">
					{history.label}
					{#if history.marginLabel}
						<span class="margin-chip" style:background-color={history.color ?? '#555'}>
							{history.marginLabel}
						</span>
					{/if}
				</div>
				<ul class="bars">
					{#each history.rows as row (row.name)}
						<li>
							<div class="row-head">
								<span class="name" style:color={row.color}>
									{row.name}{row.party ? ` (${row.party})` : ''}
								</span>
								<span class="pct">{row.pct.toFixed(1)}%</span>
							</div>
							<div class="bar-track">
								<div
									class="bar-fill"
									style:width="{row.pct}%"
									style:background-color={row.color}
								></div>
							</div>
							<div class="row-foot">{fmtNum(row.votes)} votes</div>
						</li>
					{/each}
				</ul>
				<p class="total">Total: {fmtNum(history.total)} votes cast</p>
			</section>
		{:else if archival}
			<section class="archival-section">
				<div class="section-head">
					{archival.year} Presidential
					{#if archivalSourceNote}
						<span class="source-note">{archivalSourceNote}</span>
					{/if}
					{#if archival.label}
						<span class="margin-chip" style:background-color={archival.color ?? '#555'}>
							{archival.label}
						</span>
					{/if}
				</div>
				<ul class="bars">
					<li>
						<div class="row-head">
							<span class="name" style:color="#BF1D29">{nominees.r} (R)</span>
							<span class="pct">{archival.repPct.toFixed(1)}%</span>
						</div>
						<div class="bar-track">
							<div
								class="bar-fill"
								style:width="{archival.repPct}%"
								style:background-color="#BF1D29"
							></div>
						</div>
						<div class="row-foot">{fmtNum(archival.rep)} votes</div>
					</li>
					<li>
						<div class="row-head">
							<span class="name" style:color="#1375B7">{nominees.d} (D)</span>
							<span class="pct">{archival.demPct.toFixed(1)}%</span>
						</div>
						<div class="bar-track">
							<div
								class="bar-fill"
								style:width="{archival.demPct}%"
								style:background-color="#1375B7"
							></div>
						</div>
						<div class="row-foot">{fmtNum(archival.dem)} votes</div>
					</li>
				</ul>
				<p class="total">Total: {fmtNum(archival.total)} votes cast ({archival.year})</p>
			</section>
		{:else}
			<p class="no-data">No {displayYear} baseline available for this region.</p>
		{/if}
	</aside>
{/if}

<style>
	.region-card {
		background: rgb(from var(--color-base-100) r g b / 0.96);
		backdrop-filter: blur(8px);
		border: 1px solid var(--color-secondary);
		border-radius: 0.5rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		padding: 1rem;
		min-width: 20rem;
		max-width: 24rem;
		color: var(--color-base-content);
		font-size: 0.875rem;
	}
	/* The 20rem floor is wider than a 390px phone, so the card would push
	   past the screen edge. Fill the bottom sheet instead. */
	@media (max-width: 640px) {
		.region-card {
			min-width: 0;
			max-width: none;
			width: 100%;
			border: none;
			border-radius: 0;
			padding: 0.75rem;
		}
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	header h3 {
		margin: 0;
		font-size: 1.125rem;
	}
	.sub {
		margin: 0.125rem 0 0;
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.close {
		background: transparent;
		border: none;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.25rem;
	}
	.close:hover {
		color: var(--color-base-content);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.375rem;
		margin: 0 0 0.75rem;
	}
	.stats > div {
		background: rgb(from var(--color-base-200) r g b / 0.7);
		border-radius: 0.25rem;
		padding: 0.375rem 0.5rem;
	}
	.stats dt {
		margin: 0;
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.stats dd {
		margin: 0.125rem 0 0;
		font-size: 0.85rem;
		font-weight: 600;
	}
	section {
		margin-bottom: 0.75rem;
	}
	.section-head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgb(from var(--color-base-content) r g b / 0.65);
		margin-bottom: 0.375rem;
		font-weight: 600;
	}
	.source-note {
		font-size: 0.6rem;
		text-transform: none;
		letter-spacing: 0;
		color: rgb(from var(--color-base-content) r g b / 0.45);
		font-weight: 400;
		font-style: italic;
	}
	.margin-chip {
		margin-left: auto;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.7rem;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 700;
		color: #fff;
	}
	.live {
		background: rgb(from var(--color-base-200) r g b / 0.5);
		border-left: 3px solid var(--color-primary);
		padding: 0.5rem 0.625rem;
		border-radius: 0.25rem;
	}
	.live.muted {
		border-left-color: rgb(from var(--color-base-content) r g b / 0.3);
		color: rgb(from var(--color-base-content) r g b / 0.75);
		font-style: italic;
	}
	.leader-row {
		margin: 0;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}
	.cand-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.cand-row {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.35rem 0.4rem;
		border-radius: 0.25rem;
		background: rgb(from var(--color-base-100) r g b / 0.5);
		border: 1px solid transparent;
	}
	.cand-row.leader {
		background: rgb(from var(--color-base-100) r g b / 0.9);
		border-color: rgb(from var(--color-primary) r g b / 0.5);
	}
	.cand-row .name {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
	}
	.cand-row .party {
		color: rgb(from var(--color-base-content) r g b / 0.55);
		font-size: 0.7rem;
		font-weight: 400;
	}
	.called-chip {
		background: var(--color-primary, #1f8a3a);
		color: #fff;
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.05rem 0.3rem;
		border-radius: 0.2rem;
		font-weight: 700;
	}
	.compare {
		margin-top: 0.5rem;
		padding-top: 0.4rem;
		border-top: 1px solid rgb(from var(--color-secondary) r g b / 0.35);
	}
	.swing {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	.swing-arrow {
		font-size: 0.75rem;
	}
	.compare-src {
		margin: 0.25rem 0 0;
		font-size: 0.65rem;
		font-style: italic;
		color: rgb(from var(--color-base-content) r g b / 0.5);
	}
	.dot {
		display: inline-block;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.bars {
		list-style: none;
		padding: 0;
		margin: 0 0 0.375rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.bars li {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.row-head {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		font-weight: 600;
	}
	.row-foot {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.bar-track {
		background: rgb(from var(--color-base-300) r g b / 0.5);
		height: 0.5rem;
		border-radius: 0.125rem;
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		transition: width 0.2s ease;
	}
	.total {
		margin: 0.25rem 0 0;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.55);
		text-align: right;
	}
	.no-data {
		margin: 0;
		font-size: 0.8rem;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		font-style: italic;
	}
</style>
