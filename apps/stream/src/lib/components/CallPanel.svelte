<script lang="ts">
	import type { StreamState } from '$lib/stream-state';
	import { streamStore } from '$lib/stream-store.svelte';
	import { formatTimeInZone } from '$lib/time-zone';

	/**
	 * Puts a race call on air, and takes it off.
	 *
	 * The call is the only graphic in this app the host has to be able to trigger
	 * on a beat — they say "we can now project" and the card has to be there on the
	 * word. So each candidate gets a button rather than a form to fill in: the
	 * numbers, the timestamp and the photo are read off the live race at the moment
	 * of the press, and the two optional text fields are filled in beforehand if at
	 * all.
	 *
	 * Nothing here fires automatically. civicAPI already carries a `winner` flag
	 * and `called` already follows it, which is what the "Winner" chip in the rail
	 * reads — but a chip appearing in a rail is a different act from a full-screen
	 * projection graphic, and putting one up before the host has said it, or
	 * yanking it back when a wire corrects itself, is not a decision code should
	 * make. The panel surfaces what the feed thinks and leaves the call to the desk.
	 */

	interface Props {
		streamState: StreamState;
	}
	let { streamState }: Props = $props();

	let source = $state('Decision Desk');
	let note = $state('');

	/**
	 * How long the graphic stays up. Fourteen seconds is about as long as a host
	 * takes to say who won and why it matters, which is the length of the moment
	 * the card exists for; "stay up" is there for the call that ends the night.
	 */
	const HOLDS: { ms: number; label: string }[] = [
		{ ms: 8000, label: '8s' },
		{ ms: 14000, label: '14s' },
		{ ms: 25000, label: '25s' },
		{ ms: 0, label: 'Stay up' }
	];
	let holdMs = $state(14000);

	const call = $derived(streamState.ui.broadcast.call);

	const visible = $derived(streamState.candidates.filter((c) => !c.hidden));
	const totalVotes = $derived(visible.reduce((sum, c) => sum + c.votes, 0));

	/** Reporting %, by the same three-tier resolution the results card uses. */
	const reportedPct = $derived.by<number | null>(() => {
		if (streamState.race.reportedPct != null) return streamState.race.reportedPct;
		const reported = streamState.regions.filter((r) => r.reportedPct > 0);
		if (reported.length === 0) return null;
		return reported.reduce((sum, r) => sum + r.reportedPct, 0) / reported.length;
	});

	const ranked = $derived([...visible].sort((a, b) => b.votes - a.votes));

	function push(candidateId: string, kind: 'projected' | 'winner') {
		const candidate = visible.find((c) => c.id === candidateId);
		if (!candidate) return;

		const pct = totalVotes > 0 ? (candidate.votes / totalVotes) * 100 : 0;
		// Lead over the next candidate, not over the field. "Ahead by 4" means
		// ahead of the person in second, and against a third-placed candidate it
		// would be a meaninglessly large number.
		const runnerUp = ranked.find((c) => c.id !== candidateId);
		const runnerUpPct = runnerUp && totalVotes > 0 ? (runnerUp.votes / totalVotes) * 100 : 0;

		streamStore.state.ui.broadcast.call = {
			candidateId,
			name: candidate.name,
			party: candidate.partyLabel ?? '',
			partyColor: candidate.partyColor,
			headshotUrl: candidate.headshotUrl,
			kind,
			at: Date.now(),
			votes: candidate.votes,
			pct,
			marginPct: Math.max(0, pct - runnerUpPct),
			reportedPct,
			holdMs,
			source: source.trim(),
			note: note.trim(),
			raceTitle: streamState.race.title
		};

		// Calling a race is also a statement about the roster, so the winner chip
		// in the rail follows the card rather than needing a second click in
		// another tab. Only for a hard call: a projection is the desk getting
		// ahead of the count, and the rail should still be reporting the count.
		if (kind === 'winner') {
			streamStore.state.candidates = streamState.candidates.map((c) => ({
				...c,
				called: c.id === candidateId
			}));
		}
	}

	function clear() {
		streamStore.state.ui.broadcast.call = null;
	}

	/** Re-stamps the card with the numbers as they are now, keeping the same call. */
	function refresh() {
		if (!call) return;
		push(call.candidateId, call.kind);
	}

	const stamp = $derived(
		call ? formatTimeInZone(new Date(call.at), streamState.race.timeZone) : ''
	);

	// Seconds left on the graphic. Ticked here rather than derived from the call
	// alone, because nothing about the state changes as time passes — without a
	// clock the host would watch a static number until the card vanished.
	let now = $state(Date.now());
	$effect(() => {
		if (!call || call.holdMs <= 0) return;
		const id = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(id);
	});
	const secondsLeft = $derived.by(() => {
		if (!call || call.holdMs <= 0) return null;
		return Math.max(0, Math.ceil((call.at + call.holdMs - now) / 1000));
	});

	const feedWinner = $derived(streamState.candidates.find((c) => c.called) ?? null);
</script>

