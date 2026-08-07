<script lang="ts">
	import { streamStore } from '$lib/stream-store.svelte';

	/**
	 * RegionListPanel — left-edge navigator that lists every region
	 * (county / district / state) in the loaded race. Clicking a row
	 * sets `ui.selectedRegionAttr`, which the rest of the stage already
	 * reacts to: the map zooms/pans into that region (via MapView's
	 * panzoom integration) and the detail card pops open.
	 *
	 * Why this is its own component (rather than reusing RegionsTable
	 * from the FormsDrawer):
	 *   1. The drawer table is dense — multi-column with sort/page UI
	 *      that's great for editing but noisy for one-click navigation.
	 *   2. The drawer is hidden by default (the host called it "useless"
	 *      for live coverage); they wanted the regions list always
	 *      reachable on the stage.
	 *   3. This panel runs read-only and only mutates `selectedRegionAttr`,
	 *      keeping the stage's "no accidental edits during a broadcast"
	 *      contract intact.
	 *
	 * Layout: floats on the left edge of the stage, full-height below
	 * the color-tab strip. Collapses to a slim tab handle the host can
	 * re-open with one click. All mutations go through `streamStore` so
	 * /overlay (which subscribes to the same store) reflects selections
	 * the same way it would if the host clicked the map.
	 */

	const state = $derived(streamStore.state);

	// Geography label drives the heading. "Counties" / "Districts" /
	// "States" — taken from the active profile, falls back to "Regions"
	// for the shell-load window before any race is selected.
	const label = $derived(state.profile?.geography?.regionLabel ?? 'Regions');

	let query = $state('');

	// Filtered + sorted view. Sort by `name` ascending so the host can
	// scan alphabetically (county-name lookups are the common case
	// during a broadcast — "where's Travis?"). Search is a substring
	// match on lowercased name; civicAPI region names already arrive
	// without trailing " County" suffixes so a query of "harris" or
	// "fort bend" hits the right row without needing fuzzy.
	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const rows = q ? state.regions.filter((r) => r.name.toLowerCase().includes(q)) : state.regions;
		return [...rows].sort((a, b) => a.name.localeCompare(b.name));
	});

	// Leader color lookup so each row gets a small status dot. Uses the
	// candidate party color rather than a generic "leader" tint so the
	// list mirrors the map paint — host can scan for "all the red
	// counties" at a glance.
	function leaderColor(leaderId: string | null): string | null {
		if (!leaderId) return null;
		const c = state.candidates.find((cand) => cand.id === leaderId);
		return c?.partyColor ?? null;
	}

	function onPick(regionAttr: string) {
		// Toggle: re-clicking the selected region dismisses, matching the
		// map's click-to-deselect ergonomics.
		const next = state.ui.selectedRegionAttr === regionAttr ? null : regionAttr;
		streamStore.state.ui.selectedRegionAttr = next;

		// On a phone this panel is a bottom sheet occupying the same band as the
		// region detail sheet (see the max-width:640px block below), so leaving
		// it open would bury the very detail card the pick just opened.
		// Collapse it so the result is visible; the handle re-opens it for the
		// next lookup. Desktop keeps the panel open because there it sits
		// beside the map, not over it.
		if (next && typeof window !== 'undefined') {
			if (window.matchMedia('(max-width: 640px)').matches) {
				streamStore.state.ui.regionListOpen = false;
			}
		}
	}

	function toggleOpen() {
		streamStore.state.ui.regionListOpen = !state.ui.regionListOpen;
	}

	// `regionListOpen` persists and defaults to true, which is right on a
	// desktop where the panel is a 14rem column beside the map. On a phone the
	// panel is a bottom sheet, so defaulting it open means the host lands on
	// /control with the lower half of the map covered by a region list they
	// never asked for — and on the browse-us home map that list is just the 50
	// states they can already see. Start collapsed on narrow viewports (and
	// collapse again if the window is resized down) so the map is the first
	// thing they touch; the handle re-opens it for a by-name lookup.
	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(max-width: 640px)');
		const collapseIfNarrow = () => {
			if (mq.matches) streamStore.state.ui.regionListOpen = false;
		};
		collapseIfNarrow();
		mq.addEventListener('change', collapseIfNarrow);
		return () => mq.removeEventListener('change', collapseIfNarrow);
	});
</script>

