<script lang="ts">
	import type { RaceTemplate } from '../../race-profile';
	import { highlight } from '../../picker/searchIndex';

	interface Props {
		template: RaceTemplate;
		matchedTokens?: string[];
		highlighted?: boolean;
		onload: () => void;
	}

	let { template, matchedTokens = [], highlighted = false, onload }: Props = $props();
	const labelHtml = $derived(highlight(template.name, matchedTokens));
</script>

<button
	type="button"
	class="row"
	class:highlighted
	onclick={onload}
	tabindex="-1"
	data-template-id={template.id}
>
	<span class="category">{template.category}</span>
	<span class="name">{@html labelHtml}</span>
	<span class="cta">Load</span>
</button>

<style>
	.row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.625rem;
		align-items: center;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-base-content);
		border-radius: 0.375rem;
		cursor: pointer;
		text-align: left;
	}
	.row + .row {
		margin-top: 0.25rem;
	}
	.row:hover,
	.row.highlighted {
		background: var(--color-base-300);
	}
	.category {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.125rem 0.375rem;
		background: var(--color-secondary);
		border-radius: 0.25rem;
		color: rgb(from var(--color-base-content) r g b / 0.75);
	}
	.name {
		font-size: 0.9rem;
	}
	.name :global(mark) {
		background: color-mix(in srgb, var(--color-primary) 40%, transparent);
		color: var(--color-base-content);
		padding: 0 0.125rem;
		border-radius: 0.125rem;
	}
	.cta {
		font-size: 0.75rem;
		color: var(--color-primary);
	}
	@media (max-width: 640px) {
		.row {
			/* The category badge takes a third of a 390px row, which wrapped
			   every "Connecticut — Statewide" onto two lines. The category
			   heading these rows sit under already says what they are. */
			grid-template-columns: 1fr auto;
			min-height: 2.5rem;
		}
		.category {
			display: none;
		}
	}
</style>
