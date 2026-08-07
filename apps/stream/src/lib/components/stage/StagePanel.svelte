<script lang="ts">
	import type { MapTab } from '$lib/race-profile';
	import MapView from '$lib/components/MapView.svelte';
	import CandidatesTable from '$lib/components/CandidatesTable.svelte';
	import RaceHeader from '$lib/components/RaceHeader.svelte';
	import { streamStore } from '$lib/stream-store.svelte';
	import RegionDetailCard from './RegionDetailCard.svelte';
	import RegionListPanel from './RegionListPanel.svelte';
	import StateRacesCard from './StateRacesCard.svelte';
	import StatewideResultsCard from './StatewideResultsCard.svelte';
	import OverlayPip from './OverlayPip.svelte';

	interface Props {
		/**
		 * When false, the stage renders as a read-only mirror: no tab strip,
		 * no zoom controls, no PiP, detail card's close button hidden, and
		 * pointer events disabled on the map so the OBS capture window can't
		 * accidentally trigger zooms. `/overlay` passes interactive={false}
		 * to reuse this exact layout as its canvas. Defaults to true so
		 * existing `/control` usage keeps its full interactivity.
		 */
		interactive?: boolean;
		/**
		 * When interactive=false, we still render the detail card (otherwise
		 * the OBS viewer wouldn't see the host's selection) but hide the PiP
		 * preview (which is only useful on the host desk) unless explicitly
		 * overridden.
		 */
		showPip?: boolean;
	}

	let { interactive = true, showPip = true }: Props = $props();

	// StagePanel reads and writes the app-level `streamStore` singleton
	// directly. We intentionally don't accept a `state` prop even though both
	// `/control` and `/overlay` have access to their own streamStore — because
	// Svelte 5's strict-mode "ownership_invalid_mutation" warning fires when
	// a component mutates a prop that wasn't `bind:`-ed. Reaching into the
	// shared singleton sidesteps that ownership model entirely and keeps the
	// reactivity graph simple. Both routes publish/subscribe the same
	// singleton via sync/broadcast, so /overlay still mirrors /control.
	const state = $derived(streamStore.state);

	const tabs: { id: MapTab; label: string }[] = [
		{ id: 'results', label: 'Results' },
		{ id: 'margin', label: 'Margin' },
		{ id: 'swing', label: 'Swing' },
		{ id: 'remaining', label: 'Remaining' }
	];

	// Only show the race-picker StateRacesCard on the blank Browse US
	// homepage — that's the one place where clicking a state should open a
	// list of "what's on right now in this state" races. For every real
	// race (us-president-2024, us-senate-2024, state-statewide-*, etc.) a
	// state click should open the RegionDetailCard instead, because the
	// host wants to talk about that state's result in THIS race — live
	// leader, margin, 2024 baseline — not nav away to another race.
	//
	// Previous heuristic was `regionLabel === 'States'` but that falsely
	// picked up every US-wide race. The browse shell is the only profile
	// without a real race loaded, so matching on id is both simpler and
	// correct.
	let isBrowseShell = $derived(state.profile?.id === 'browse-us');

	// Local-no-map templates (Allen Mayor, propositions, school board, etc.)
	// have `geography: null` — no SVG to render. Instead of leaving the
	// stage blank, we center a RaceHeader + CandidatesTable so the host
	// still has a meaningful card to point the OBS scene at. The map tabs
	// strip is hidden in this mode; only the archival slider + edit drawer
	// make sense for these races.
	let hasMap = $derived(!!state.profile?.geography);
</script>

