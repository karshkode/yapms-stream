<script lang="ts">
	import { surnameOf } from '$lib/data/candidatePhotos';
	import type { FollowedRace, TickerCandidate } from '$lib/stream-state';
	import { streamStore } from '$lib/stream-store.svelte';

	/**
	 * Bottom-of-screen crawl in the shape broadcast networks use: each item is
	 * one race reduced to a head-to-head — the leader and the runner-up, their
	 * party letters in party colours, their share, and the margin between them.
	 *
	 * Data comes entirely from `ui.broadcast.followed`, which /control refreshes
	 * on a slow poll. Rendering from state (rather than fetching here) is what
	 * lets this run inside a read-only OBS tab and guarantees the crawl can't
	 * disagree with the control desk.
	 */

	const state = $derived(streamStore.state);

	interface TickerItem {
		key: string;
		/** Postal abbr chip, e.g. "KY". */
		state: string | null;
		label: string;
		leader: TickerCandidate | null;
		runnerUp: TickerCandidate | null;
		leaderPct: number;
		runnerPct: number;
		/** Percentage-point gap between the top two. */
		marginPct: number;
		reportedPct: number | null;
		/** The race currently on the stage, flagged so it can be marked. */
		isActive: boolean;
		stale: boolean;
	}

	/** Followed tallies older than this are marked so the host can see at a
	 *  glance that a number on air has stopped updating (civicAPI outage, a
	 *  race id that 404s). Three missed passes at the default cadence. */
	const STALE_AFTER_MS = 3 * 60_000;

	function toItem(
		key: string,
		label: string,
		stateAbbr: string | null,
		candidates: TickerCandidate[],
		reportedPct: number | null,
		updatedAt: number | null,
		isActive: boolean
	): TickerItem | null {
		const visible = candidates.filter((c) => c.votes >= 0);
		if (visible.length === 0) return null;
		const sorted = [...visible].sort((a, b) => b.votes - a.votes);
		const total = sorted.reduce((a, c) => a + c.votes, 0);
		const leader = sorted[0] ?? null;
		const runnerUp = sorted[1] ?? null;
		const pct = (c: TickerCandidate | null) => (c && total > 0 ? (c.votes / total) * 100 : 0);
		const leaderPct = pct(leader);
		const runnerPct = pct(runnerUp);
		return {
			key,
			state: stateAbbr,
			label,
			leader,
			runnerUp,
			leaderPct,
			runnerPct,
			marginPct: leaderPct - runnerPct,
			reportedPct,
			isActive,
			stale: updatedAt != null && Date.now() - updatedAt > STALE_AFTER_MS
		};
	}

	let items = $derived.by<TickerItem[]>(() => {
		const out: TickerItem[] = [];
		// The loaded race leads the crawl. Without this the ticker would sit
		// empty until the host explicitly followed something, which reads as a
		// broken graphic on air rather than an unconfigured one.
		if (state.candidates.length > 0 && state.race.title) {
			const active = toItem(
				'active',
				state.race.title,
				state.ui.homeStateAbbr,
				state.candidates
					.filter((c) => !c.hidden)
					.map((c) => ({
						name: c.name,
						partyLabel: c.partyLabel ?? '',
						partyColor: c.partyColor,
						votes: c.votes,
						called: c.called,
						headshotUrl: c.headshotUrl
					})),
				state.race.reportedPct,
				Date.now(),
				true
			);
			if (active) out.push(active);
		}
		for (const f of state.ui.broadcast.followed as FollowedRace[]) {
			const item = toItem(
				f.raceId,
				f.label,
				f.state,
				f.candidates,
				f.reportedPct,
				f.updatedAt,
				false
			);
			if (item) out.push(item);
		}
		return out;
	});

	// One full pass of the crawl. The track holds the item list twice and
	// animates to -50%, so the second copy is exactly where the first started
	// when the animation loops — that's what makes it seamless rather than
	// snapping back. Scaling duration by item count keeps the reading speed
	// constant whether the host follows two races or twelve.
	let durationSec = $derived(
		Math.max(15, state.ui.broadcast.tickerSpeedSec * Math.max(1, items.length / 4))
	);

	function fmtPct(n: number): string {
		return `${n.toFixed(1)}%`;
	}
</script>

