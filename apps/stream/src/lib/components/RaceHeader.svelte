<script lang="ts">
	import type { StreamState } from '../stream-state';
	import ShareBar from './ShareBar.svelte';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();
</script>

<header class="race-card">
	<ShareBar candidates={state.candidates} />
	<div class="content">
		<div class="top">
			<span
				class="party-badge"
				style:background-color={state.race.partyBadgeColor}
				aria-label={`Party: ${state.race.partyBadge}`}
			>
				{state.race.partyBadge}
			</span>
			<h2 class="title">{state.race.title || 'Untitled race'}</h2>
		</div>
		<div class="meta">
			{#if state.race.dateLabel}
				<span class="date">{state.race.dateLabel}</span>
			{/if}
			{#if state.race.pollsCloseLabel}
				<span class="polls">{state.race.pollsCloseLabel}</span>
			{/if}
		</div>
		{#if state.race.decisionMadeLabel}
			<div class="decision-made">{state.race.decisionMadeLabel}</div>
		{/if}
	</div>
</header>

<style>
	.content {
		padding: 0.75rem 1rem 1rem;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}
	.party-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 999px;
		font-weight: 700;
		font-size: 0.75rem;
		color: white;
	}
	.title {
		font-size: 1.125rem;
		font-weight: 600;
		margin: 0;
		color: var(--color-base-content);
	}
	.meta {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.375rem;
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.decision-made {
		margin-top: 0.5rem;
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.65);
		font-style: italic;
	}
</style>
