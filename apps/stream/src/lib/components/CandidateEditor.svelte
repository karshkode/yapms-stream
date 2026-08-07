<script lang="ts">
	import { v4 as uuid } from 'uuid';
	import type { Candidate } from '../race-profile';
	import type { StreamState } from '../stream-state';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();

	function add() {
		const c: Candidate = {
			id: uuid(),
			name: 'New Candidate',
			partyColor: '#6b7280',
			partyLabel: 'I',
			votes: 0,
			called: false,
			hidden: false,
			headshotUrl: null
		};
		state.candidates = [...state.candidates, c];
		state.ui.dirty = true;
	}

	function remove(id: string) {
		state.candidates = state.candidates.filter((c) => c.id !== id);
		state.ui.dirty = true;
	}

	function markCalled(id: string) {
		state.candidates = state.candidates.map((c) => ({ ...c, called: c.id === id }));
		state.ui.dirty = true;
	}
</script>

<section class="race-card p-4">
	<header class="bar">
		<h3 class="heading">Candidates</h3>
		<button type="button" onclick={add}>+ Add</button>
	</header>
	<div class="rows">
		{#each state.candidates as c (c.id)}
			<div class="row">
				<input
					class="name"
					type="text"
					bind:value={c.name}
					oninput={() => (state.ui.dirty = true)}
				/>
				<input
					class="color"
					type="color"
					bind:value={c.partyColor}
					oninput={() => (state.ui.dirty = true)}
				/>
				<input
					class="party"
					type="text"
					maxlength="3"
					bind:value={c.partyLabel}
					placeholder="D/R/I"
					oninput={() => (state.ui.dirty = true)}
				/>
				<input
					class="votes"
					type="number"
					min="0"
					bind:value={c.votes}
					oninput={() => (state.ui.dirty = true)}
				/>
				<label class="toggle">
					<input
						type="radio"
						name="called"
						checked={c.called}
						onchange={() => markCalled(c.id)}
					/>
					Called
				</label>
				<label class="toggle">
					<input
						type="checkbox"
						bind:checked={c.hidden}
						onchange={() => (state.ui.dirty = true)}
					/>
					Hidden
				</label>
				<button type="button" class="danger" onclick={() => remove(c.id)}>×</button>
			</div>
		{/each}
		{#if state.candidates.length === 0}
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
	.row {
		display: grid;
		grid-template-columns: 1.5fr auto auto auto auto auto auto;
		gap: 0.5rem;
		align-items: center;
		padding: 0.25rem;
		background: var(--color-base-300);
		border-radius: 0.25rem;
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
	.toggle {
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
		.row {
			display: flex;
			flex-wrap: wrap;
			gap: 0.4rem 0.5rem;
			padding: 0.5rem;
		}
		input.name {
			flex: 1 1 100%;
			min-width: 0;
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
		.toggle {
			font-size: 0.75rem;
		}
		button.danger {
			/* Pushed to the trailing edge so it isn't adjacent to the flags
			   a thumb is aiming for. */
			margin-left: auto;
			padding: 0.25rem 0.6rem;
			font-size: 1.15rem;
		}
	}
</style>