{#if state.regions.length > 0}
	{#if state.ui.regionListOpen}
		<aside class="panel" aria-label="{label} list">
			<header class="head">
				<div class="title">
					<h3>{label}</h3>
					<span class="count">
						{filtered.length}{#if filtered.length !== state.regions.length}
							/{state.regions.length}{/if}
					</span>
				</div>
				<button
					type="button"
					class="collapse"
					onclick={toggleOpen}
					title="Collapse list"
					aria-label="Collapse list"
				>
					‹
				</button>
			</header>
			<input class="search" type="search" placeholder="Filter…" bind:value={query} />
			<ul class="rows">
				{#each filtered as r (r.regionAttr)}
					{@const isSelected = state.ui.selectedRegionAttr === r.regionAttr}
					{@const color = leaderColor(r.leaderId)}
					<li>
						<button
							type="button"
							class="row"
							class:selected={isSelected}
							onclick={() => onPick(r.regionAttr)}
							title={r.name}
						>
							<span
								class="dot"
								style:background={color ?? 'transparent'}
								style:border={color
									? '0'
									: '1px solid rgb(from var(--color-base-content) r g b / 0.25)'}
							></span>
							<span class="name">{r.name}</span>
							{#if r.reportedPct > 0}
								<span class="pct">{Math.round(r.reportedPct)}%</span>
							{/if}
						</button>
					</li>
				{/each}
				{#if filtered.length === 0}
					<li class="empty">No matches</li>
				{/if}
			</ul>
		</aside>
	{:else}
		<!-- Collapsed handle: thin tab the host can re-click to expand.
		     Vertically aligned with the panel's old top edge so the
		     visual jump on collapse/expand is minimal. -->
		<button
			type="button"
			class="handle"
			onclick={toggleOpen}
			title="Show {label} list"
			aria-label="Show {label} list"
		>
			<span class="handle-label">{label}</span>
			<span class="handle-arrow">›</span>
		</button>
	{/if}
{/if}

<style>
	.panel {
		position: absolute;
		top: 3.25rem;
		left: 0.75rem;
		bottom: 0.75rem;
		width: 14rem;
		z-index: 4;
		display: flex;
		flex-direction: column;
		background: rgb(from var(--color-base-100) r g b / 0.94);
		backdrop-filter: blur(8px);
		border: 1px solid var(--color-secondary);
		border-radius: 0.5rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
		color: var(--color-base-content);
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.625rem 0.4rem;
		border-bottom: 1px solid rgb(from var(--color-secondary) r g b / 0.4);
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
	}
	.title h3 {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.count {
		font-size: 0.7rem;
		font-weight: 500;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.collapse {
		background: transparent;
		border: 1px solid transparent;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		font-size: 1rem;
		line-height: 1;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
	}
	.collapse:hover {
		color: var(--color-base-content);
		background: rgb(from var(--color-secondary) r g b / 0.5);
	}
	.search {
		flex-shrink: 0;
		margin: 0.4rem 0.5rem 0.3rem;
		padding: 0.3rem 0.5rem;
		font-size: 0.75rem;
		background: rgb(from var(--color-base-200) r g b / 0.85);
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
		border-radius: 0.3rem;
		color: var(--color-base-content);
	}
	.search:focus {
		outline: none;
		border-color: var(--color-primary);
	}
	.rows {
		list-style: none;
		padding: 0 0.25rem 0.5rem;
		margin: 0;
		overflow-y: auto;
		flex: 1 1 auto;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.3rem 0.45rem;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 0.25rem;
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}
	.row:hover {
		background: rgb(from var(--color-primary) r g b / 0.12);
		border-color: rgb(from var(--color-primary) r g b / 0.3);
	}
	.row.selected {
		background: rgb(from var(--color-primary) r g b / 0.25);
		border-color: var(--color-primary);
	}
	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 999px;
		flex-shrink: 0;
	}
	.name {
		flex: 1;
		font-size: 0.78rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pct {
		font-size: 0.65rem;
		font-variant-numeric: tabular-nums;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		flex-shrink: 0;
	}
	.empty {
		padding: 1rem 0.5rem;
		text-align: center;
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.55);
		font-style: italic;
		list-style: none;
	}
	/* Collapsed handle: matches the panel's left-edge alignment and the
	   tabs strip's vertical position so re-opening is muscle-memory. */
	.handle {
		position: absolute;
		top: 3.25rem;
		left: 0.75rem;
		z-index: 4;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.55rem;
		background: rgb(from var(--color-base-100) r g b / 0.9);
		backdrop-filter: blur(6px);
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.6);
		border-radius: 0.3rem;
		color: rgb(from var(--color-base-content) r g b / 0.85);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
	}
	.handle:hover {
		background: rgb(from var(--color-base-100) r g b / 1);
		color: var(--color-base-content);
		border-color: var(--color-primary);
	}
	.handle-arrow {
		font-size: 0.85rem;
		line-height: 1;
	}
	/* Phone layout. A 14rem column beside the map doesn't fit next to anything
	   at 390px, so the open panel becomes a bottom sheet instead: it takes the
	   lower part of the stage and leaves the map visible — and, critically,
	   still tappable — above it. An earlier revision stretched this to all four
	   edges, which made the panel a full-stage cover and meant the map could
	   not be touched at all while it was open. Rows get taller for thumbs. */
	@media (max-width: 640px) {
		.panel {
			top: auto;
			left: 0;
			right: 0;
			bottom: 0;
			width: auto;
			max-height: 60%;
			border-inline: none;
			border-bottom: none;
			border-radius: 0.75rem 0.75rem 0 0;
			/* Above the detail sheet (z-index 4) so the list is unobstructed
			   while it's open. */
			z-index: 6;
		}
		.row {
			padding-block: 0.5rem;
			min-height: 2.5rem;
		}
		.search {
			min-height: 2.25rem;
		}
		.collapse {
			min-width: 2.25rem;
			min-height: 2.25rem;
		}
		.handle {
			/* Stays in the upper half, just under the tab strip. Anchoring it
			   to the bottom would put it on top of the detail sheet. */
			top: 3rem;
			left: 0.5rem;
			min-height: 2.25rem;
			padding-inline: 0.7rem;
		}
	}
</style>
