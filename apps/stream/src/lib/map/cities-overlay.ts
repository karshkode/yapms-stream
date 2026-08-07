/**
 * Draws a city-marker layer on top of a yapms SVG basemap. Each marker is
 * anchored to the bounding-box center of its parent county path, which
 * means we don't need to know the SVG's geographic projection — we just
 * piggyback on the coordinates the SVG was authored with.
 *
 * Two public entry points:
 *   applyCityOverlay(svg, scale) — (re)build the overlay layer.
 *   updateOverlayScale(svg, scale) — cheaper path: just resize glyphs when
 *       the user zooms. Call this on every panzoom 'zoom' event so labels
 *       stay readable.
 */

import { US_CITIES, type UsCity } from '../data/us-cities';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OVERLAY_ID = 'yapms-city-overlay';

/**
 * Pick which tier threshold to render at a given panzoom scale.
 *
 * We factor in the SVG's region-density because state-filtered maps are
 * pre-zoomed (their viewBox is recomputed to the surviving counties' bbox)
 * and therefore sit at scale=1 even though they're effectively "zoomed in"
 * compared to the national view. A Texas-only SVG has ~254 counties while
 * the national SVG has 3000+; using path count as a proxy lets us show
 * major (tier-2) cities on a statewide map from the start.
 */
function tierForContext(scale: number, regionCount: number): 1 | 2 | 3 {
	// Heuristic thresholds, tuned against the shipped SVGs:
	//   > 500 regions  → national view (tier 1 default)
	//   50..500        → statewide (tier 2 default)
	//   < 50           → district / small state (tier 3 default)
	let base: 1 | 2 | 3;
	if (regionCount > 500) base = 1;
	else if (regionCount > 50) base = 2;
	else base = 3;

	// Zooming in bumps the tier up so deep zoom reveals more cities. Zooming
	// back out never drops below the context's base tier — once you've
	// filtered to Texas, seeing Fort Worth doesn't hurt even at scale=1.
	let zoomBump: 0 | 1 | 2 = 0;
	if (scale >= 5) zoomBump = 2;
	else if (scale >= 1.6) zoomBump = 1;

	const next = Math.min(3, base + zoomBump) as 1 | 2 | 3;
	return next;
}

/**
 * How many SVG user-space units equal one screen CSS pixel, right now.
 *
 * This is the correct way to size overlay glyphs because:
 *   1. Each SVG's viewBox maps its internal coords onto the rendered CSS box,
 *      and that ratio varies wildly between maps. The national USA SVG has
 *      viewBox ≈ 1000 wide, so 1 unit ≈ 1 screen px on a 1000px-wide panel.
 *      A state-filtered SVG (e.g. Rhode Island) has its viewBox recomputed
 *      down to maybe 50 units wide, so 1 unit = 20 screen px — meaning a
 *      "font-size=11" looks 20x too big.
 *   2. getBoundingClientRect() already factors in panzoom's CSS scale
 *      transform, so we get the right answer at any zoom level without
 *      having to ask panzoom for its scale.
 *
 * We use the LIMITING dimension (max of width-ratio and height-ratio)
 * because `preserveAspectRatio=meet` (the SVG default) aspect-fits the
 * content to the smaller dimension, leaving letterbox space on the other
 * axis. Using just width would underestimate the ratio on tall-narrow
 * containers and produce labels that render smaller than intended.
 */
function svgUnitsPerPixel(svg: SVGElement): number {
	const svgEl = svg as SVGSVGElement;
	const vb = svgEl.viewBox?.baseVal;
	if (!vb || vb.width <= 0 || vb.height <= 0) return 1;
	const rect = svg.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return 1;
	// max() picks the limiting ratio, matching how preserveAspectRatio=meet
	// fits content to the smaller of the two dimensions.
	return Math.max(vb.width / rect.width, vb.height / rect.height);
}

/** Compute SVG-space sizes that hit the target screen dimensions. */
function glyphSizes(svg: SVGElement) {
	const u = svgUnitsPerPixel(svg);
	// Target screen dimensions — tuned for readability on a ~1200px-wide
	// stage panel. Labels use dominant-baseline="middle" (set in
	// renderMarker) so `labelOffsetY` is zero: we want the text vertically
	// centered on the same row as the dot, not below it.
	return {
		dotRadius: 5 * u,
		dotStroke: 1.5 * u,
		fontSize: 20 * u,
		labelStroke: 3.5 * u,
		labelOffsetX: 8 * u,
		labelOffsetY: 0
	};
}

function cssEscape(value: string): string {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
		return CSS.escape(value);
	}
	return value.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}

function centroidOf(path: SVGGraphicsElement): { cx: number; cy: number } | null {
	try {
		const bbox = path.getBBox();
		if (!isFinite(bbox.x) || !isFinite(bbox.y) || bbox.width === 0 || bbox.height === 0) {
			return null;
		}
		return { cx: bbox.x + bbox.width / 2, cy: bbox.y + bbox.height / 2 };
	} catch {
		return null;
	}
}

/**
 * Build (or rebuild) the city overlay group. Safe to call repeatedly — any
 * previous overlay is removed first. Call this once after the SVG loads and
 * whenever the tier threshold changes (e.g. zoom crosses the tier boundary).
 */
