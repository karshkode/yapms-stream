<script lang="ts">
	import type { StreamState } from '../../stream-state';
	import type { SavedRaceRef } from '../../stream-state';
	import { deleteSaved, duplicateSaved, renameSaved } from '../../picker/saved';

	interface Props {
		state: StreamState;
		onload: (ref: SavedRaceRef) => void;
		onmutate: (next: StreamState['savedRaces']) => void;
	}

	let { state, onload, onmutate }: Props = $props();
</script>

<div class="saved">
	{#if state.savedRaces.bookmarked.length === 0}
		<p class="empty">
			Load a template, edit candidates, then click "Save current race" below to bookmark it for
			election night.
		</p>
	{:else}
		<ul class="list">
			{#each state.savedRaces.bookmarked as row (row.id)}
				<li>
					<div class="info">
						<strong>{row.label}</strong>
						<span class="sub">
							Saved {new Date(row.savedAt).toLocaleString()}
							{#if row.templateId}
								· {row.templateId}
							{/if}
						</span>
					</div>
					<div class="actions">
						<button type="button" onclick={() => onload(row)}>Load</button>
						<button
							type="button"
							onclick={() => onmutate(duplicateSaved(state.savedRaces, row.id))}
						>
							Duplicate
						</button>
						<button
							type="button"
							onclick={() => {
								const label = prompt('Rename to:', row.label);
								if (label) onmutate(renameSaved(state.savedRaces, row.id, label));
							}}
						>
							Rename
						</button>
						<button
							type="button"
							class="danger"
							onclick={() => {
								if (confirm(`Delete '${row.label}'?`))
									onmutate(deleteSaved(state.savedRaces, row.id));
							}}
						>
							Delete
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.empty {
		padding: 0.75rem;
		font-size: 0.8rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.625rem;
		background: var(--color-base-300);
		border-radius: 0.375rem;
		font-size: 0.85rem;
		gap: 0.5rem;
	}
	.info {
		display: flex;
		flex-direction: column;
	}
	.sub {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.actions {
		display: flex;
		gap: 0.25rem;
	}
	button {
		padding: 0.2rem 0.5rem;
		background: var(--color-secondary);
		color: var(--color-base-content);
		border: none;
		border-radius: 0.25rem;
		font-size: 0.7rem;
		cursor: pointer;
	}
	button:hover {
		background: color-mix(in srgb, var(--color-secondary) 60%, var(--color-base-content) 20%);
	}
	.danger:hover {
		background: var(--color-error);
		color: white;
	}
</style>
