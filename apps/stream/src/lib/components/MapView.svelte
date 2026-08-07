<script lang="ts">
	import panzoom, { type PanZoom } from 'panzoom';
	import { applyStreamColors } from '../map/apply-colors';
	import { loadProfileSvg } from '../map/load-svg';
	import { applyCityOverlay, updateOverlayScale, removeCityOverlay } from '../map/cities-overlay';
	import type { MapTab } from '../race-profile';
	import type { StreamState } from '../stream-state';
	import { streamStore } from '../stream-store.svelte';

	interface Props {
		tab: MapTab;
		/** Optional — when supplied, clicking a region calls back with its attr. */
		onselect?: (regionAttr: string | null) => void;
		/**
		 * Optional — called once per SVG load with the list of region rows
		 * extracted from the SVG. `/control` uses this to auto-populate
		 * `state.regions` for templates that don't ship a seed (e.g. the
		 * Presidential maps where the 50 states come straight out of the SVG).
		 */
		onregionsextracted?: (rows: StreamState['regions']) => void;
		/**
		 * When `true`, the map fills the parent's height (stage mode). When
		 * unset/false, it keeps the 16:10 aspect-ratio that the overlay RacePage
		 * and Geography tab rely on. Defaults to false for backwards compat.
		 */
		fill?: boolean;
		/**
		 * When true, hide the zoom/reset controls and skip attaching a click
		 * handler. Used by the /overlay mirror mode so the OBS capture stays
		 * input-inert while still re-painting on every BroadcastChannel update.
		 */
		readonly?: boolean;
	}

	let { tab, onselect, onregionsextracted, fill = false, readonly = false }: Props = $props();

	// Read/write the app-level store directly — same rationale as StagePanel /
	// FormsDrawer / OverlayPip: Svelte 5's ownership warning otherwise flags
	// every selectedRegionAttr/regions mutation that happens inside this file.
	const streamState = $derived(streamStore.state);

	let container = $state(null as HTMLDivElement | null);
	let svgMarkup = $state(null as string | null);
	let lastProfileId: string | null = null;
	let pz: PanZoom | null = null;
	// Monotonic counter incremented each time `pz` is (re)created after an
	// SVG swap. The click-to-zoom effect reads this so it re-fires whenever
	// panzoom reattaches — otherwise a `selectedRegionAttr` that was set
	// while pz was still null (e.g. immediately after applyTemplate seeds
	// a preselect county) would be silently ignored and the host would
	// land on an unfocused statewide map.
	let pzReady = $state(0);
	let clickHandler: ((event: Event) => void) | null = null;
	// City-marker overlay (decorative basemap of major US cities anchored to
	// their parent county). Toggle-able via the "Cities" button. Persists
	// through SVG swaps because we re-apply it on every SVG load.
	let showCities = $state(true);
	// Throttle panzoom 'zoom' events with rAF so the overlay resize doesn't
	// run hundreds of times per second during a smooth wheel-zoom.
	let overlayScaleRaf: number | null = null;
	// Track which SVG element the click handler is currently attached to so
	// we can reliably detach it when the profile swaps. Prior revisions
	// relied on `clickHandler` being null on first load but never cleared it
	// when the SVG was re-injected via @html, leaving the handler bound to a
	// detached node and the new node without any listener. That was the
	// "have to reload the page to click into districts" bug.
	let handlerSvg: SVGElement | null = null;
	// True while the phone layout is active. The stage parks the region detail
	// card as a sheet across the bottom half at this width (see StagePanel's
	// max-width:640px block), so the bottom half of the map is spoken for and
	// the click-to-zoom below has to aim above it.
	let phoneLayout = $state(false);
	/** Fraction of the container the phone detail sheet can cover, mirroring
	 *  `.detail-slot { max-height: 50% }` in StagePanel. */
	const PHONE_SHEET_FRACTION = 0.5;

	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(max-width: 640px)');
		const sync = () => (phoneLayout = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	$effect(() => {
		// Re-load the SVG when the profile changes (not on every color update).
		if (!streamState.profile || streamState.profile.id === lastProfileId) return;
		lastProfileId = streamState.profile.id;
		loadProfileSvg(streamState.profile).then((markup) => {
			// Dispose the previous panzoom instance so it re-attaches to the new SVG.
			if (pz) {
				pz.dispose();
				pz = null;
			}
			// Drop the stale click handler reference. The previous SVG is about
			// to be replaced by @html — without resetting these, the guard below
			// (`!clickHandler`) would skip re-attaching to the new SVG.
			if (handlerSvg && clickHandler) {
				handlerSvg.removeEventListener('click', clickHandler);
			}
			clickHandler = null;
			handlerSvg = null;
			svgMarkup = markup;
		});
	});

	$effect(() => {
		if (!container || !svgMarkup) return;
		const svg = container.querySelector<SVGElement>('svg');
		if (!svg) return;
		// Strip any inherited size so the SVG fills the container.
		svg.style.maxWidth = '100%';
		svg.style.maxHeight = '100%';
		svg.style.display = 'block';
		applyStreamColors(svg, streamState, tab, streamState.ui.selectedRegionAttr);

		// Wire click-to-select on every region path. We attach once per SVG load
		// (guarded by clickHandler being null) and delegate via closest() so the
		// listener works even when the user clicks a child element. Skipped
		// entirely in readonly mode so the /overlay mirror stays inert.
		if (!clickHandler && !readonly) {
			clickHandler = (event: Event) => {
				const target = event.target as Element | null;
				const regionEl = target?.closest('[region]');
				if (!regionEl) return;
				const attr = regionEl.getAttribute('region');
				if (!attr) return;
				event.stopPropagation();
				onselect?.(attr);
			};
			svg.addEventListener('click', clickHandler);
			handlerSvg = svg;
			// Hint to the user that regions are clickable.
			svg.style.cursor = 'pointer';

			// Auto-extract region rows from the SVG so templates without a seed
			// (US President / US Senate / state-leg parameterized) still fill
			// out the regions table. This runs once per SVG load (same guard as
			// the click handler above).
			if (onregionsextracted) {
				const extracted: StreamState['regions'] = [];
				const regionsGroup = svg.querySelector('[map-type="regions"]') ?? svg;
				const nodes = regionsGroup.querySelectorAll('[region]');
				for (const node of Array.from(nodes)) {
					const attr = node.getAttribute('region');
					if (!attr) continue;
					const name =
						node.getAttribute('short-name')?.split(',')[0]?.trim() ||
						node.getAttribute('long-name') ||
						attr;
					extracted.push({
						name,
						regionAttr: attr,
						leaderId: null,
						votes: 0,
						evr: 0,
						reportedPct: 0,
						totalReg: 0,
						candidateVotes: {},
						// SVG-extracted regions (e.g. US presidential states) have no
						// archival baseline at this layer — the US-President RacePage
						// gets its state-level baselines another way. Leave null so
						// apply-colors falls through to NEUTRAL.
						archivalByYear: {}
					});
				}
				if (extracted.length > 0) onregionsextracted(extracted);
			}
		}

		// panzoom gets attached to the svg itself, so a click that lands on a
		// region path reaches the delegated handler above before panzoom's own
		// drag tracking decides the gesture was a pan.
		// `bounds` is off because our programmatic click-to-zoom computes an
		// exact (tx, ty) that lands the target county at the container center.
		// With `bounds: true`, panzoom clips those translations to keep *some*
		// of the SVG visible, which for a highly-zoomed tiny county means
		// "ignore the translation" and the zoom visibly snaps back out.
		// `autocenter` is DISABLED — it applies an initial scale+translate
		// to "fit" the SVG inside the parent, but our SVG already fills its
		// container via CSS `width/height: 100%` and `preserveAspectRatio`.
		// Autocenter layered on top meant the "identity" panzoom state
		// (scale=1, x=y=0) was off by the autocenter values, invalidating
		// the zoom-to-region math. With autocenter off, identity == CSS
		// natural layout, which is exactly what the zoom formula assumes.
		if (!pz) {
			pz = panzoom(svg, {
				maxZoom: 20,
				minZoom: 0.5,
				autocenter: false,
				bounds: false,
				smoothScroll: false,
				// panzoom's built-in touchstart handler calls stopPropagation()
				// and preventDefault() on every touch. preventDefault() on
				// touchstart tells the browser not to synthesize the follow-up
				// click, and region selection above listens for `click` — so
				// with the default behavior a tap does nothing and the map is
				// completely unselectable on any touch device, phone or not.
				//
				// Returning a falsy value opts that suppression out. We only do
				// it for a single finger: `touch-action: none` on .viewport
				// already stops the browser claiming one-finger drags for
				// scrolling, so the pan handler keeps working without needing
				// the default prevented. Two fingers keep the default blocked
				// so pinch-zoom doesn't also zoom the page.
				onTouch: (e: TouchEvent) => e.touches.length > 1
			});
			// Keep the city-overlay glyphs at a constant screen size as the
			// user zooms. Without this, labels balloon to enormous sizes at
			// 10x zoom and shrink to specks zoomed out.
			pz.on('zoom', () => {
				if (!pz) return;
				if (overlayScaleRaf) cancelAnimationFrame(overlayScaleRaf);
				overlayScaleRaf = requestAnimationFrame(() => {
					overlayScaleRaf = null;
					const cur = container?.querySelector<SVGElement>('svg');
					if (!cur || !pz) return;
					updateOverlayScale(cur, pz.getTransform().scale);
				});
			});
			// Signal "panzoom is ready" so the click-to-zoom effect below can
			// re-run against any preselected region that was set while we
			// were still loading the SVG.
			pzReady++;
		}

		// Annotate every region path with a native <title> child so the
		// browser renders "Dallas, Texas"-style tooltips on hover. Zero-JS,
		// accessible, and a huge "where am I?" win when zoomed out. Guarded
		// so we only do this once per SVG load.
		if (!svg.dataset.titlesApplied) {
			for (const el of Array.from(svg.querySelectorAll('[region]'))) {
				if (el.querySelector(':scope > title')) continue;
				const label =
					el.getAttribute('short-name')?.trim() ||
					el.getAttribute('long-name')?.trim() ||
					el.getAttribute('region') ||
					'';
				if (!label) continue;
				const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
				title.textContent = label;
				el.insertBefore(title, el.firstChild);
			}
			svg.dataset.titlesApplied = 'true';
		}

		// Draw (or remove) the city marker layer. Re-applied on every SVG
		// swap because filtered state-level SVGs retain only a subset of
		// counties — a city whose parent isn't present gets silently skipped
		// by applyCityOverlay.
		if (showCities && pz) {
			applyCityOverlay(svg, pz.getTransform().scale);
		} else {
			removeCityOverlay(svg);
		}
	});

	// CNN-style click-to-zoom. When the host (or a keyboard shortcut) sets
	// selectedRegionAttr, zoom the map to frame that region in the container
	// center. Clearing the selection zooms back to the full view.
	//
	// Strategy: two-phase "measure and correct".
	//   Phase A: reset panzoom to identity, wait one rAF for panzoom to
	//            flush the reset to the DOM, then measure the path's
	//            identity-state client rect. Compute targetScale from the
	//            rect's actual dimensions and zoomAbs with pivot at the
	//            path's current (identity) screen center — which keeps
	//            that pixel fixed while scaling.
	//   Phase B: wait ANOTHER rAF for the zoom to flush, then measure the
	//            path's *post-zoom* client rect and translate by the
	//            residual delta to the container center.
	//
	// Why two rAFs?  panzoom batches every `zoomAbs`/`moveTo`/`moveBy` into
	// its own internal rAF before touching `style.transform`. Measuring
	// before that flush returns the pre-transform rect, which is exactly
	// the bug that plagued every previous attempt. By splitting into phases
	// with explicit rAF waits between them, every measurement reflects the
	// current CSS transform.
	$effect(() => {
		const attr = streamState.ui.selectedRegionAttr;
		// Read pzReady so the effect registers a dependency on panzoom's
		// lifecycle — when the SVG finishes loading and `pz` is assigned,
		// `pzReady` ticks and this effect re-runs so a preselected county
		// (set before the SVG was ready) lands in frame. `void` because a bare
		// `pzReady;` reads as a stray expression to eslint.
		void pzReady;
		if (!pz || !container) return;
		const svg = container.querySelector<SVGSVGElement>('svg');
		if (!svg) return;

		if (!attr) {
			pz.moveTo(0, 0);
			pz.zoomAbs(0, 0, 1);
			pz.moveTo(0, 0);
			return;
		}

		let rafPhaseA = 0;
		let rafPhaseB = 0;

		// Queue the reset now so panzoom's rAF fires first.
		pz.zoomAbs(0, 0, 1);
		pz.moveTo(0, 0);

		rafPhaseA = requestAnimationFrame(() => {
			if (!pz || !container) return;
			const path = svg.querySelector<SVGGraphicsElement>(`[region="${CSS.escape(attr)}"]`);
			if (!path) return;

			const identityRect = path.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			if (identityRect.width === 0 || identityRect.height === 0) return;
			if (containerRect.width === 0 || containerRect.height === 0) return;

			// On a phone the detail sheet covers the bottom of the stage, so the
			// map only really owns the band above it. Fitting and centring
			// against the full container height there put the county the host
			// just tapped straight behind the sheet.
			const visibleHeight = phoneLayout
				? containerRect.height * (1 - PHONE_SHEET_FRACTION)
				: containerRect.height;

			// Fit the path to ~55% of the visible area. Clamped to [1, 12] —
			// tiny counties would otherwise blow up past raster fidelity;
			// huge states (CA on the US map) shouldn't de-zoom below
			// identity.
			const padding = 0.55;
			const fitScale = Math.min(
				(containerRect.width * padding) / identityRect.width,
				(visibleHeight * padding) / identityRect.height
			);
			const targetScale = Math.min(12, Math.max(1, fitScale));

			// Zoom with pivot at the path's current (identity) screen center.
			// panzoom keeps that pixel fixed on screen while scaling, so the
			// path center ends up at roughly (identityCx, identityCy) in
			// client coords after the DOM flush.
			const identityCx = identityRect.left + identityRect.width / 2;
			const identityCy = identityRect.top + identityRect.height / 2;
			pz.zoomAbs(identityCx, identityCy, targetScale);

			rafPhaseB = requestAnimationFrame(() => {
				if (!pz || !container) return;
				// Re-measure after the zoom's DOM flush. getBoundingClientRect
				// now returns the post-zoom rect — no more assumptions about
				// where the path landed, just read the truth.
				const postRect = path.getBoundingClientRect();
				const postCx = postRect.left + postRect.width / 2;
				const postCy = postRect.top + postRect.height / 2;
				const containerCx = containerRect.left + containerRect.width / 2;
				const containerCy = containerRect.top + visibleHeight / 2;
				// `moveBy` adds its delta directly to transform.x/y — since
				// panzoom's parent (the viewport div) has no CSS transform,
				// client-pixel delta === scene-pixel delta.
				pz.moveBy(containerCx - postCx, containerCy - postCy, false);
			});
		});

		return () => {
			if (rafPhaseA) cancelAnimationFrame(rafPhaseA);
			if (rafPhaseB) cancelAnimationFrame(rafPhaseB);
		};
	});

	// Tear down the click handler when the component unmounts. `handlerSvg`
	// is the SVG the listener was attached to (may differ from the current
	// container child if an intermediate SVG was replaced without unmount).
	$effect(() => {
		return () => {
			if (handlerSvg && clickHandler) {
				handlerSvg.removeEventListener('click', clickHandler);
			}
			clickHandler = null;
			handlerSvg = null;
			if (overlayScaleRaf) {
				cancelAnimationFrame(overlayScaleRaf);
				overlayScaleRaf = null;
			}
		};
	});

	function toggleCities() {
		// The post-load effect reads `showCities`, so flipping it is enough —
		// Svelte schedules the effect to run on the next microtask and the
		// overlay is drawn/removed there. No need to touch the SVG directly.
		showCities = !showCities;
	}

	function zoomIn() {
		if (!pz || !container) return;
		pz.smoothZoom(container.clientWidth / 2, container.clientHeight / 2, 1.25);
	}
	function zoomOut() {
		if (!pz || !container) return;
		pz.smoothZoom(container.clientWidth / 2, container.clientHeight / 2, 0.8);
	}
	function reset() {
		if (!pz) return;
		pz.moveTo(0, 0);
		pz.zoomAbs(0, 0, 1);
	}
</script>

<div class="map-view" class:fill>
	<div class="viewport" bind:this={container}>
		{#if svgMarkup}
			{@html svgMarkup}
		{:else}
			<div class="empty">No map configured for this profile.</div>
		{/if}
	</div>
	{#if !readonly}
		<div class="controls">
			<button type="button" aria-label="Zoom in" onclick={zoomIn}>+</button>
			<button type="button" aria-label="Reset zoom" onclick={reset}>&#8634;</button>
			<button type="button" aria-label="Zoom out" onclick={zoomOut}>-</button>
			<button
				type="button"
				aria-label={showCities ? 'Hide city markers' : 'Show city markers'}
				aria-pressed={showCities}
				class:active={showCities}
				class="cities-toggle"
				title={showCities ? 'Hide cities' : 'Show cities'}
				onclick={toggleCities}
			>
				Cities
			</button>
		</div>
	{/if}
</div>

<style>
	.map-view {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 10;
		background: var(--color-base-300);
		overflow: hidden;
		border-radius: 0.5rem;
	}
	.map-view.fill {
		/* Stage mode: flex-fill the parent's height, drop the fixed aspect. */
		height: 100%;
		aspect-ratio: auto;
		border-radius: 0;
	}
	.viewport {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		/* panzoom handles drag-to-pan and pinch-to-zoom itself. Without this
		   the browser claims the same gestures first for scrolling, overscroll
		   glow and double-tap zoom, so a one-finger pan on the map either does
		   nothing or bounces the page. Tap still synthesizes a click, so
		   region selection is unaffected. */
		touch-action: none;
	}
	/* Inline-SVG-from-{@html} defaults to 300x150 without explicit sizing; we
	   force it to fill the flex item while preserving aspect so filtered states
	   (e.g. Texas-only) center rather than float to one side. Global needed
	   because the markup is injected raw. */
	.viewport :global(svg) {
		width: 100%;
		height: 100%;
		max-width: 100%;
		max-height: 100%;
		display: block;
	}
	.empty {
		color: rgb(from var(--color-base-content) r g b / 0.5);
		font-size: 0.85rem;
	}
	.controls {
		position: absolute;
		/* Docked bottom-right so they don't fight with the detail-slot card
		   that defaults to the top-right corner. The card has its own
		   corner-cycle so the host can move it elsewhere if needed. */
		right: 0.5rem;
		bottom: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.controls button {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.25rem;
		border: 1px solid var(--color-secondary);
		background: var(--color-base-200);
		color: var(--color-base-content);
		font-size: 0.9rem;
		cursor: pointer;
	}
	.controls button:hover {
		background: var(--color-secondary);
	}
	.controls .cities-toggle {
		width: auto;
		padding: 0 0.5rem;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.controls .cities-toggle.active {
		background: var(--color-primary, var(--color-secondary));
		color: var(--color-primary-content, var(--color-base-content));
		border-color: var(--color-primary, var(--color-secondary));
	}
	@media (max-width: 640px) {
		.controls {
			/* Lifted clear of the detail sheet that occupies the bottom half of
			   the stage on phones, and laid out along the row that starts under
			   the tab strip — as a column these four buttons ran a third of the
			   way down the map. RegionListPanel's collapsed handle takes the
			   left end of the same row. */
			bottom: auto;
			top: 4.25rem;
			right: 0.5rem;
			flex-direction: row;
		}
		.controls button {
			/* 1.75rem (28px) is well under a comfortable touch target, and
			   these are the only way to zoom without a scroll wheel. */
			width: 2.25rem;
			height: 2.25rem;
			font-size: 1rem;
		}
		.controls .cities-toggle {
			width: auto;
			padding: 0 0.6rem;
		}
	}
</style>
