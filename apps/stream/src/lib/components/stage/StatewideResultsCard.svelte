<script lang="ts">
	import { streamStore } from '$lib/stream-store.svelte';

	interface Props {
		/**
		 * When false (overlay/OBS mirror), hide the dismiss / collapse control.
		 * The card itself stays visible so the OBS scene still shows the race
		 * summary — the host just can't interact with it.
		 */
		interactive?: boolean;
		/**
		 * True when the card is rendered in the stage's results rail rather than
		 * as a floating corner overlay. The corner-cycle button is meaningless
		 * there, so it's not rendered — the dock has no corners to move between.
		 */
		docked?: boolean;
	}
	let { interactive = true, docked = false }: Props = $props();

	// Named `streamState` rather than `state`: a local `state` binding makes
	// Svelte 5 read every `$state(...)` in the file as a store subscription on
	// it, which is what made `collapsed` below fail to type-check. Same naming
	// the rest of the stage components use.
	const streamState = $derived(streamStore.state);

	// Single source of truth for the statewide candidate tally. We prefer
	// `streamState.candidates[].votes` because civicAPI top-level race data already
	// carries the rolled-up totals per candidate — we don't need to sum the
	// per-county dicts ourselves. When reporting hasn't started (all zeroes)
	// we still list every candidate so the host has a full roster to talk
	// to instead of an empty panel.
	interface CandidateRow {
		id: string;
		name: string;
		partyColor: string;
		partyLabel: string;
		votes: number;
		pct: number;
		isLeader: boolean;
		called: boolean;
		headshotUrl: string | null;
		/** Market probability 0-1, or null when this race has no market. */
		market: number | null;
		/** Polling average as a percentage, or null. */
		poll: number | null;
	}

	// Keyed lookups so each row costs one map read rather than a scan of the
	// market's outcomes and the poll averages.
	let marketById = $derived(
		new Map(
			(streamState.ui.insights.data?.market?.outcomes ?? [])
				.filter((o) => o.candidateId)
				.map((o) => [o.candidateId as string, o.probability])
		)
	);
	let pollById = $derived(
		new Map(
			(streamState.ui.insights.data?.polls?.averages ?? [])
				.filter((a) => a.candidateId)
				.map((a) => [a.candidateId as string, a.pct])
		)
	);

	let totalVotes = $derived(
		streamState.candidates.filter((c) => !c.hidden).reduce((a, c) => a + c.votes, 0)
	);

	let leaderId = $derived.by<string | null>(() => {
		const visible = streamState.candidates.filter((c) => !c.hidden);
		if (visible.length === 0) return null;
		let best = visible[0];
		for (const c of visible) if (c.votes > best.votes) best = c;
		return best.votes > 0 ? best.id : null;
	});

	let rows = $derived.by<CandidateRow[]>(() => {
		const visible = streamState.candidates.filter((c) => !c.hidden);
		if (visible.length === 0) return [];
		return visible
			.map(
				(c): CandidateRow => ({
					id: c.id,
					name: c.name,
					partyColor: c.partyColor,
					partyLabel: c.partyLabel ?? '',
					votes: c.votes,
					pct: totalVotes > 0 ? (c.votes / totalVotes) * 100 : 0,
					isLeader: c.id === leaderId,
					called: c.called,
					headshotUrl: c.headshotUrl,
					market: marketById.get(c.id) ?? null,
					poll: pollById.get(c.id) ?? null
				})
			)
			.sort((a, b) => b.votes - a.votes);
	});

	// Reporting % — prefers the race-level number from civicAPI (which
	// civicAPI pre-computes at the race level via
	// `r.percent_reporting`) before falling back to a per-region average.
	//
	// Why race-level first?
	//
	//   The PA state-senate district 3 race illustrates the failure mode of
	//   the old "always average regions" derivation. The civicAPI race-
	//   detail endpoint returns ~4 wards in `region_results` for this race,
	//   each with `percent_reporting=null` (early voting only — no
	//   precincts have been counted yet). The seed template for the race
	//   has 67 PA counties. After `remapLiveRegionsToSeed`, most seed
	//   counties stay at the default `reportedPct=0`. Averaging 67 zeros
	//   produces "0.0%", but the headline candidate totals (66,845 votes
	//   across 4 candidates, populated from civicAPI's race-level
	//   `candidates[].votes`) prove the race IS reporting — it just
	//   doesn't carry precinct-level breakdowns. Showing "0.0%" misleads
	//   the host into thinking polls haven't closed.
	//
	// Three-tier resolution:
	//   1. `streamState.race.reportedPct` (race-level, civicAPI-authoritative)
	//   2. Mean of regions that have actually reported (`reportedPct > 0`)
	//   3. `null` → render as "—" so the host knows "data unavailable"
	//      rather than mis-reading "0.0%" as a real measurement.
	let reportingPct = $derived.by<number | null>(() => {
		if (streamState.race.reportedPct != null) return streamState.race.reportedPct;
		const regs = streamState.regions;
		if (regs.length === 0) return null;
		// Filter to regions that have *any* reporting data. Including
		// unreported zeroes in the mean dilutes legit numbers — e.g. a
		// 5-ward Philadelphia race overlaid on a 67-county PA template
		// would average to (5×100% + 62×0%)/67 ≈ 7.5% even at the end
		// of the night.
		const reported = regs.filter((r) => r.reportedPct > 0);
		if (reported.length === 0) return null;
		return reported.reduce((a, r) => a + r.reportedPct, 0) / reported.length;
	});

	// Collapsed state — lets the host hide the card to get a clean map shot
	// without actually dismissing it. Restored on un-collapse. Doesn't persist
	// across reloads (intentional: each session starts with the tally visible).
	let collapsed = $state(false);

	function fmtNum(n: number | null | undefined): string {
		if (n == null) return '—';
		return n.toLocaleString();
	}

	// Corner cycle — top-right → bottom-right → bottom-left → top-left → ...
	// Matches the order of the .corner-* CSS classes on .detail-slot. We
	// write to streamStore.state.ui.detailCardCorner so RegionDetailCard /
	// StateRacesCard inherit the host's preference without each having to
	// re-implement the toggle.
	const CORNER_CYCLE = ['top-right', 'bottom-right', 'bottom-left', 'top-left'] as const;
	function cycleCorner() {
		const cur = streamState.ui.detailCardCorner;
		const idx = CORNER_CYCLE.indexOf(cur);
		const next = CORNER_CYCLE[(idx + 1) % CORNER_CYCLE.length];
		streamStore.state.ui.detailCardCorner = next;
	}
	// Glyph hints which corner the card will jump to NEXT — visual cue that
	// reduces the "I have to click and watch" feedback loop. Unicode arrows
	// point at the next corner direction.
	const CORNER_NEXT_GLYPH: Record<(typeof CORNER_CYCLE)[number], string> = {
		'top-right': '⤵', // next: bottom-right
		'bottom-right': '⬅', // next: bottom-left
		'bottom-left': '⬆', // next: top-left
		'top-left': '⤴' // next: top-right
	};
