<script lang="ts">
	import type { StreamState } from '../stream-state';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();
</script>

<section class="race-card p-4">
	<h3 class="heading">Data source</h3>
	<div class="grid">
		<label class="field">
			Adapter
			<select bind:value={state.dataSource.adapter}>
				<option value="manual">Manual (host types everything)</option>
				<option value="civicapi">civicAPI (free, no key)</option>
				<option value="clarity">Clarity via Python sidecar (deferred)</option>
				<option value="ddhq">DDHQ (paid, deferred)</option>
			</select>
		</label>
		<label class="field">
			Race ID
			<input type="text" bind:value={state.dataSource.raceId} placeholder="adapter-specific" />
		</label>
		<label class="field">
			Poll interval (ms)
			<input
				type="number"
				min="1000"
				step="1000"
				bind:value={state.dataSource.intervalMs}
			/>
		</label>
		<label class="field">
			Sidecar URL
			<input type="text" bind:value={state.dataSource.sidecarUrl} />
		</label>
		<label class="toggle">
			<input type="checkbox" bind:checked={state.dataSource.running} />
			Running
		</label>
	</div>
	{#if state.dataSource.lastError}
		<p class="error">Last error: {state.dataSource.lastError}</p>
	{/if}
	{#if state.dataSource.lastPolledAt}
		<p class="muted">Last polled: {new Date(state.dataSource.lastPolledAt).toLocaleTimeString()}</p>
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
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.65);
	}
	.toggle {
		display: flex;
		gap: 0.375rem;
		align-items: center;
		font-size: 0.8rem;
	}
	select,
	input[type='text'],
	input[type='number'] {
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.25rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.85rem;
	}
	.error {
		color: var(--color-error);
		font-size: 0.75rem;
		margin: 0.5rem 0 0;
	}
	.muted {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		margin: 0.25rem 0 0;
	}
</style>
