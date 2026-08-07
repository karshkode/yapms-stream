<script lang="ts">
	import { fillMissingHeadshots } from '$lib/broadcast/candidatePhotoFill';
	import { MAX_FOLLOWED, followRace, moveFollowed, unfollowRace } from '$lib/broadcast/followed';
	import { clearHeadshotCache } from '$lib/data/candidatePhotos';
	import { surnameOf } from '$lib/data/candidatePhotos';
	import type { StreamState } from '$lib/stream-state';

	/**
	 * Drawer tab for the broadcast package: the frame and crawl that /overlay
	 * paints, where the results rail sits, and which races the crawl carries.
	 */

	interface Props {
		// `streamState`, not `state` — see FormsDrawer for why a local `state`
		// binding breaks `$state(...)` in the same file.
		streamState: StreamState;
	}
	let { streamState }: Props = $props();

	const config = $derived(streamState.ui.broadcast);

	let photoStatus = $state<string | null>(null);
	let photoBusy = $state(false);

	const activeRaceId = $derived(
		streamState.dataSource.adapter === 'civicapi' ? streamState.dataSource.raceId : null
	);
	const activeFollowed = $derived(
		!!activeRaceId && config.followed.some((f) => f.raceId === activeRaceId)
	);

	function followActive() {
		if (!activeRaceId) return;
		streamState.ui.broadcast.followed = followRace(config.followed, {
			raceId: activeRaceId,
			label: streamState.race.title || `Race ${activeRaceId}`,
			state: streamState.ui.homeStateAbbr
		});
	}

	async function findPhotos(force: boolean) {
		photoBusy = true;
		photoStatus = 'Searching Wikipedia…';
		try {
			if (force) clearHeadshotCache();
			const res = await fillMissingHeadshots({ force });
			if (res.attempted === 0) photoStatus = 'No candidates loaded.';
			else if (res.throttled && res.resolved === 0)
				photoStatus = 'Wikipedia is rate-limiting us — try again in a minute.';
			else photoStatus = `Found ${res.resolved} of ${res.attempted}.`;
		} catch (err) {
			photoStatus = err instanceof Error ? err.message : String(err);
		} finally {
			photoBusy = false;
		}
	}

	/** "2m ago" style freshness for a followed race's last successful fetch. */
	function ago(ts: number | null): string {
		if (ts == null) return 'never';
		const secs = Math.round((Date.now() - ts) / 1000);
		if (secs < 60) return `${secs}s ago`;
		return `${Math.round(secs / 60)}m ago`;
	}

	/** Leader line for a followed race, so the host can sanity-check what the
	 *  crawl is about to say without watching it go past. */
	function leaderLine(candidates: { name: string; votes: number; partyLabel: string }[]): string {
		if (candidates.length === 0) return 'no results yet';
		const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
		const total = sorted.reduce((a, c) => a + c.votes, 0);
		const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');
		const lead = sorted[0];
		const head = `${surnameOf(lead.name)}${lead.partyLabel ? ` (${lead.partyLabel})` : ''} ${pct(lead.votes)}`;
		if (sorted.length < 2) return head;
		const second = sorted[1];
		return `${head} over ${surnameOf(second.name)} ${pct(second.votes)}`;
	}
</script>

