<script lang="ts">
	import { marketLeader } from '$lib/data/insights';
	import { streamStore } from '$lib/stream-store.svelte';

	/**
	 * Where the race stood before the votes: the market's price and the polling
	 * average, across the top of the stage.
	 *
	 * This sits above the map rather than in the rail because of when it's the
	 * most interesting thing on screen — which is most of a broadcast. Before poll
	 * close there are no returns to shade a map with at all. For the first hour
	 * after, there are returns from four rural counties and shading them tells the
	 * audience less than "the market has this at 58 and the polls had it tied".
	 * The swing and turnout layers underneath are answers to a narrower question,
	 * asked once the count is real, and they were the most prominent comparison on
	 * the screen only because they were the only one.
	 *
	 * Both numbers are quoted with their provenance attached — volume for the
	 * market, poll count and date range for the average — because both are
	 * frequently wrong in ways their headline number doesn't admit, and a host
	 * saying one on air needs to be able to see how much to trust it. VoteHub's
	 * data is CC-BY, so naming it is also a licence condition rather than a
	 * courtesy.
	 */

	interface Props {
		/** /control gets a slimmer band; the on-air copy is the taller one. */
		compact?: boolean;
	}
	let { compact = false }: Props = $props();

	const streamState = $derived(streamStore.state);
	const insights = $derived(streamState.ui.insights);
	const data = $derived(insights.data);

	const byId = $derived(new Map(streamState.candidates.map((c) => [c.id, c])));

	/**
	 * Party colour for a market outcome. Ours when the name matched the roster,
	 * otherwise the letter the market itself carried, and grey when neither — a
	 * "(D)" from Polymarket is worth honouring even for a candidate we don't have,
	 * since a blank strip during a primary the roster hasn't loaded yet is worse.
	 */
	function colorFor(candidateId: string | null, party: string): string {
		const cand = candidateId ? byId.get(candidateId) : undefined;
		if (cand) return cand.partyColor;
		if (party === 'D') return '#1375B7';
		if (party === 'R') return '#BF1D29';
		return '#6b7280';
	}

	/** Surname only. The strip is a glance, and full names don't fit four across. */
	function short(name: string): string {
		const parts = name.trim().split(/\s+/);
		return parts.length > 1 ? parts[parts.length - 1] : name;
	}

	const outcomes = $derived((data?.market?.outcomes ?? []).filter((o) => o.probability > 0.005));
	const leader = $derived(marketLeader(data?.market ?? null));
	const averages = $derived(data?.polls?.averages ?? []);

	/**
	 * Volume, abbreviated. A price is only as meaningful as the money behind it,
	 * and "$271K" says that in the space available where "271,000" wouldn't earn
	 * its width.
	 */
	function money(n: number): string {
		if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
		return `$${Math.round(n)}`;
	}

	function shortDate(iso: string): string {
		const t = Date.parse(iso);
		if (!Number.isFinite(t)) return iso;
		return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	const hasAnything = $derived(outcomes.length > 0 || averages.length > 0);
</script>

{#if insights.enabled && hasAnything}
	<div class="strip" class:compact>
		{#if outcomes.length > 0}
			<section class="block market">
				<h4>
					Market
					{#if data?.market}
						<span class="meta">{money(data.market.volume)} traded</span>
					{/if}
				</h4>
				<!-- A single bar rather than one per candidate: these are shares of the
				     same 100%, and stacking them is the only rendering where that's
				     self-evident. -->
				<div class="bar" aria-hidden="true">
					{#each outcomes as o (o.name)}
						<span
							class="seg"
							style:width="{o.probability * 100}%"
							style:background-color={colorFor(o.candidateId, o.party)}
						></span>
					{/each}
				</div>
				<ul class="legend">
					{#each outcomes.slice(0, 4) as o (o.name)}
						<li>
							<span class="swatch" style:background-color={colorFor(o.candidateId, o.party)}></span>
							<span class="who">{short(o.name)}</span>
							<strong>{Math.round(o.probability * 100)}%</strong>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if averages.length > 0 && data?.polls}
			<section class="block polls">
				<h4>
					Polling average
					<span class="meta">
						{data.polls.count}
						{data.polls.count === 1 ? 'poll' : 'polls'}
						· {shortDate(data.polls.from)}–{shortDate(data.polls.to)} · VoteHub
					</span>
				</h4>
				<ul class="rows">
					{#each averages.slice(0, 4) as a (a.name)}
						<li>
							<span class="swatch" style:background-color={colorFor(a.candidateId, '')}></span>
							<span class="who">{short(a.name)}</span>
							<span class="track">
								<span
									class="fill"
									style:width="{Math.min(100, a.pct)}%"
									style:background-color={colorFor(a.candidateId, '')}
								></span>
							</span>
							<strong>{a.pct.toFixed(1)}</strong>
						</li>
					{/each}
				</ul>
			</section>
		{:else if outcomes.length > 0 && leader}
			<!-- With no usable average, the space goes to the one sentence the market
			     amounts to, rather than to a gap where a second panel should be. -->
			<section class="block single">
				<h4>Market read</h4>
				<p class="read">
					<strong>{short(leader.name)}</strong>
					favoured at {Math.round(leader.probability * 100)}%
				</p>
			</section>
		{/if}
	</div>
{/if}

<style>
	.strip {
		display: flex;
		align-items: stretch;
		gap: 1.25rem;
		flex-shrink: 0;
		padding: 0.4rem 0.9rem;
		background: linear-gradient(
			180deg,
			rgb(from var(--color-base-200) r g b / 0.95),
			rgb(from var(--color-base-300) r g b / 0.95)
		);
		border-bottom: 1px solid rgb(from var(--color-secondary) r g b / 0.6);
		font-size: 0.75rem;
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.market {
		flex: 1 1 55%;
	}
	.polls,
	.single {
		flex: 1 1 45%;
		border-left: 1px solid rgb(from var(--color-secondary) r g b / 0.45);
		padding-left: 1.25rem;
	}
	h4 {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.62rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.meta {
		font-size: 0.58rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: none;
		color: rgb(from var(--color-base-content) r g b / 0.45);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bar {
		display: flex;
		height: 0.55rem;
		border-radius: 999px;
		overflow: hidden;
		background: rgb(from var(--color-base-100) r g b / 0.8);
	}
	.seg {
		min-width: 2px;
	}
	.legend,
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.9rem;
	}
	.legend li,
	.rows li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.swatch {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.who {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rows .who {
		flex: 0 0 5.5rem;
	}
	.track {
		flex: 1 1 auto;
		height: 0.4rem;
		min-width: 2rem;
		border-radius: 999px;
		background: rgb(from var(--color-base-100) r g b / 0.8);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
	}
	strong {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
	}
	.read {
		margin: 0.15rem 0 0;
		font-size: 0.85rem;
	}

	.compact {
		padding: 0.3rem 0.6rem;
		gap: 0.9rem;
		font-size: 0.68rem;
	}
	.compact .bar {
		height: 0.4rem;
	}
	.compact .polls,
	.compact .single {
		padding-left: 0.9rem;
	}

	@media (max-width: 860px) {
		/* Two panels side by side stop being readable well before the phone
		   breakpoint; the market is the half that works at a glance, so it's the
		   half that stays. */
		.polls,
		.single {
			display: none;
		}
	}
</style>