{#if items.length > 0}
	<div class="ticker" aria-label="Race ticker">
		<div class="rail">
			<span class="rail-label">Results</span>
		</div>
		<div class="window">
			<div class="track" style:animation-duration="{durationSec}s">
				<!-- Two passes of the same list: see `durationSec` above. The clone is
				     decorative, so it's hidden from assistive tech. -->
				{#each [0, 1] as copy (copy)}
					<div class="run" aria-hidden={copy === 1}>
						{#each items as item (item.key)}
							<span class="item" class:active={item.isActive} class:stale={item.stale}>
								{#if item.state}
									<span class="chip state">{item.state}</span>
								{/if}
								<span class="label">{item.label}</span>
								{#if item.leader}
									<span class="side">
										{#if item.leader.partyLabel}
											<span class="party" style:background-color={item.leader.partyColor}>
												{item.leader.partyLabel}
											</span>
										{/if}
										<span class="who">{surnameOf(item.leader.name)}</span>
										<span class="num">{fmtPct(item.leaderPct)}</span>
										{#if item.leader.called}
											<span class="chip win">Win</span>
										{/if}
									</span>
									{#if item.runnerUp}
										<span class="vs">vs</span>
										<span class="side dim">
											{#if item.runnerUp.partyLabel}
												<span class="party" style:background-color={item.runnerUp.partyColor}>
													{item.runnerUp.partyLabel}
												</span>
											{/if}
											<span class="who">{surnameOf(item.runnerUp.name)}</span>
											<span class="num">{fmtPct(item.runnerPct)}</span>
										</span>
										<span class="margin">+{fmtPct(item.marginPct)}</span>
									{/if}
								{:else}
									<span class="side dim"><span class="who">No results yet</span></span>
								{/if}
								{#if item.reportedPct != null}
									<span class="reporting">{item.reportedPct.toFixed(0)}% in</span>
								{/if}
								<span class="sep">◆</span>
							</span>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	.ticker {
		display: flex;
		align-items: stretch;
		height: 2.5rem;
		background: var(--color-base-100);
		border-top: 1px solid rgb(from var(--color-primary) r g b / 0.35);
		overflow: hidden;
		font-size: 0.9rem;
	}
	.rail {
		display: flex;
		align-items: center;
		padding: 0 0.875rem;
		background: var(--color-primary);
		color: var(--color-primary-content);
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.7rem;
		flex-shrink: 0;
	}
	.window {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		display: flex;
		align-items: center;
	}
	.track {
		display: flex;
		white-space: nowrap;
		will-change: transform;
		animation-name: crawl;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
	}
	.run {
		display: flex;
		align-items: center;
	}
	@keyframes crawl {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(-50%);
		}
	}
	/* Hosts who find a moving graphic distracting (or capture stills) get a
	   static strip instead of a crawl. */
	@media (prefers-reduced-motion: reduce) {
		.track {
			animation: none;
		}
	}
	.item {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.5rem;
	}
	.item.stale {
		opacity: 0.55;
	}
	.chip {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.1rem 0.3rem;
		border-radius: 0.2rem;
	}
	.chip.state {
		background: var(--color-secondary);
		color: var(--color-base-content);
	}
	.chip.win {
		background: var(--color-accent);
		color: var(--color-accent-content);
	}
	.label {
		color: rgb(from var(--color-base-content) r g b / 0.75);
		font-size: 0.8rem;
	}
	.item.active .label {
		color: var(--color-primary);
		font-weight: 600;
	}
	.side {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.side.dim {
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.party {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.15rem;
		height: 1.15rem;
		border-radius: 0.2rem;
		color: #fff;
		font-size: 0.65rem;
		font-weight: 800;
		text-transform: uppercase;
		/* Party colours run light (Libertarian yellow) to dark (Democratic
		   blue), so lean on a shadow rather than trusting white to contrast. */
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
	}
	.who {
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.num {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.vs {
		font-size: 0.7rem;
		text-transform: uppercase;
		color: rgb(from var(--color-base-content) r g b / 0.45);
	}
	.margin {
		font-variant-numeric: tabular-nums;
		font-size: 0.75rem;
		color: var(--color-accent);
		font-weight: 700;
	}
	.reporting {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		font-variant-numeric: tabular-nums;
	}
	.sep {
		color: rgb(from var(--color-primary) r g b / 0.5);
		font-size: 0.6rem;
		padding: 0 0.25rem;
	}
	@media (max-width: 640px) {
		.ticker {
			height: 2.1rem;
			font-size: 0.8rem;
		}
		.rail {
			padding: 0 0.5rem;
			font-size: 0.6rem;
			letter-spacing: 0.08em;
		}
	}
</style>