<section class="race-card p-4">
	<h3 class="heading">Overlay package</h3>
	<div class="grid">
		<label class="row">
			<input type="checkbox" bind:checked={streamState.ui.broadcast.frame} />
			<span>
				<strong>News frame</strong>
				<em>Banner, lower third and border around the OBS scene.</em>
			</span>
		</label>
		<label class="row">
			<input type="checkbox" bind:checked={streamState.ui.broadcast.ticker} />
			<span>
				<strong>Results crawl</strong>
				<em>Head-to-head marquee along the bottom.</em>
			</span>
		</label>
		<label class="row">
			<input type="checkbox" bind:checked={streamState.ui.broadcast.liveBadge} />
			<span>
				<strong>Live badge</strong>
				<em>Red LIVE pill in the banner.</em>
			</span>
		</label>
		<label class="row">
			<input type="checkbox" bind:checked={streamState.ui.broadcast.autoPhotos} />
			<span>
				<strong>Auto candidate photos</strong>
				<em>Look up headshots on Wikipedia when a roster loads.</em>
			</span>
		</label>
	</div>

	<div class="fields">
		<label class="field">
			<span class="label-text">Results rail</span>
			<select bind:value={streamState.ui.broadcast.dock}>
				<option value="right">Docked right</option>
				<option value="left">Docked left</option>
				<option value="off">Floating card</option>
			</select>
		</label>
		<label class="field">
			<span class="label-text">Network name</span>
			<input
				type="text"
				bind:value={streamState.ui.broadcast.networkName}
				placeholder="Decision desk"
			/>
		</label>
		<label class="field wide">
			<span class="label-text">Headline override</span>
			<input
				type="text"
				bind:value={streamState.ui.broadcast.headline}
				placeholder={streamState.race.title || 'Falls back to the race title'}
			/>
		</label>
		<label class="field">
			<span class="label-text">Crawl seconds per pass</span>
			<input
				type="number"
				min="15"
				max="300"
				step="5"
				bind:value={streamState.ui.broadcast.tickerSpeedSec}
			/>
		</label>
		<label class="field">
			<span class="label-text">Crawl refresh (seconds)</span>
			<!-- Stored in ms; edited in seconds because nobody thinks in
			     milliseconds about a one-minute poll. -->
			<input
				type="number"
				min="15"
				max="600"
				step="5"
				value={Math.round(config.followIntervalMs / 1000)}
				oninput={(e) => {
					const secs = Number((e.currentTarget as HTMLInputElement).value);
					if (Number.isFinite(secs) && secs >= 15) {
						streamState.ui.broadcast.followIntervalMs = Math.round(secs) * 1000;
					}
				}}
			/>
		</label>
	</div>

	<div class="photo-actions">
		<button type="button" onclick={() => findPhotos(false)} disabled={photoBusy}>
			{photoBusy ? 'Searching…' : 'Find missing photos'}
		</button>
		<button type="button" onclick={() => findPhotos(true)} disabled={photoBusy}>
			Re-resolve all
		</button>
		{#if photoStatus}
			<span class="status">{photoStatus}</span>
		{/if}
	</div>
</section>

<section class="race-card p-4">
	<header class="bar">
		<h3 class="heading">Crawl races ({config.followed.length}/{MAX_FOLLOWED})</h3>
		<button
			type="button"
			onclick={followActive}
			disabled={!activeRaceId || activeFollowed || config.followed.length >= MAX_FOLLOWED}
			title={activeRaceId
				? 'Add the race currently on the stage'
				: 'Load a live civicAPI race first'}
		>
			{activeFollowed ? 'Already following' : '+ Follow this race'}
		</button>
	</header>

	<p class="hint">
		The loaded race always leads the crawl. Followed races are polled in the background and appear
		after it — add them here or from the star on a state's race list.
	</p>

	{#if config.followed.length === 0}
		<p class="empty">Nothing followed yet.</p>
	{:else}
		<ul class="followed">
			{#each config.followed as f, i (f.raceId)}
				<li>
					<div class="f-main">
						<input
							type="text"
							class="f-label"
							bind:value={f.label}
							aria-label="Crawl label for race {f.raceId}"
						/>
						<span class="f-meta">
							{#if f.state}<span class="f-state">{f.state}</span>{/if}
							{#if f.lastError}
								<span class="f-error" title={f.lastError}>fetch failed</span>
							{:else}
								<span>{leaderLine(f.candidates)}</span>
								<span class="f-age">· {ago(f.updatedAt)}</span>
							{/if}
						</span>
					</div>
					<div class="f-actions">
						<button
							type="button"
							aria-label="Move up"
							disabled={i === 0}
							onclick={() =>
								(streamState.ui.broadcast.followed = moveFollowed(config.followed, f.raceId, -1))}
						>
							↑
						</button>
						<button
							type="button"
							aria-label="Move down"
							disabled={i === config.followed.length - 1}
							onclick={() =>
								(streamState.ui.broadcast.followed = moveFollowed(config.followed, f.raceId, 1))}
						>
							↓
						</button>
						<button
							type="button"
							class="danger"
							aria-label="Stop following"
							onclick={() =>
								(streamState.ui.broadcast.followed = unfollowRace(config.followed, f.raceId))}
						>
							×
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.heading {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.bar .heading {
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 0.375rem;
		margin-bottom: 0.75rem;
	}
	/* `row`, not `toggle`: daisyUI ships a `.toggle` switch whose fixed box
	   overrides an ordinary label's width. Same trap the candidate and
	   visibility panels hit. */
	.row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		background: var(--color-base-300);
		border-radius: 0.25rem;
		cursor: pointer;
		min-height: 2.25rem;
	}
	.row input {
		margin-top: 0.15rem;
		flex-shrink: 0;
	}
	.row strong {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
	}
	.row em {
		display: block;
		font-size: 0.7rem;
		font-style: normal;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.field.wide {
		grid-column: 1 / -1;
	}
	.label-text {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	input[type='text'],
	input[type='number'],
	select {
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.3rem 0.4rem;
		border-radius: 0.25rem;
		font-size: 0.85rem;
		min-width: 0;
	}
	button {
		padding: 0.3rem 0.6rem;
		background: var(--color-secondary);
		border: none;
		color: var(--color-base-content);
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.8rem;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.danger {
		color: var(--color-error);
		background: transparent;
		font-size: 1rem;
		line-height: 1;
	}
	.photo-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.status {
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.hint {
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.empty {
		margin: 0;
		font-size: 0.8rem;
		color: rgb(from var(--color-base-content) r g b / 0.5);
	}
	.followed {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.followed li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		background: var(--color-base-300);
		border-radius: 0.25rem;
	}
	.f-main {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.f-label {
		width: 100%;
	}
	.f-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: baseline;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.65);
	}
	.f-state {
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.f-age {
		color: rgb(from var(--color-base-content) r g b / 0.45);
	}
	.f-error {
		color: var(--color-error);
		cursor: help;
	}
	.f-actions {
		display: flex;
		gap: 0.15rem;
		flex-shrink: 0;
	}
	.f-actions button {
		padding: 0.2rem 0.4rem;
	}
	@media (max-width: 640px) {
		.photo-actions button,
		.bar button,
		.f-actions button {
			min-height: 2.25rem;
			/* Height alone isn't a tap target: the reorder arrows are a single
			   glyph wide, so without this they stay ~20px across and land
			   between a thumb's worth of pixels. */
			min-width: 2.25rem;
		}
		.row input[type='checkbox'] {
			width: 1.25rem;
			height: 1.25rem;
		}
		input[type='text'],
		input[type='number'],
		select {
			min-height: 2.25rem;
		}
	}
</style>
