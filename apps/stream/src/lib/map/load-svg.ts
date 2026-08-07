import DOMPurify from 'dompurify';
import type { RaceProfile } from '../race-profile';

/**
 * Generic SVG loader for the overlay.
 *
 * Loads any yapms SVG by path, optionally filters paths by attribute (e.g.
 * `action-groups=39` to keep only Ohio counties out of the national map, or
 * a pipe-separated region list to isolate a sub-state district), and
 * recomputes the viewBox from the remaining bbox so the filtered SVG still
 * fills its container.
 *
 * Uses Vite's `import.meta.glob` with the `@yapms` alias configured in
 * apps/stream/vite.config.ts. Lazy imports keep the bundle small — only the
 * SVGs actually loaded at runtime are fetched.
 */

// Match apps/yapms/src/lib/utils/importMap.ts so the overlay accepts the same
// custom attributes yapms places on region paths (region, short-name,
// long-name, action-groups, map-type, etc.).
export const DOMPurifyConfig = {
	ADD_ATTR: [
		'region',
		'short-name',
		'long-name',
		'value',
		'locked',
		'permalocked',
		'disabled',
		'for-region',
		'candidates',
		'tossup-candidate',
		'default-mode',
		'auto-border-stroke-width',
		'auto-border-stroke-width-limit',
		'map-type',
		'title',
		'original-source',
		'action-groups'
	]
};

// Build the glob once. Keys look like
// `/@yapms/assets/maps/usa/usa-counties-2023-blank.svg` — absolute paths
// relative to the alias, since Vite normalizes glob entries that way.
const svgModules = import.meta.glob<string>('@yapms/assets/maps/**/*.svg', {
	import: 'default',
	query: '?raw'
});

function matchKey(svgPath: string): string | null {
	// Accept either form the caller provides:
	//   "usa/usa-counties-2023-blank.svg"
	//   "@yapms/assets/maps/usa/usa-counties-2023-blank.svg"
	//   "/src/lib/assets/maps/usa/usa-counties-2023-blank.svg" (Vite-normalized)
	const normalized = svgPath.replace(/^@yapms\/assets\/maps\//, '').replace(/^\/+/, '');
	for (const key of Object.keys(svgModules)) {
		if (key.endsWith(`/${normalized}`) || key.endsWith(normalized)) return key;
	}
	return null;
}

/**
 * List all known SVG keys under `assets/maps/`. Surface for the Custom SVG
 * (advanced) fallback in the race picker.
 */
export function listAvailableSvgs(): string[] {
	return Object.keys(svgModules)
		.map((k) => k.replace(/^.*\/assets\/maps\//, ''))
		.sort();
}

export async function loadProfileSvg(profile: RaceProfile | null): Promise<string | null> {
	if (!profile?.geography) return null;
	const key = matchKey(profile.geography.svgPath);
	if (!key) {
		throw new Error(`SVG not found for path: ${profile.geography.svgPath}`);
	}
	const loader = svgModules[key];
	let raw = await loader();
	raw = DOMPurify.sanitize(raw, DOMPurifyConfig);

	const { filterAttr, filterValue } = profile.geography;
	if (!filterAttr || !filterValue) return raw;

	return filterSvg(raw, filterAttr, filterValue);
}

/**
 * Filter an SVG's region paths down to a target set, then recompute viewBox.
 *
 * `filterValue` is pipe-separated to support both single-state and
 * multi-region district selectors:
 *   filterAttr: 'action-groups'  filterValue: '39'
 *     → keep only Ohio (FIPS 39) counties.
 *   filterAttr: 'region'         filterValue: 'Dallas48|Tarrant48|Collin48'
 *     → keep only those three Texas counties (TX State Senate district).
 *
 * Browser-only: viewBox recomputation needs a live DOM for getBBox(). During
 * SSR we return the unfiltered SVG — the /overlay and /control routes mount
 * client-side (the layout below sets `export const ssr = false` for this app)
 * so this only matters if someone opts back into SSR.
 */
export function filterSvg(svgMarkup: string, filterAttr: string, filterValue: string): string {
	if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
		return svgMarkup;
	}
	const dom = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
	const svg = dom.documentElement as unknown as SVGSVGElement;
	if (svg.nodeName !== 'svg') return svgMarkup;

	const allowed = new Set(filterValue.split('|').map((s) => s.trim()).filter(Boolean));
	const regions = svg.querySelectorAll('[region]');
	for (const node of Array.from(regions)) {
		const attr = node.getAttribute(filterAttr);
		if (attr === null || !allowed.has(attr)) node.remove();
	}

	// Clean up any <text> or label groups whose for-region is now orphaned.
	const texts = svg.querySelectorAll('[for-region]');
	const survivingRegionIds = new Set(
		Array.from(svg.querySelectorAll('[region]')).map((n) => n.getAttribute('region'))
	);
	for (const t of Array.from(texts)) {
		const target = t.getAttribute('for-region');
		if (target && !survivingRegionIds.has(target)) t.remove();
	}

	// Recompute viewBox from the surviving bbox. getBBox() needs the SVG
	// attached to the document to return non-zero dimensions.
	const hostHidden = document.createElement('div');
	hostHidden.style.position = 'absolute';
	hostHidden.style.visibility = 'hidden';
	hostHidden.style.pointerEvents = 'none';
	hostHidden.style.width = '0';
	hostHidden.style.height = '0';
	hostHidden.style.overflow = 'hidden';
	hostHidden.appendChild(svg);
	document.body.appendChild(hostHidden);
	try {
		const bbox = (svg as unknown as SVGGraphicsElement).getBBox();
		if (bbox.width > 0 && bbox.height > 0) {
			const pad = Math.max(bbox.width, bbox.height) * 0.02;
			svg.setAttribute(
				'viewBox',
				`${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`
			);
			svg.removeAttribute('width');
			svg.removeAttribute('height');
		}
	} finally {
		hostHidden.remove();
	}

	return new XMLSerializer().serializeToString(svg);
}