<div class="stage" class:readonly={!interactive}>
	{#if interactive && hasMap}
		<!-- Color-tab strip floats over the top-left of the stage. It's the same
		     MapTab set used in GeographySection (for /overlay parity) but rendered
		     as a pill row so the map can breathe full-bleed behind it. Hidden on
		     no-map profiles (e.g. local races) because they're meaningless there. -->
		<div class="tabs" role="tablist">
			{#each tabs as t (t.id)}
				<button
					type="button"
					class="tab"
					class:active={state.ui.activeMapTab === t.id}
					role="tab"
					aria-selected={state.ui.activeMapTab === t.id}
					onclick={() => (streamStore.state.ui.activeMapTab = t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>
	{/if}

	{#if state.profile && hasMap}
		<MapView
			tab={state.ui.activeMapTab}
			fill
			readonly={!interactive}
			onselect={interactive
				? (attr) => {
						// Toggle so re-clicking a selected region dismisses — the host
						// can clear selection without aiming at empty space.
						streamStore.state.ui.selectedRegionAttr =
							state.ui.selectedRegionAttr === attr ? null : attr;
					}
				: undefined}
			onregionsextracted={(rows) => {
				// Only auto-seed when the template didn't ship regions. Important:
				// don't clobber the us-president baseline (which seeds regions with
				// archival data) — its rows are already populated before the SVG
				// loads.
				if (state.regions.length > 0) return;
				streamStore.state.regions = rows;
			}}
		/>
	{:else if state.profile}
		<!-- No-map race: centered candidate card so the OBS scene still has
		     something worth pointing at. RaceHeader carries polls-close time
		     + party badge; CandidatesTable handles the leader highlight and
		     reported-pct bar at the bottom. Wrapped in a max-width shell so
		     the card doesn't stretch comically on 1080p+ stages. -->
		<div class="no-map-shell">
			<div class="no-map-card">
				{#if state.ui.visible.header}
					<RaceHeader {state} />
				{/if}
				<CandidatesTable {state} />
				{#if state.candidates.length === 0}
					<p class="no-cands">
						No candidates loaded yet. Open the Edit drawer (<kbd>e</kbd>) and add them, or let
						civicAPI polling populate them for live races.
					</p>
				{/if}
			</div>
		</div>
	{:else}
		<div class="placeholder">
			<p>Pick a race template to start — <kbd>⌘</kbd><kbd>K</kbd> or the Templates button above.</p>
		</div>
	{/if}

	{#if state.ui.selectedRegionAttr && hasMap}
		<div
			class="detail-slot corner-{state.ui.detailCardCorner}"
			class:regions-shifted={state.ui.regionListOpen && state.regions.length > 0}
		>
			{#if isBrowseShell}
				<StateRacesCard
					streamState={state}
					{interactive}
					onclose={() => (streamStore.state.ui.selectedRegionAttr = null)}
				/>
			{:else}
				<RegionDetailCard
					{interactive}
					onclose={() => (streamStore.state.ui.selectedRegionAttr = null)}
				/>
			{/if}
		</div>
	{:else if hasMap && !isBrowseShell && state.candidates.length > 0}
		<!-- No region selected on a loaded race → show the statewide tally.
		     This is the "CNN scoreboard" that surfaces the full candidate list
		     + vote counts the moment the race loads, so the host doesn't have
		     to click a county to see the headline numbers. Suppressed on the
		     browse-us shell (no candidates there) and on no-map local races
		     (those already render CandidatesTable in the no-map-shell). -->
		<div
			class="detail-slot corner-{state.ui.detailCardCorner}"
			class:regions-shifted={state.ui.regionListOpen && state.regions.length > 0}
		>
			<StatewideResultsCard {interactive} />
		</div>
	{/if}

	<!-- Left-edge regions navigator. Only on /control (interactive=true) so
	     the OBS capture stays clean. The component itself no-ops when
	     `state.regions` is empty (browse-us shell pre-state-click, or
	     no-map races), so we don't need an extra guard here. -->
	{#if interactive && hasMap}
		<RegionListPanel />
	{/if}

	{#if showPip && interactive && state.ui.pipVisible && state.profile}
		<OverlayPip />
	{/if}
</div>

<style>
	.stage {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		background: var(--color-base-300);
		overflow: hidden;
	}
	.stage.readonly {
		/* Prevent stray mouse input on the OBS capture from triggering
		   panzoom drags. Clicks from `/control` still arrive via the
		   BroadcastChannel state sync, so selectedRegionAttr still updates. */
		pointer-events: none;
	}
	.tabs {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 5;
		display: flex;
		gap: 0.25rem;
		padding: 0.25rem;
		background: rgb(from var(--color-base-100) r g b / 0.75);
		backdrop-filter: blur(6px);
		border-radius: 999px;
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
	}
	.tab {
		background: transparent;
		border: 1px solid transparent;
		color: rgb(from var(--color-base-content) r g b / 0.7);
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.tab:hover {
		color: var(--color-base-content);
	}
	.tab.active {
		color: var(--color-base-content);
		background: var(--color-primary);
		color: var(--color-primary-content);
	}
	.detail-slot {
		position: absolute;
		z-index: 4;
		/* Defaults so the card is always visible even if `detailCardCorner`
		   is somehow missing or the corner-* class doesn't match (e.g. stale
		   localStorage from a pre-corner-cycle build). The corner-* classes
		   below override these to land in the host-chosen quadrant. */
		top: 0.75rem;
		right: 0.75rem;
		/* Never taller than the viewport so the card can scroll if a region has
		   lots of candidates. */
		max-height: calc(100% - 1.5rem);
		overflow: auto;
	}
	/* Reset the defaults when an explicit corner is selected, so e.g.
	   `corner-bottom-left` doesn't end up pinned to both top-right AND
	   bottom-left at the same time. */
	.detail-slot.corner-top-right,
	.detail-slot.corner-top-left,
	.detail-slot.corner-bottom-right,
	.detail-slot.corner-bottom-left {
		top: auto;
		right: auto;
		bottom: auto;
		left: auto;
	}
	/* Corner placement is host-controlled via the card's "move" button which
	   writes to streamStore.state.ui.detailCardCorner. The map zoom/cities
	   controls are docked bottom-right (see MapView.svelte) so the default
	   top-right card position keeps both visible without overlap. */
	.detail-slot.corner-top-right {
		top: 0.75rem;
		right: 0.75rem;
	}
	.detail-slot.corner-top-left {
		top: 0.75rem;
		left: 0.75rem;
	}
	.detail-slot.corner-bottom-right {
		bottom: 0.75rem;
		right: 0.75rem;
	}
	.detail-slot.corner-bottom-left {
		bottom: 0.75rem;
		left: 0.75rem;
	}
	/* When the RegionListPanel is open on the left edge it claims a 14rem
	   wide column starting at left:0.75rem. Without this offset, any
	   left-anchored detail card lands underneath it and the host sees a
	   half-occluded "Kentucky is not loading any events" — the events
	   were there, just hidden. Shift past the panel + its 0.5rem gutter. */
	.detail-slot.corner-top-left.regions-shifted,
	.detail-slot.corner-bottom-left.regions-shifted {
		left: 15.25rem;
	}
	.placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		font-size: 0.9rem;
		text-align: center;
		padding: 2rem;
	}
	.placeholder kbd {
		background: var(--color-base-200);
		border: 1px solid var(--color-secondary);
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		margin: 0 0.1rem;
	}
	.no-map-shell {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		overflow-y: auto;
	}
	.no-map-card {
		width: 100%;
		max-width: 36rem;
		background: var(--color-base-100);
		border: 1px solid var(--color-secondary);
		border-radius: 0.5rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.no-cands {
		padding: 1rem;
		margin: 0;
		font-size: 0.85rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		text-align: center;
		border-top: 1px solid var(--color-secondary);
	}
	.no-cands kbd {
		background: var(--color-base-200);
		border: 1px solid var(--color-secondary);
		padding: 0.05rem 0.3rem;
		border-radius: 0.2rem;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
	}
	/* Phone layout. The stage is built from absolutely-positioned corner
	   overlays sized in rem, which at 390px wide all land on top of each
	   other and on top of the map. Rather than shrink each one, the detail
	   card becomes a bottom sheet spanning the full width, and the map keeps
	   the upper half of the stage to itself. */
	@media (max-width: 640px) {
		.detail-slot,
		.detail-slot.corner-top-right,
		.detail-slot.corner-top-left,
		.detail-slot.corner-bottom-right,
		.detail-slot.corner-bottom-left,
		/* The regions-shifted offset exists to clear a 14rem left-edge
		   column, but at this width the region panel is a full-stage
		   overlay instead, so the 15.25rem indent would only push the
		   sheet off-screen. */
		.detail-slot.corner-top-left.regions-shifted,
		.detail-slot.corner-bottom-left.regions-shifted {
			top: auto;
			bottom: 0;
			left: 0;
			right: 0;
			max-height: 50%;
			border-top: 1px solid var(--color-secondary);
		}
		.tabs {
			/* Centered and scrollable: four pills at 0.75rem padding are
			   wider than the screen once the safe gutters are taken out. */
			top: 0.5rem;
			left: 0.5rem;
			right: 0.5rem;
			overflow-x: auto;
			justify-content: flex-start;
			scrollbar-width: none;
		}
		.tabs::-webkit-scrollbar {
			display: none;
		}
		.tab {
			padding: 0.35rem 0.6rem;
			white-space: nowrap;
		}
		.no-map-shell {
			padding: 0.75rem;
		}
		.placeholder {
			padding: 1rem;
			font-size: 0.85rem;
		}
	}
</style>