export function applyCityOverlay(svg: SVGElement, scale: number): void {
	svg.querySelector(`#${OVERLAY_ID}`)?.remove();

	// Only counts *paths* with a region attr, not the overlay group we may
	// just have removed. Determines the default tier: dense national map
	// starts at tier 1, sparse state-filtered SVG starts at tier 2 or 3.
	const regionCount = svg.querySelectorAll('[region]').length;
	const tier = tierForContext(scale, regionCount);
	const sizes = glyphSizes(svg);

	// IMPORTANT: append the overlay as a sibling of the region paths, not
	// as a child of `<svg>` directly. The yapms maps wrap all regions in
	// `<g map-type="regions" transform="translate(0 -207.65)">` (or some
	// similar translate), and each path's getBBox() returns coordinates in
	// that group's local pre-transform space. Putting the overlay inside
	// the same group makes our marker coords line up visually without
	// having to multiply by the CTM ourselves.
	const host = (svg.querySelector('[map-type="regions"]') as SVGGElement | null) ?? svg;

	const overlay = document.createElementNS(SVG_NS, 'g');
	overlay.id = OVERLAY_ID;
	overlay.dataset.tier = String(tier);
	// Markers are decorative — they shouldn't steal clicks from counties
	// underneath. The underlying path click handler keeps working.
	overlay.setAttribute('pointer-events', 'none');
	// Render above any region paths. Svelte/panzoom both leave children
	// ordering alone, so appending = on top.
	host.appendChild(overlay);

	let placed = 0;
	for (const city of US_CITIES) {
		if (city.tier > tier) continue;
		const path = svg.querySelector<SVGGraphicsElement>(`[region="${cssEscape(city.regionAttr)}"]`);
		if (!path) continue; // county not present (state-filtered SVG)

		const center = centroidOf(path);
		if (!center) continue;

		renderMarker(overlay, city, center.cx, center.cy, sizes);
		placed++;
	}

	if (placed === 0) {
		// Nothing to show — prune the empty group so it doesn't clutter the
		// DOM tree during element inspection.
		overlay.remove();
	}
}

/**
 * Fast path: the overlay already exists, the user just zoomed. Rescale every
 * glyph so labels keep a consistent screen size. If the tier threshold was
 * crossed (e.g. scale went from 1.4 to 2.1), fall back to applyCityOverlay so
 * new tiers appear / hidden tiers disappear.
 */
export function updateOverlayScale(svg: SVGElement, scale: number): void {
	const overlay = svg.querySelector<SVGGElement>(`#${OVERLAY_ID}`);
	if (!overlay) {
		applyCityOverlay(svg, scale);
		return;
	}
	const regionCount = svg.querySelectorAll('[region]').length;
	const prevTier = Number(overlay.dataset.tier);
	const nextTier = tierForContext(scale, regionCount);
	if (prevTier !== nextTier) {
		applyCityOverlay(svg, scale);
		return;
	}
	const sizes = glyphSizes(svg);
	for (const dot of Array.from(overlay.querySelectorAll<SVGCircleElement>('circle'))) {
		dot.setAttribute('r', String(sizes.dotRadius));
		dot.setAttribute('stroke-width', String(sizes.dotStroke));
	}
	for (const text of Array.from(overlay.querySelectorAll<SVGTextElement>('text'))) {
		text.setAttribute('font-size', String(sizes.fontSize));
		text.setAttribute('stroke-width', String(sizes.labelStroke));
		// Nudge label back to its anchor offset — the text's x/y is stored
		// as data-anchor-x/y so we can offset consistently at any scale.
		const ax = Number(text.dataset.anchorX);
		const ay = Number(text.dataset.anchorY);
		if (Number.isFinite(ax) && Number.isFinite(ay)) {
			text.setAttribute('x', String(ax + sizes.labelOffsetX));
			text.setAttribute('y', String(ay + sizes.labelOffsetY));
		}
	}
}

/** Remove the overlay entirely (e.g. if the user disables the layer). */
export function removeCityOverlay(svg: SVGElement): void {
	svg.querySelector(`#${OVERLAY_ID}`)?.remove();
}

function renderMarker(
	overlay: SVGGElement,
	city: UsCity,
	cx: number,
	cy: number,
	sizes: ReturnType<typeof glyphSizes>
): void {
	const dot = document.createElementNS(SVG_NS, 'circle');
	dot.setAttribute('cx', String(cx));
	dot.setAttribute('cy', String(cy));
	dot.setAttribute('r', String(sizes.dotRadius));
	dot.setAttribute('fill', '#ffffff');
	dot.setAttribute('stroke', '#111827');
	dot.setAttribute('stroke-width', String(sizes.dotStroke));
	overlay.appendChild(dot);

	const text = document.createElementNS(SVG_NS, 'text');
	text.textContent = city.name;
	// Store raw anchor so updateOverlayScale can reposition without re-
	// consulting the underlying path bbox.
	text.dataset.anchorX = String(cx);
	text.dataset.anchorY = String(cy);
	text.setAttribute('x', String(cx + sizes.labelOffsetX));
	text.setAttribute('y', String(cy + sizes.labelOffsetY));
	text.setAttribute('font-size', String(sizes.fontSize));
	text.setAttribute(
		'font-family',
		'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
	);
	text.setAttribute('font-weight', '600');
	text.setAttribute('fill', '#0f172a');
	// Anchor the label to the left of the text (so it extends right of the
	// dot) and vertically center it on the dot's row — much easier to read
	// than SVG's default baseline-aligned, start-left positioning.
	text.setAttribute('text-anchor', 'start');
	text.setAttribute('dominant-baseline', 'middle');
	// White halo behind the label so it's readable against any county color.
	text.setAttribute('paint-order', 'stroke');
	text.setAttribute('stroke', '#ffffff');
	text.setAttribute('stroke-width', String(sizes.labelStroke));
	text.setAttribute('stroke-linejoin', 'round');
	overlay.appendChild(text);
}
