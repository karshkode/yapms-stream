<script lang="ts">
	import { streamStore } from '$lib/stream-store.svelte';

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
		const totalFromDict = Object.values(region.candidateVotes ?? {}).reduce(
			(a, v) => a + v,
			0
		);
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
		!!region &&
			Object.values(region.candidateVotes ?? {}).reduce((a, v) => a + v, 0) > 0
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

	// Swing vs the selected baseline year. Positive = shifted toward R since
	// that cycle. Only meaningful once live reporting exists for this region
	// AND we have an archival snapshot to compare against.
	let swing = $derived.by(() => {
		if (!region || region.reportedPct === 0) return null;
		if (!archival) return null;
		if (region.votes === 0) return null;
		if (state.candidates.length !== 2) return null;
		const leaderCand = state.candidates.find((c) => c.id === region.leaderId);
		if (!leaderCand) return null;
		const runnerUp = state.candidates.find((c) => c.id !== region.leaderId);
		if (!runnerUp) return null;
		const twoParty = leaderCand.votes + runnerUp.votes;
		if (twoParty === 0) return null;
		const liveMargin = ((leaderCand.votes - runnerUp.votes) / twoParty) * 100;
		const leaderIsR = isRedParty(leaderCand.partyColor);
		const liveRMargin = leaderIsR ? liveMargin : -liveMargin;
		const shift = liveRMargin - archival.margin;
		const towardR = shift > 0;
		return {
			shift,
			label: `${towardR ? 'R' : 'D'} +${Math.abs(shift).toFixed(1)} pts`,
			color: towardR ? '#BF1D29' : '#1375B7'
		};
	});

	function isRedParty(color: string): boolean {
		const h = color.replace('#', '').toLowerCase();
		if (h.length < 6) return false;
		const r = parseInt(h.slice(0, 2), 16);
		const g = parseInt(h.slice(2, 4), 16);
		const b = parseInt(h.slice(4, 6), 16);
		return r > b && r > g;
	}

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
				{#if swing}
					<p class="swing">
						<span class="swing-arrow" style:color={swing.color}>
							{swing.shift > 0 ? '▲' : '▼'}
						</span>
						Swing vs {archival?.year}: <strong style:color={swing.color}>{swing.label}</strong>
					</p>
				{/if}
			</section>
		{:else if region.reportedPct === 0 && archival}
			<section class="live muted">
				<div class="section-head">No reporting yet</div>
				<p class="leader-row">Showing {archival.year} presidential baseline below.</p>
			</section>
		{/if}

		{#if archival}
			<section class="archival-section">
				<div class="section-head">
					{archival.year} Presidential
					{#if archivalSourceNote}
						<span class="source-note">{archivalSourceNote}</span>
					{/if}
					{#if archival.label}
						<span
							class="margin-chip"
							style:background-color={archival.color ?? '#555'}
						>
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
	.swing {
		margin: 0.5rem 0 0;
		font-size: 0.8rem;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
	.swing-arrow {
		font-size: 0.75rem;
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