<section class="race-card p-4">
	<h3 class="heading">Call the race</h3>
	<p class="blurb">
		Takes the overlay's scene with a card carrying this race's map, the candidate's photo, a check
		and the numbers as they stand right now. Those numbers are frozen at the moment you press it, so
		the card keeps saying what you said when you said it, and it fades out on its own.
	</p>

	{#if call}
		<div class="on-air" style:--party={call.partyColor}>
			<div class="on-air-head">
				<span class="pill">{call.kind === 'winner' ? 'Winner' : 'Projected'}</span>
				<strong>{call.name}</strong>
				<span class="muted">called {stamp}</span>
				{#if secondsLeft !== null}
					<span class="muted">· clears in {secondsLeft}s</span>
				{:else}
					<span class="muted">· staying up</span>
				{/if}
			</div>
			<p class="on-air-figures">
				{call.pct.toFixed(1)}% · {call.votes.toLocaleString()} votes · +{call.marginPct.toFixed(1)}
				{#if call.reportedPct != null}
					· {call.reportedPct.toFixed(0)}% counted
				{/if}
			</p>
			<div class="on-air-actions">
				<button type="button" onclick={refresh} title="Restamp with the current count">
					Update numbers
				</button>
				<button type="button" class="danger" onclick={clear}>Take off air</button>
			</div>
		</div>
	{:else}
		<p class="empty">Nothing on air. Pick a candidate below.</p>
	{/if}

	{#if visible.length === 0}
		<p class="empty">No candidates loaded, so there's nobody to call it for.</p>
	{:else}
		{#if feedWinner && call?.candidateId !== feedWinner.id}
			<!-- The feed's opinion, stated rather than acted on. -->
			<p class="hint">
				The data source has {feedWinner.name} as the winner of this race. Nothing goes on air until you
				push it.
			</p>
		{/if}

		<div class="holds">
			<span class="holds-label">On screen for</span>
			{#each HOLDS as h (h.ms)}
				<button
					type="button"
					class="hold"
					class:active={holdMs === h.ms}
					aria-pressed={holdMs === h.ms}
					onclick={() => (holdMs = h.ms)}
				>
					{h.label}
				</button>
			{/each}
		</div>

		<div class="fields">
			<label class="field">
				Attribution
				<input type="text" bind:value={source} placeholder="Decision Desk" />
			</label>
			<label class="field">
				Note (optional)
				<input
					type="text"
					bind:value={note}
					placeholder="Flips the seat for the first time since 1994"
				/>
			</label>
		</div>

		<ul class="cands">
			{#each ranked as c (c.id)}
				<li>
					<span class="who">
						{#if c.headshotUrl}
							<img src={c.headshotUrl} alt="" style:border-color={c.partyColor} />
						{:else}
							<span class="dot" style:background-color={c.partyColor}></span>
						{/if}
						<span class="who-text">
							<strong>{c.name}</strong>
							<span class="muted">
								{totalVotes > 0 ? `${((c.votes / totalVotes) * 100).toFixed(1)}%` : '—'} ·
								{c.votes.toLocaleString()} votes
							</span>
						</span>
					</span>
					<span class="buttons">
						<button
							type="button"
							class:active={call?.candidateId === c.id && call?.kind === 'projected'}
							onclick={() => push(c.id, 'projected')}
						>
							Project
						</button>
						<button
							type="button"
							class="hard"
							class:active={call?.candidateId === c.id && call?.kind === 'winner'}
							onclick={() => push(c.id, 'winner')}
						>
							Declare winner
						</button>
					</span>
				</li>
			{/each}
		</ul>
		<p class="hint">
			<strong>Project</strong> is the desk getting ahead of the count.
			<strong>Declare winner</strong> is the count being settled, and also ticks the winner chip in the
			results rail.
		</p>
	{/if}
</section>

<style>
	.heading {
		margin: 0 0 0.35rem;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.blurb,
	.empty,
	.hint {
		margin: 0 0 0.6rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: rgb(from var(--color-base-content) r g b / 0.65);
	}
	.empty {
		font-style: italic;
	}
	.on-air {
		margin: 0 0 0.7rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid rgb(from var(--party) r g b / 0.8);
		border-left: 0.3rem solid var(--party);
		border-radius: 0.3rem;
		background: rgb(from var(--party) r g b / 0.12);
	}
	.on-air-head {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		flex-wrap: wrap;
		font-size: 0.85rem;
	}
	.pill {
		padding: 0.1rem 0.35rem;
		border-radius: 0.2rem;
		background: var(--party);
		color: #fff;
		font-size: 0.6rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.muted {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.on-air-figures {
		margin: 0.25rem 0 0.4rem;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: rgb(from var(--color-base-content) r g b / 0.75);
	}
	.on-air-actions {
		display: flex;
		gap: 0.3rem;
	}
	.holds {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0 0 0.5rem;
		flex-wrap: wrap;
	}
	.holds-label {
		margin-right: 0.2rem;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.hold {
		padding: 0.2rem 0.45rem;
		font-size: 0.7rem;
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.4rem;
		margin: 0 0 0.6rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
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
	.cands {
		list-style: none;
		margin: 0 0 0.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.cands li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.35rem 0.45rem;
		background: var(--color-base-300);
		border-radius: 0.3rem;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}
	.who img {
		width: 2rem;
		height: 2rem;
		border-radius: 0.2rem;
		border: 2px solid;
		object-fit: cover;
		object-position: top center;
		flex-shrink: 0;
	}
	.dot {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.who-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.who-text strong {
		font-size: 0.8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.buttons {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}
	button {
		padding: 0.3rem 0.5rem;
		background: var(--color-base-200);
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.6);
		border-radius: 0.25rem;
		color: inherit;
		font: inherit;
		font-size: 0.72rem;
		cursor: pointer;
		white-space: nowrap;
	}
	button:hover {
		border-color: var(--color-primary);
	}
	button.active {
		background: var(--color-primary);
		color: var(--color-primary-content);
		border-color: var(--color-primary);
		font-weight: 700;
	}
	button.hard {
		font-weight: 600;
	}
	button.danger:hover {
		border-color: var(--color-error);
		color: var(--color-error);
	}
	@media (max-width: 640px) {
		.cands li {
			flex-direction: column;
			align-items: flex-start;
		}
		button {
			min-height: 2.25rem;
		}
	}
</style>
