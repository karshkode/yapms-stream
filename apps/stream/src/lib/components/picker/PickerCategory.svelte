<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		count: number;
		open: boolean;
		onToggle: () => void;
		children: Snippet;
	}

	let { label, count, open, onToggle, children }: Props = $props();
</script>

<section class="category">
	<button type="button" class="expander" aria-expanded={open} onclick={onToggle}>
		<span class="chev" class:open>{open ? '▾' : '▸'}</span>
		<span class="label">{label}</span>
		<span class="count">{count}</span>
	</button>
	{#if open}
		<div class="body">{@render children()}</div>
	{/if}
</section>

<style>
	.category + :global(.category) {
		margin-top: 0.5rem;
	}
	.expander {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		background: transparent;
		border: none;
		color: var(--color-base-content);
		padding: 0.375rem 0.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		text-align: left;
		font: inherit;
	}
	.expander:hover {
		background: var(--color-base-300);
	}
	.chev {
		width: 0.75rem;
		text-align: center;
	}
	.label {
		flex-grow: 1;
		font-weight: 500;
	}
	.count {
		font-size: 0.7rem;
		padding: 0.0625rem 0.375rem;
		background: var(--color-secondary);
		border-radius: 999px;
	}
	.body {
		padding: 0.5rem 0.5rem 0.5rem 1.5rem;
	}
</style>