</script>

{#if streamState.candidates.length > 0}
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
	<aside class="statewide-card" class:collapsed role="dialog" aria-label="Race summary">
		<header>
			<div>
				<h3>{streamState.race.title || 'Race summary'}</h3>
				<p class="sub">
					Overall
					{#if streamState.race.dateLabel}· {streamState.race.dateLabel}{/if}
				</p>
			</div>
			{#if interactive}
				<div class="header-actions">
					{#if !docked}
						<button
							type="button"
							class="icon-btn"
							aria-label="Move card to next corner"
							onclick={cycleCorner}
							title="Move card (currently {streamState.ui.detailCardCorner.replace('-', ' ')}) →"
						>
							{CORNER_NEXT_GLYPH[streamState.ui.detailCardCorner]}
						</button>
					{/if}
					<button
						type="button"
						class="icon-btn"
						aria-label={collapsed ? 'Expand race summary' : 'Collapse race summary'}
						aria-expanded={!collapsed}
						onclick={() => (collapsed = !collapsed)}
						title={collapsed ? 'Expand' : 'Collapse'}
					>
						{collapsed ? '▸' : '▾'}
					</button>
				</div>
			{/if}
		</header>

		{#if !collapsed}
			<dl class="stats">
				<div>
					<dt>Total votes</dt>
					<dd>{fmtNum(totalVotes)}</dd>
				</div>
				<div>
					<dt>Reporting</dt>
					<!-- "—" when civicAPI carries neither race-level nor any
					     non-zero per-region `percent_reporting` (typical for
					     small-district races where only candidate vote
					     rollups are published). Better honest than
					     misleading "0.0%". The title attribute explains the
					     fallback so a host hovering can self-debug. -->
					{#if reportingPct == null}
						<dd class="muted" title="civicAPI did not return a reporting percentage for this race">
							—
						</dd>
					{:else}
						<dd>{reportingPct.toFixed(1)}%</dd>
					{/if}
				</div>
				<div>
					<dt>Candidates</dt>
					<dd>{streamState.candidates.filter((c) => !c.hidden).length}</dd>
				</div>
			</dl>

			<section class="live">
				<div class="section-head">
					{#if totalVotes > 0}
						Candidates — overall tally
					{:else}
						Candidates <span class="source-note">(no reporting yet)</span>
					{/if}
				</div>
				<ul class="cand-list">
					{#each rows as c (c.id)}
						<li class="cand-row" class:leader={c.isLeader}>
							<div class="row-head">
								<span class="name">
									{#if c.headshotUrl}
										<!-- Party colour moves to the portrait's ring so the row
										     reads as a face without losing the party cue. -->
										<img
											class="face"
											src={c.headshotUrl}
											alt=""
											style:border-color={c.partyColor}
										/>
									{:else}
										<span class="dot" style:background-color={c.partyColor}></span>
									{/if}
									<strong>{c.name}</strong>
									{#if c.partyLabel}
										<span class="party">({c.partyLabel})</span>
									{/if}
									{#if c.called}
										<span class="called-chip">Winner</span>
									{/if}
								</span>
								<span class="pct">
									{totalVotes > 0 ? `${c.pct.toFixed(1)}%` : '—'}
								</span>
							</div>
							<div class="bar-track">
								<div
									class="bar-fill"
									style:width="{totalVotes > 0 ? c.pct : 0}%"
									style:background-color={c.partyColor}
								></div>
							</div>
							<div class="row-foot">
								<span>{fmtNum(c.votes)} votes</span>
								<!-- On the same line as the vote count so the three numbers a
								     host compares — what's counted, what the market thinks, what
								     the polls said — read together instead of living in three
								     different panels. -->
								{#if c.market != null}
									<span class="ext" title="Polymarket price for this candidate winning">
										Mkt {Math.round(c.market * 100)}%
									</span>
								{/if}
								{#if c.poll != null}
									<span class="ext" title="VoteHub polling average">
										Poll {c.poll.toFixed(1)}
									</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</section>

			<p class="hint">Click a county on the map to see its breakdown.</p>
		{/if}
	</aside>
{/if}

<style>
	.statewide-card {
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
	.statewide-card.collapsed {
		min-width: 12rem;
	}
	/* See RegionDetailCard: the rem floors exceed a phone viewport, so the
	   card fills the bottom sheet rather than overflowing it. */
	@media (max-width: 640px) {
		.statewide-card,
		.statewide-card.collapsed {
			min-width: 0;
			max-width: none;
			width: 100%;
			border: none;
			border-radius: 0;
			padding: 0.75rem;
		}
		/* Collapsing the summary is how a phone host gives the map back its
		   half of the stage, so the chevron has to be hittable rather than a
		   20px glyph tucked in the corner. */
		.icon-btn {
			min-width: 2.25rem;
			min-height: 2.25rem;
		}
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.statewide-card:not(.collapsed) header {
		margin-bottom: 0.75rem;
	}
	header h3 {
		margin: 0;
		font-size: 1.05rem;
	}
	.sub {
		margin: 0.125rem 0 0;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}
	.icon-btn {
		background: transparent;
		border: none;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		font-size: 0.85rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
	}
	.icon-btn:hover {
		background: rgb(from var(--color-base-content) r g b / 0.1);
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
	.stats dd.muted {
		color: rgb(from var(--color-base-content) r g b / 0.45);
		font-weight: 500;
		cursor: help;
	}
	section {
		margin-bottom: 0.5rem;
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
	.live {
		background: rgb(from var(--color-base-200) r g b / 0.5);
		border-left: 3px solid var(--color-primary);
		padding: 0.5rem 0.625rem;
		border-radius: 0.25rem;
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
	.dot {
		display: inline-block;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.face {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 999px;
		object-fit: cover;
		/* Commons portraits carry headroom; bias the crop upward so the face,
		   not the forehead, lands in the circle. */
		object-position: center 20%;
		border: 2px solid transparent;
		background: var(--color-base-300);
		flex-shrink: 0;
	}
	.row-head {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		font-weight: 600;
	}
	.row-foot {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		flex-wrap: wrap;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	/* Set apart from the vote count rather than blended with it: these are
	   somebody else's numbers, and a host reading the row aloud should be able to
	   see which two aren't the count. */
	.ext {
		padding: 0.02rem 0.25rem;
		border: 1px solid rgb(from var(--color-base-content) r g b / 0.2);
		border-radius: 0.2rem;
		font-size: 0.62rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
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
	.pct {
		font-variant-numeric: tabular-nums;
	}
	.hint {
		margin: 0.5rem 0 0;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		text-align: center;
		font-style: italic;
	}
</style>
