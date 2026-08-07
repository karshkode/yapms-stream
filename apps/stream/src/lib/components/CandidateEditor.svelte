<script lang="ts">
	import { v4 as uuid } from 'uuid';
	import { fillMissingHeadshots, headshotContext } from '$lib/broadcast/candidatePhotoFill';
	import { lookupHeadshot } from '$lib/data/candidatePhotos';
	import type { Candidate } from '../race-profile';
	import type { StreamState } from '../stream-state';

	interface Props {
		// Named `streamState` rather than `state`: a local `state` binding makes
		// svelte-check read every `$state(...)` in the file as a store
		// subscription on it. Same workaround as FormsDrawer / StateRacesCard.
		streamState: StreamState;
	}

	let { streamState }: Props = $props();

	// Which row has its photo panel open. Only one at a time, so a plain id
	// beats tracking a set — and it keeps the drawer from turning into a wall
	// of URL fields on a phone.
	let photoRowId = $state<string | null>(null);
	let bulkStatus = $state<string | null>(null);
	let bulkBusy = $state(false);
	let rowBusyId = $state<string | null>(null);

	function add() {
		const c: Candidate = {
			id: uuid(),
			name: 'New Candidate',
			partyColor: '#6b7280',
			partyLabel: 'I',
			votes: 0,
			called: false,
			hidden: false,
			headshotUrl: null,
			headshotCredit: null
		};
		streamState.candidates = [...streamState.candidates, c];
		streamState.ui.dirty = true;
	}

	function remove(id: string) {
		streamState.candidates = streamState.candidates.filter((c) => c.id !== id);
		streamState.ui.dirty = true;
	}

	function markCalled(id: string) {
		streamState.candidates = streamState.candidates.map((c) => ({ ...c, called: c.id === id }));
		streamState.ui.dirty = true;
	}

	// Photo edits skip the dirty flag on purpose: dirty tells the poll loop the
	// host has taken over the roster, which stops live vote updates. A picture
	// is presentation, not data, so it must not freeze the count.
	// `preserveHeadshots` is what keeps these values across poll ticks.
	async function findAll() {
		bulkBusy = true;
		bulkStatus = 'Searching Wikipedia…';
		try {
			const res = await fillMissingHeadshots();
			if (res.attempted === 0) bulkStatus = 'Every candidate already has a photo.';
			else if (res.throttled && res.resolved === 0)
				bulkStatus = 'Wikipedia is rate-limiting us — try again in a minute.';
			else bulkStatus = `Found ${res.resolved} of ${res.attempted}.`;
		} catch (err) {
			bulkStatus = err instanceof Error ? err.message : String(err);
		} finally {
			bulkBusy = false;
		}
	}

	async function findOne(c: Candidate) {
		rowBusyId = c.id;
		try {
			const hit = await lookupHeadshot(c.name, headshotContext(streamState));
			const row = streamState.candidates.find((x) => x.id === c.id);
			if (!row) return;
			if (hit) {
				row.headshotUrl = hit.url;
				row.headshotCredit = hit.pageTitle;
			} else {
				row.headshotCredit = 'No match on Wikipedia';
			}
		} finally {
			rowBusyId = null;
		}
	}

	function clearPhoto(c: Candidate) {
		const row = streamState.candidates.find((x) => x.id === c.id);
		if (!row) return;
		row.headshotUrl = null;
		row.headshotCredit = null;
	}
</script>

