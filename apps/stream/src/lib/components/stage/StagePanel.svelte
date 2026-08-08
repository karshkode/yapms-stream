<script lang="ts">
	import type { MapTab } from '$lib/race-profile';
	import MapView from '$lib/components/MapView.svelte';
	import CandidatesTable from '$lib/components/CandidatesTable.svelte';
	import RaceHeader from '$lib/components/RaceHeader.svelte';
	import { streamStore } from '$lib/stream-store.svelte';
	import CallCard from '$lib/components/broadcast/CallCard.svelte';
	import InsightsStrip from '$lib/components/broadcast/InsightsStrip.svelte';
	import MapLegend from './MapLegend.svelte';
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

	// Each tab is a question about the map, and the title attribute says which,
	// because "Turnout" and "Swing" are only obvious once you already know what
	// they compare against.
	const tabs: { id: MapTab; label: string; hint: string }[] = [
		{ id: 'results', label: 'Results', hint: 'Who leads each region' },
		{ id: 'margin', label: 'Margin', hint: 'How close each region is' },
		{ id: 'swing', label: 'Swing', hint: 'Which way each region moved since the baseline race' },
		{
			id: 'turnout',
			label: 'Turnout',
			hint: "Each region's share of the vote versus the baseline race"
		},
		{ id: 'remaining', label: 'Remaining', hint: 'Where the uncounted vote is' }
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

	// Which results card the current selection calls for, or null when there's
	// nothing to show (browse home before a state click, no-map races that
	// already render their own candidate table).
	type CardKind = 'stateRaces' | 'region' | 'statewide';
	let cardKind = $derived.by<CardKind | null>(() => {
		if (!hasMap) return null;
		if (state.ui.selectedRegionAttr) return isBrowseShell ? 'stateRaces' : 'region';
		if (!isBrowseShell && state.candidates.length > 0) return 'statewide';
		return null;
	});

	// Docked mode puts the results card in a real column beside the map instead
	// of floating it in a corner on top of the map. That's the difference
	// between a scoreboard that's part of the scene and a card covering the
	// counties the host is trying to point at — and because the map then gets
	// its own box, MapView's click-to-zoom centres regions in the space it
	// actually owns rather than behind the card.
	//
	// The dock only mounts when there's a card to put in it, so the browse-home
	// map still gets the full stage until the host clicks a state.
	let dockSide = $derived(state.ui.broadcast.dock);
	let docked = $derived(dockSide !== 'off' && cardKind !== null);
</script>

<!-- Shared by the dock and the legacy floating slot so the two layouts can't
     drift apart. -->
{#snippet resultsCard()}
	{#if cardKind === 'stateRaces'}
		<StateRacesCard
			streamState={state}
			{interactive}
			onclose={() => (streamStore.state.ui.selectedRegionAttr = null)}
		/>
	{:else if cardKind === 'region'}
		<RegionDetailCard
			{interactive}
			onclose={() => (streamStore.state.ui.selectedRegionAttr = null)}
		/>
	{:else if cardKind === 'statewide'}
		<StatewideResultsCard {interactive} {docked} />
	{/if}
{/snippet}

<div class="stage" class:readonly={!interactive} class:rail-left={dockSide === 'left'}>
	<div class="stage-main">
		{#if state.profile && state.ui.broadcast.insightsStrip}
			<!-- Above the map on both surfaces rather than inside the broadcast
			     frame, so turning the frame off to build chrome in OBS doesn't take
			     the market and the polls with it, and so the operator sees the same
			     band the audience does without reading it off the PiP. -->
			<InsightsStrip compact={interactive} />
		{/if}
		<div class="map-area">
			{#if interactive && hasMap}
				<!-- Color-tab strip floats over the top-left of the map. It's the same
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
							title={t.hint}
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
					mirror={interactive ? 'publish' : 'follow'}
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
				<!-- Rendered on the mirror too. A shaded map with no key is unreadable
			     to the audience as much as to the host, and the swing on air needs
			     to say what it's a swing from. -->
				<MapLegend tab={state.ui.activeMapTab} {interactive} />
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
					<p>
						Pick a race template to start — <kbd>⌘</kbd><kbd>K</kbd> or the Templates button above.
					</p>
				</div>
			{/if}

			<!-- Legacy floating card. Only when the host has turned the dock off:
		     `dock: 'off'` keeps the original corner-overlay behaviour, including
		     the corner-cycle button and the offset that clears the region list. -->
			{#if !docked && cardKind !== null}
				<div
					class="detail-slot corner-{state.ui.detailCardCorner}"
					class:regions-shifted={state.ui.regionListOpen && state.regions.length > 0}
				>
					{@render resultsCard()}
				</div>
			{/if}

			<!-- Left-edge regions navigator. Only on /control (interactive=true) so
		     the OBS capture stays clean. The component itself no-ops when
		     `state.regions` is empty (browse-us shell pre-state-click, or
		     no-map races), so we don't need an extra guard here. -->
			{#if interactive && hasMap}
				<RegionListPanel />
			{/if}
		</div>
	</div>

	{#if docked}
		<aside class="results-rail" aria-label="Results">
			{@render resultsCard()}
		</aside>
	{/if}

	{#if showPip && interactive && state.ui.pipVisible && state.profile}
		<OverlayPip />
	{/if}

	<!-- Last child and absolutely positioned over the whole stage, because a call
	     is the one graphic that outranks everything under it. On /control the same
	     component renders small and at the edge, so the operator can see what
	     they've pushed without losing the map they pushed it about. -->
	<CallCard compact={interactive} />
</div>

<style>
	.stage {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		background: var(--color-base-300);
		overflow: hidden;
		display: flex;
	}
	/* Holds the odds strip above the map. A wrapper rather than making the strip
	   a child of `.map-area`, because everything else in there — the tab pills,
	   the legend, the floating card — is positioned against that box, and a band
	   inside it would have the tabs land on top of the band. */
	.stage-main {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.map-area {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	/* Results rail. A sibling column rather than an overlay, so the map keeps
	   its own box: nothing covers the counties, and MapView's click-to-zoom
	   frames a region inside the space the map actually owns.
	   Named `results-rail` rather than `dock` because daisyUI 5 ships a `.dock`
	   component (a fixed, full-width bottom bar) whose utility-layer rules win
	   over this scoped block and drop the rail below the map. */
	.results-rail {
		flex: 0 0 22rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		background: var(--color-base-100);
		border-left: 1px solid var(--color-secondary);
	}
	.stage.rail-left {
		flex-direction: row-reverse;
	}
	.stage.rail-left .results-rail {
		border-left: none;
		border-right: 1px solid var(--color-secondary);
	}
	/* The cards were built as floating glass panels — rounded, shadowed and
	   width-capped so they'd read as separate objects above the map. In the
	   rail they ARE the panel, so flatten that chrome and let them fill the
	   column. Reaching in with :global beats forking three components that are
	   otherwise identical in both layouts. */
	.results-rail :global(.statewide-card),
	.results-rail :global(.region-card),
	.results-rail :global(.state-card) {
		width: 100%;
		min-width: 0;
		max-width: none;
		border: none;
		border-radius: 0;
		box-shadow: none;
		background: transparent;
		backdrop-filter: none;
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
		/* No room for a side rail on a phone, so the stage stacks and the dock
		   becomes the same bottom sheet the floating card already used. Keeping
		   it at half height matters beyond looks: MapView's PHONE_SHEET_FRACTION
		   assumes the bottom half of the stage is spoken for when it centres a
		   tapped region. */
		.stage,
		.stage.rail-left {
			flex-direction: column;
		}
		.results-rail {
			flex: 0 0 auto;
			max-height: 50%;
			border-left: none;
			border-right: none;
			border-top: 1px solid var(--color-secondary);
		}
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
