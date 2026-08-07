<script lang="ts">
	import type { StreamState } from '../stream-state';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();

	const sections: Array<{ id: keyof StreamState['ui']['visible']; label: string; hint: string }> = [
		{ id: 'header', label: 'Header', hint: 'Race title, polls-close, party badge' },
		{ id: 'candidates', label: 'Candidates', hint: 'Candidate cards + vote totals' },
		{ id: 'performance', label: 'Performance', hint: 'Historical performance strip' },
		{ id: 'geography', label: 'Geography map', hint: 'Full-bleed SVG map' },
		{ id: 'regions', label: 'Regions table', hint: 'Sortable region table with search' }
	];
</script>

<section class="race-card p-4">
	<h3 class="heading">Visible sections</h3>
	<p class="sub">Toggles what /overlay renders for OBS — not the control panel itself.</p>
	<ul class="toggles">
		{#each sections as s (s.id)}
			<li>
				<!-- `vis-row` / `vis-copy` rather than `toggle` / `label`:
				     daisyUI ships components under both of those names, and
				     their `width: 40px` and `width: 0` were winning over this
				     scoped CSS (which never declares a width), collapsing each
				     row to a 40px stub with the caption spilling out. -->
				<label class="vis-row">
					<input
						type="checkbox"
						role="switch"
						aria-checked={state.ui.visible[s.id]}
						bind:checked={state.ui.visible[s.id]}
					/>
					<span class="track" aria-hidden="true">
						<span class="thumb"></span>
					</span>
					<span class="vis-copy">
						<span class="label-main">{s.label}</span>
						<span class="label-hint">{s.hint}</span>
					</span>
				</label>
			</li>
		{/each}
	</ul>
</section>

<style>
	.heading {
		margin: 0 0 0.25rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.sub {
		margin: 0 0 0.75rem;
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.toggles {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 0.5rem;
	}
	.vis-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		background: rgb(from var(--color-base-200) r g b / 0.6);
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
		border-radius: 0.5rem;
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.vis-row:hover {
		background: rgb(from var(--color-base-200) r g b / 0.9);
		border-color: var(--color-secondary);
	}
	/* The native input sits in the document for keyboard + form semantics but
	   visually we render our own track + thumb. Using `appearance: none` +
	   `position: absolute` keeps it focusable without showing the OS widget,
	   which looked lumpy on Windows and mismatched across macOS Chrome/FF. */
	.vis-row input[type='checkbox'] {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 0;
		height: 0;
	}
	.track {
		position: relative;
		width: 2.25rem;
		height: 1.25rem;
		background: rgb(from var(--color-base-300) r g b / 0.9);
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.7);
		border-radius: 999px;
		flex-shrink: 0;
		transition: background 150ms ease, border-color 150ms ease;
	}
	.thumb {
		position: absolute;
		top: 1px;
		left: 1px;
		width: 1rem;
		height: 1rem;
		background: #e5e7eb;
		border-radius: 50%;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
		transition: transform 150ms ease, background 150ms ease;
	}
	.vis-row input:checked ~ .track {
		background: var(--color-primary);
		border-color: var(--color-primary);
	}
	.vis-row input:checked ~ .track .thumb {
		transform: translateX(1rem);
		background: #fff;
	}
	.vis-row input:focus-visible ~ .track {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.vis-copy {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		min-width: 0;
	}
	.label-main {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-base-content);
	}
	.label-hint {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
</style>
