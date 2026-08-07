<script lang="ts">
	import type { Candidate } from '../race-profile';

	interface Props {
		candidates: Candidate[];
	}

	let { candidates }: Props = $props();

	const total = $derived(
		Math.max(
			candidates.reduce((a, c) => a + c.votes, 0),
			1
		)
	);
	const visible = $derived(candidates.filter((c) => !c.hidden));
</script>

<!--
  4px-tall stacked bar at the very top of the race header card — exactly like
  the DDHQ race-page ShareBar. Segments are proportional to each candidate's
  vote share; colors come from candidate.partyColor.
-->
<div class="share-bar" role="img" aria-label="Vote share bar">
	{#each visible as c (c.id)}
		{@const pct = (c.votes / total) * 100}
		{#if pct > 0}
			<span
				class="seg"
				style:flex-grow={pct}
				style:background-color={c.partyColor}
				title={`${c.name}: ${pct.toFixed(1)}%`}
			></span>
		{/if}
	{/each}
</div>

<style>
	.share-bar {
		display: flex;
		width: 100%;
		height: 4px;
		background: var(--color-secondary);
	}
	.seg {
		display: block;
		height: 100%;
	}
</style>
