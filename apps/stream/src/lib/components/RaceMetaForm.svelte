<script lang="ts">
	import type { StreamState } from '../stream-state';
	import { formatTimeInZone, TIME_ZONE_CHOICES } from '../time-zone';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();

	// Preview the clock the overlay will show, because the whole point of the
	// field is that it may not be the time on the host's own wall — so "Central"
	// alone doesn't confirm they picked the right one, but "9:41 PM CDT" does.
	// Only needs to be right to the minute the host is looking at it.
	const clockPreview = $derived(formatTimeInZone(new Date(), state.race.timeZone));
</script>

<section class="race-card p-4">
	<h3 class="heading">Race meta</h3>
	<div class="grid">
		<label class="field">
			Title
			<input type="text" bind:value={state.race.title} oninput={() => (state.ui.dirty = true)} />
		</label>
		<label class="field">
			Party badge letter
			<input
				type="text"
				maxlength="2"
				bind:value={state.race.partyBadge}
				oninput={() => (state.ui.dirty = true)}
			/>
		</label>
		<label class="field">
			Badge color
			<input
				type="color"
				bind:value={state.race.partyBadgeColor}
				oninput={() => (state.ui.dirty = true)}
			/>
		</label>
		<label class="field">
			Date label
			<input
				type="text"
				placeholder="May 5, 2026"
				bind:value={state.race.dateLabel}
				oninput={() => (state.ui.dirty = true)}
			/>
		</label>
		<label class="field">
			Polls close label
			<input
				type="text"
				placeholder="Polls close 7:30 PM EDT"
				bind:value={state.race.pollsCloseLabel}
				oninput={() => (state.ui.dirty = true)}
			/>
		</label>
		<label class="field">
			Overlay clock — {clockPreview}
			<select
				value={state.race.timeZone ?? ''}
				onchange={(e) => {
					state.race.timeZone = (e.currentTarget as HTMLSelectElement).value || null;
					state.ui.dirty = true;
				}}
			>
				<!-- Loading a race sets this from its state, so the override is only
				     for the fourteen states split across two zones and for a race the
				     resolver couldn't place. -->
				<option value="">This computer</option>
				{#each TIME_ZONE_CHOICES as choice (choice.zone)}
					<option value={choice.zone}>{choice.label}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			#DecisionMade label
			<input
				type="text"
				placeholder="#DecisionMade Nov 5, 11:00 PM EST"
				value={state.race.decisionMadeLabel ?? ''}
				oninput={(e) => {
					state.race.decisionMadeLabel = (e.currentTarget as HTMLInputElement).value || null;
					state.ui.dirty = true;
				}}
			/>
		</label>
		<label class="field">
			Reported % label
			<input
				type="text"
				placeholder=">95% or 47.3%"
				value={state.race.reportedPctLabel ?? ''}
				oninput={(e) => {
					state.race.reportedPctLabel = (e.currentTarget as HTMLInputElement).value || null;
					state.ui.dirty = true;
				}}
			/>
		</label>
		<label class="field">
			Reported % value
			<input
				type="number"
				min="0"
				max="100"
				step="0.1"
				value={state.race.reportedPct ?? 0}
				oninput={(e) => {
					const v = Number((e.currentTarget as HTMLInputElement).value);
					state.race.reportedPct = isNaN(v) ? null : v;
					state.ui.dirty = true;
				}}
			/>
		</label>
		<label class="field">
			Total votes
			<input
				type="number"
				min="0"
				value={state.race.totalVotes ?? 0}
				oninput={(e) => {
					const v = Number((e.currentTarget as HTMLInputElement).value);
					state.race.totalVotes = isNaN(v) ? null : v;
					state.ui.dirty = true;
				}}
			/>
		</label>
	</div>
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
		/* auto-fit rather than a fixed 3 columns so the fields reflow to two
		   and then one as the drawer narrows, instead of squeezing three
		   unusable inputs into a phone width. */
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.65);
	}
	input[type='text'],
	input[type='number'],
	select {
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.25rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.85rem;
	}
	input[type='color'] {
		height: 1.75rem;
		padding: 0;
		background: transparent;
		border: 1px solid var(--color-secondary);
		border-radius: 0.25rem;
	}
	@media (max-width: 640px) {
		/* Matches the swatch in CandidateEditor; 1.75rem is under a thumb. */
		input[type='color'] {
			height: 2.25rem;
		}
	}
</style>