<section class="race-card p-4">
	<header class="bar">
		<h3 class="heading">Candidates</h3>
		<div class="bar-actions">
			<button
				type="button"
				onclick={findAll}
				disabled={bulkBusy || streamState.candidates.length === 0}
			>
				{bulkBusy ? 'Searching…' : 'Find photos'}
			</button>
			<button type="button" onclick={add}>+ Add</button>
		</div>
	</header>
	{#if bulkStatus}
		<p class="bulk-status">{bulkStatus}</p>
	{/if}
	<div class="rows">
		{#each streamState.candidates as c (c.id)}
			<div class="row">
				<button
					type="button"
					class="avatar"
					class:open={photoRowId === c.id}
					aria-expanded={photoRowId === c.id}
					title={c.headshotCredit ? `Photo: ${c.headshotCredit}` : 'Set a photo'}
					onclick={() => (photoRowId = photoRowId === c.id ? null : c.id)}
				>
					{#if c.headshotUrl}
						<img src={c.headshotUrl} alt="" />
					{:else}
						<span class="initial">{c.name.slice(0, 1) || '?'}</span>
					{/if}
				</button>
				<input
					class="name"
					type="text"
					bind:value={c.name}
					oninput={() => (streamState.ui.dirty = true)}
				/>
				<input
					class="color"
					type="color"
					bind:value={c.partyColor}
					oninput={() => (streamState.ui.dirty = true)}
				/>
				<input
					class="party"
					type="text"
					maxlength="3"
					bind:value={c.partyLabel}
					placeholder="D/R/I"
					oninput={() => (streamState.ui.dirty = true)}
				/>
				<input
					class="votes"
					type="number"
					min="0"
					bind:value={c.votes}
					oninput={() => (streamState.ui.dirty = true)}
				/>
				<!-- `flag`, not `toggle`: daisyUI ships a `.toggle` switch
				     component whose fixed 40x24 box was overriding this label's
				     intrinsic width and clipping the caption. -->
				<label class="flag">
					<input type="radio" name="called" checked={c.called} onchange={() => markCalled(c.id)} />
					Called
				</label>
				<label class="flag">
					<input
						type="checkbox"
						bind:checked={c.hidden}
						onchange={() => (streamState.ui.dirty = true)}
					/>
					Hidden
				</label>
				<button type="button" class="danger" onclick={() => remove(c.id)}>×</button>
			</div>
			{#if photoRowId === c.id}
				<div class="photo-panel">
					<input
						type="url"
						class="photo-url"
						placeholder="https://… headshot image URL"
						bind:value={c.headshotUrl}
					/>
					<button type="button" onclick={() => findOne(c)} disabled={rowBusyId === c.id}>
						{rowBusyId === c.id ? 'Searching…' : 'Find on Wikipedia'}
					</button>
					<button type="button" onclick={() => clearPhoto(c)} disabled={!c.headshotUrl}>
						Clear
					</button>
					{#if c.headshotCredit}
						<span class="credit">{c.headshotCredit}</span>
					{/if}
				</div>
			{/if}
		{/each}
		{#if streamState.candidates.length === 0}
			<p class="empty">No candidates yet. Click + Add or load a template.</p>
		{/if}
	</div>
</section>

<style>
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.heading {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.bar-actions {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}
	.bulk-status {
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.row {
		display: grid;
		grid-template-columns: auto 1.5fr auto auto auto auto auto auto;
		gap: 0.5rem;
		align-items: center;
		padding: 0.25rem;
		background: var(--color-base-300);
		border-radius: 0.25rem;
	}
	.avatar {
		width: 2rem;
		height: 2rem;
		padding: 0;
		border-radius: 999px;
		overflow: hidden;
		background: var(--color-base-200);
		border: 1px solid var(--color-secondary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.avatar.open {
		border-color: var(--color-primary);
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		/* Commons portraits are usually framed with headroom; nudging the crop
		   up keeps the face centred in a 2rem circle. */
		object-position: center 20%;
	}
	.avatar .initial {
		font-size: 0.8rem;
		font-weight: 600;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.photo-panel {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
		padding: 0.5rem;
		margin-top: -0.125rem;
		background: var(--color-base-200);
		border: 1px solid var(--color-secondary);
		border-radius: 0.25rem;
	}
	.photo-panel .photo-url {
		flex: 1 1 14rem;
		min-width: 0;
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.25rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
	}
	.photo-panel .credit {
		flex: 1 1 100%;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	input[type='text'],
	input[type='number'] {
		background: var(--color-base-200);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.25rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.85rem;
	}
	input[type='color'] {
		width: 2rem;
		height: 1.75rem;
		border: 1px solid var(--color-secondary);
		border-radius: 0.25rem;
		background: transparent;
		padding: 0;
	}
	input.votes {
		width: 6rem;
	}
	input.party {
		width: 3rem;
		text-align: center;
	}
	.flag {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.7rem;
	}
	button {
		padding: 0.25rem 0.5rem;
		background: var(--color-secondary);
		border: none;
		color: var(--color-base-content);
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.8rem;
	}
	button.danger {
		background: transparent;
		color: var(--color-error);
		padding: 0.125rem 0.375rem;
		font-size: 1rem;
		line-height: 1;
	}
	.empty {
		font-size: 0.8rem;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		padding: 0.75rem;
	}
	/* Phone layout. Seven columns in a ~360px drawer leaves the name field
	   about four characters wide, so the row becomes a wrapping stack: name
	   on its own line, then the colour / party / votes controls and the two
	   flags flowing beneath it. */
	@media (max-width: 640px) {
		.bar button {
			min-height: 2.25rem;
			padding-inline: 0.7rem;
		}
		.row {
			display: flex;
			flex-wrap: wrap;
			gap: 0.4rem 0.5rem;
			padding: 0.5rem;
		}
		.avatar {
			width: 2.25rem;
			height: 2.25rem;
		}
		input.name {
			/* Shares the first line with the avatar rather than taking a whole
			   row to itself, so the row still opens with a recognisable face. */
			flex: 1 1 8rem;
			min-width: 0;
			min-height: 2.25rem;
		}
		.photo-panel button {
			min-height: 2.25rem;
		}
		.photo-panel .photo-url {
			flex: 1 1 100%;
			min-height: 2.25rem;
		}
		input.votes {
			/* Grows into the leftover space instead of holding a fixed 6rem. */
			flex: 1 1 5rem;
			width: auto;
			min-height: 2.25rem;
		}
		input.party {
			min-height: 2.25rem;
		}
		input[type='color'] {
			width: 2.5rem;
			height: 2.25rem;
		}
		.flag {
			font-size: 0.75rem;
			/* The label is the tap target — clicking it toggles the input — so
			   give it thumb height rather than leaving a ~13px native box. */
			flex: 0 0 auto;
			min-height: 2.25rem;
			padding-inline: 0.2rem;
		}
		.flag input {
			flex: 0 0 auto;
			width: 1.15rem;
			height: 1.15rem;
		}
		button.danger {
			/* Pushed to the trailing edge so it isn't adjacent to the flags
			   a thumb is aiming for. */
			margin-left: auto;
			min-height: 2.25rem;
			padding: 0.25rem 0.6rem;
			font-size: 1.15rem;
		}
	}
</style>
