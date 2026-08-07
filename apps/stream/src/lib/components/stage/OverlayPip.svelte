<script lang="ts">
	import type { PipCorner } from '$lib/stream-state';
	import { streamStore } from '$lib/stream-store.svelte';
	import RacePage from '$lib/components/RacePage.svelte';

	// Mutations on `ui.pipCorner` / `ui.pipVisible` / `ui.pipMinimized` go
	// straight through the shared streamStore singleton — avoids Svelte 5's
	// cross-component ownership warning and keeps the PiP in lockstep with
	// /overlay (which subscribes to the same store via broadcast).
	const state = $derived(streamStore.state);

	// Render the broadcast canvas (1920x1080) into a PiP frame at host-
	// chosen scale. Bumped from 340px → 520px so the map inside actually
	// reads at a glance — the previous size had the SVG fitting into a
	// ~140px-tall area which hid all the city / region detail.
	//
	// CSS `transform: scale()` keeps the DOM intact (panzoom, animations,
	// lazy SVG loads still fire) so the PiP stays "live", not just a
	// snapshot. Requires explicit width/height on the container so the
	// scaled child doesn't blow out the layout.
	const SOURCE_W = 1920;
	const SOURCE_H = 1080;
	const PIP_W = 520;
	const SCALE = PIP_W / SOURCE_W;
	const PIP_H = SOURCE_H * SCALE;

	const corners: { id: PipCorner; label: string }[] = [
		{ id: 'top-left', label: '↖' },
		{ id: 'top-right', label: '↗' },
		{ id: 'bottom-left', label: '↙' },
		{ id: 'bottom-right', label: '↘' }
	];

	function toggleMinimize() {
		streamStore.state.ui.pipMinimized = !streamStore.state.ui.pipMinimized;
	}
</script>

<div
	class="pip"
	class:minimized={state.ui.pipMinimized}
	data-corner={state.ui.pipCorner}
	style:width="{PIP_W}px"
	style:--pip-h="{PIP_H}px"
>
	<div class="chrome">
		<span class="label">Preview</span>
		<div class="buttons">
			{#each corners as c (c.id)}
				<button
					type="button"
					class="corner-btn"
					class:active={state.ui.pipCorner === c.id}
					title={`Move PiP ${c.id}`}
					aria-label={`Move PiP ${c.id}`}
					onclick={() => (streamStore.state.ui.pipCorner = c.id)}
				>
					{c.label}
				</button>
			{/each}
			<!-- Minimize: collapses the scaled RacePage but keeps the chrome
			     bar so the host can re-expand without losing the PiP entirely.
			     The glyph swaps to "▣" when minimized so the same button
			     reads as "expand". -->
			<button
				type="button"
				class="corner-btn min"
				title={state.ui.pipMinimized ? 'Expand PiP' : 'Minimize PiP'}
				aria-label={state.ui.pipMinimized ? 'Expand PiP' : 'Minimize PiP'}
				aria-pressed={state.ui.pipMinimized}
				onclick={toggleMinimize}
			>
				{state.ui.pipMinimized ? '▣' : '–'}
			</button>
			<button
				type="button"
				class="corner-btn close"
				title="Hide PiP"
				aria-label="Hide PiP"
				onclick={() => (streamStore.state.ui.pipVisible = false)}
			>
				×
			</button>
		</div>
	</div>
	{#if !state.ui.pipMinimized}
		<div
			class="scaler"
			style:width="{SOURCE_W}px"
			style:height="{SOURCE_H}px"
			style:transform="scale({SCALE})"
		>
			<RacePage {state} />
		</div>
	{/if}
</div>

<style>
	.pip {
		position: absolute;
		z-index: 3;
		background: #0b0b0e;
		border: 1px solid var(--color-secondary);
		border-radius: 0.5rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		height: var(--pip-h);
		transition: height 160ms ease;
	}
	/* Minimized = chrome only. The chrome itself is ~28px tall, so we set
	   `height: auto` and let the chrome flex sets its own size. The
	   `overflow: hidden` keeps the scaler hidden if it briefly remains
	   during the transition. */
	.pip.minimized {
		height: auto;
	}
	.pip[data-corner='bottom-right'] {
		bottom: 0.75rem;
		right: 0.75rem;
	}
	.pip[data-corner='bottom-left'] {
		bottom: 0.75rem;
		left: 0.75rem;
	}
	.pip[data-corner='top-left'] {
		/* Top-left conflicts with the color-tab strip, so nudge down past it. */
		top: 3rem;
		left: 0.75rem;
	}
	.pip[data-corner='top-right'] {
		/* Top-right conflicts with the RegionDetailCard when a region is selected,
		   so we still render but the host should pick a different corner; this is
		   a known ergonomic collision, not a bug. */
		top: 0.75rem;
		right: 0.75rem;
	}
	.chrome {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.25rem 0.5rem;
		background: rgb(from var(--color-base-100) r g b / 0.95);
		border-bottom: 1px solid var(--color-secondary);
		flex-shrink: 0;
	}
	.pip.minimized .chrome {
		border-bottom: none;
	}
	.label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.buttons {
		display: flex;
		gap: 0.125rem;
	}
	.corner-btn {
		background: transparent;
		border: 1px solid transparent;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 0.2rem;
		cursor: pointer;
		font-size: 0.85rem;
		line-height: 1;
		padding: 0;
	}
	.corner-btn:hover {
		color: var(--color-base-content);
		background: rgb(from var(--color-secondary) r g b / 0.5);
	}
	.corner-btn.active {
		color: var(--color-primary-content);
		background: var(--color-primary);
	}
	.corner-btn.min {
		margin-left: 0.25rem;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.corner-btn.min[aria-pressed='true'] {
		color: var(--color-primary);
	}
	.corner-btn.close {
		margin-left: 0.125rem;
	}
	.scaler {
		/* Origin at top-left so the scaled content aligns to the PiP frame; parent
		   .pip has explicit width/height matching SOURCE*SCALE so nothing overflows. */
		transform-origin: 0 0;
		flex-shrink: 0;
	}
	/* The PiP frame is a hard 520px (set inline from PIP_W), which is wider
	   than a phone viewport and would sit on top of both the map and the
	   detail sheet. It's a host-desk convenience for checking the OBS feed,
	   and the phone already has /overlay one tap away, so drop it entirely
	   rather than scale it down to an unreadable thumbnail. */
	@media (max-width: 640px) {
		.pip {
			display: none;
		}
	}
</style>
