<script lang="ts">
	import { insightsQueryFor } from '$lib/data/insights-query';
	import type { StreamState } from '$lib/stream-state';
	import { streamStore } from '$lib/stream-store.svelte';
	import { formatTimeInZone } from '$lib/time-zone';

	/**
	 * What the market and the pollsters are being asked, and what came back.
	 *
	 * Almost all of this panel is diagnostics, because almost all of the failure
	 * modes are naming. Polymarket titles its events by hand and VoteHub keys polls
	 * to subject strings of its own, so "no market found" nearly always means the
	 * search was two words off — and without seeing the query, the host has no way
	 * to know that's what happened. Showing the resolved query, the event that
	 * matched and the note explaining a blank half turns a dead panel into a
	 * ten-second fix.
	 */

	interface Props {
		streamState: StreamState;
	}
	let { streamState }: Props = $props();

	const config = $derived(streamState.ui.insights);
	const data = $derived(config.data);
	const query = $derived(insightsQueryFor(streamState));

	const fetched = $derived(
		data ? formatTimeInZone(new Date(data.fetchedAt), streamState.race.timeZone) : null
	);

	const byId = $derived(new Map(streamState.candidates.map((c) => [c.id, c])));

	function pct(n: number): string {
		return `${Math.round(n * 100)}%`;
	}
</script>

<section class="race-card p-4">
	<h3 class="heading">Markets &amp; polls</h3>
	<p class="blurb">
		The betting market's price and the polling average for this race, shown as a band across the top
		of the stage. Both come from public sources through this app's own server, so the OBS machine
		never talks to them directly.
	</p>

	<label class="row">
		<input type="checkbox" bind:checked={streamStore.state.ui.insights.enabled} />
		<span>Fetch market and polling data</span>
	</label>
	<label class="row">
		<input type="checkbox" bind:checked={streamStore.state.ui.broadcast.insightsStrip} />
		<span>Show the band on the stage and the overlay</span>
	</label>

	<dl class="resolved">
		<div>
			<dt>Market search</dt>
			<dd>{query.q || '—'}</dd>
		</div>
		<div>
			<dt>Poll subject</dt>
			<dd>{query.subject || '—'}</dd>
		</div>
		<div>
			<dt>Office</dt>
			<dd>{query.office || 'not recognised'}</dd>
		</div>
		<div>
			<dt>Last fetch</dt>
			<dd>{fetched ?? 'never'}</dd>
		</div>
	</dl>

	{#if config.lastError}
		<p class="warn">Last fetch failed: {config.lastError}</p>
	{/if}
	{#each data?.notes ?? [] as note (note)}
		<p class="warn">{note}</p>
	{/each}

	{#if data?.market}
		<div class="result">
			<div class="result-head">
				<strong>{data.market.title}</strong>
				<a href={data.market.url} target="_blank" rel="noreferrer noopener">Polymarket ↗</a>
			</div>
			<ul class="outcomes">
				{#each data.market.outcomes as o (o.name)}
					<li>
						<span class="name">
							{o.name}
							{#if o.party}<span class="muted">({o.party})</span>{/if}
							{#if o.candidateId && byId.has(o.candidateId)}
								<!-- Whether the join landed matters: an unmatched outcome still
								     shows a price, but in the market's own grey rather than the
								     candidate's party colour. -->
								<span class="chip">matched</span>
							{/if}
						</span>
						<strong>{pct(o.probability)}</strong>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if data?.polls}
		<div class="result">
			<div class="result-head">
				<strong>{data.polls.subject}</strong>
				<span class="muted">
					{data.polls.count}
					{data.polls.count === 1 ? 'poll' : 'polls'} · latest {data.polls.latestPollster}
				</span>
			</div>
			<ul class="outcomes">
				{#each data.polls.averages as a (a.name)}
					<li>
						<span class="name">{a.name}</span>
						<strong>{a.pct.toFixed(1)}</strong>
					</li>
				{/each}
			</ul>
			<p class="credit">
				Polling data from VoteHub, <a
					href="https://creativecommons.org/licenses/by/4.0/"
					target="_blank"
					rel="noreferrer noopener">CC&nbsp;BY&nbsp;4.0</a
				>.
			</p>
		</div>
	{/if}

	<details class="overrides">
		<summary>Fix the lookup</summary>
		<p class="blurb">
			Used when the guessed search misses — a runoff with its own market, a House seat whose
			district number isn't in the title, a special election. Blank means "work it out from the
			race".
		</p>
		<label class="field">
			Market search text
			<input
				type="text"
				placeholder={query.q}
				bind:value={streamStore.state.ui.insights.marketQuery}
			/>
		</label>
		<label class="field">
			Polymarket event slug
			<input
				type="text"
				placeholder="michigan-senate-election-winner"
				bind:value={streamStore.state.ui.insights.marketSlug}
			/>
		</label>
		<label class="field">
			VoteHub subject
			<input
				type="text"
				placeholder={query.subject || '2026 Michigan'}
				bind:value={streamStore.state.ui.insights.pollSubject}
			/>
		</label>
	</details>
</section>

<style>
	.heading {
		margin: 0 0 0.35rem;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.blurb,
	.credit {
		margin: 0 0 0.6rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: rgb(from var(--color-base-content) r g b / 0.65);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.35rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.resolved {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
		gap: 0.4rem;
		margin: 0.5rem 0 0.6rem;
	}
	.resolved dt {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.resolved dd {
		margin: 0.1rem 0 0;
		font-size: 0.78rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.warn {
		margin: 0 0 0.4rem;
		padding: 0.35rem 0.45rem;
		border-left: 2px solid var(--color-warning, #eab308);
		background: rgb(from var(--color-warning, #eab308) r g b / 0.1);
		font-size: 0.72rem;
		line-height: 1.4;
	}
	.result {
		margin: 0 0 0.6rem;
		padding: 0.45rem 0.55rem;
		background: var(--color-base-300);
		border-radius: 0.3rem;
	}
	.result-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.8rem;
	}
	.result-head strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.outcomes {
		list-style: none;
		margin: 0.3rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.outcomes li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.78rem;
	}
	.outcomes strong {
		font-variant-numeric: tabular-nums;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.muted {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.chip {
		margin-left: 0.25rem;
		padding: 0.02rem 0.25rem;
		border-radius: 0.2rem;
		background: rgb(from var(--color-primary) r g b / 0.25);
		font-size: 0.55rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.credit {
		margin: 0.35rem 0 0;
		font-size: 0.65rem;
	}
	.overrides summary {
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		margin-bottom: 0.4rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin: 0 0 0.4rem;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.field input {
		padding: 0.35rem 0.45rem;
		background: var(--color-base-200);
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
		border-radius: 0.25rem;
		color: inherit;
		font: inherit;
		font-size: 0.8rem;
		text-transform: none;
		letter-spacing: 0;
	}
	@media (max-width: 640px) {
		.row {
			min-height: 2.25rem;
		}
	}
</style>
