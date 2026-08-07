import type { MapTab, RegionResult } from '../race-profile';
import type { StreamState } from '../stream-state';

/**
 * Paint region fills + "value-text" labels on a mounted SVG from the current
 * StreamState. Intentionally much slimmer than apps/yapms' RegionsStore — we
 * only need to color/label; we don't need editor machinery (locking, tossup,
 * value multiplier). Walks `[map-type="regions"] [region]`, looks up the
 * region in `state.regions` by the SVG's `region` attribute, and sets
 * `path.style.fill`.
 *
 * Live-first: without live data AND without an `archivalYear` set on the
 * slider, regions paint NEUTRAL. When `archivalYear` is set, regions without
 * live data pull their color from `archivalByYear[year]` (falls back to
 * NEUTRAL when the bake script had no row for that region in that year).
 *
 * All four map tabs now produce distinct output:
 *   results   — leader party color at full saturation.
 *   margin    — leader color lerped toward white as the race tightens.
 *   swing     — red/blue by signed live-vs-archival shift (archival required).
 *   remaining — grey out fully-reported regions; highlight pending; PENDING
 *               gray for 0% reported.
 *
 * Also fills `<tspan map-type="value-text">` labels that ship with the yapms
 * SVGs (EV counts / vote subtitles) so the map doesn't display naked "00"s.
 * Labels are per-tab (margin, reported %, swing pts, or vote count).
 */

// NEUTRAL is the default fill when a region has no live leader data AND the
// archival slider is either off or has no row for the region. Picked to read
// as "unreported" without blending into the stage chrome (#0b0b0e area).
const NEUTRAL = '#3a3a44';
// PENDING applies only on the `remaining` tab at 0% reported. A slightly
// warmer gray than NEUTRAL so a host can distinguish "no data at all" (neutral
// base map) from "actively awaiting returns" (pending).
const PENDING = '#4b5563';

export function applyStreamColors(
	svgRoot: SVGElement,
	state: StreamState,
	tab: MapTab,
	selectedAttr: string | null = null
): void {
	const regionsGroup = svgRoot.querySelector('[map-type="regions"]') ?? svgRoot;
	const nodes = regionsGroup.querySelectorAll<SVGElement>('[region]');
	if (nodes.length === 0) return;

	const regionByAttr = new Map(state.regions.map((r) => [r.regionAttr, r]));
	const candidateById = new Map(state.candidates.map((c) => [c.id, c]));
	const archivalYear = state.ui.archivalYear;

	for (const node of Array.from(nodes)) {
		const attr = node.getAttribute('region');
		const result = attr ? regionByAttr.get(attr) : undefined;
		const leader = result?.leaderId ? candidateById.get(result.leaderId) : undefined;
		const archival =
			archivalYear && result?.archivalByYear?.[archivalYear]
				? result.archivalByYear[archivalYear]
				: null;

		const liveColor = leader?.partyColor ?? null;
		// Base color picks live first; when live is absent and the slider is
		// off, NEUTRAL. When the slider is set, use the archival snapshot.
		const baseColor = liveColor ?? archival?.color ?? NEUTRAL;

		let fill = baseColor;
		if (tab === 'margin') {
			fill = fillForMarginTab(baseColor, result, state, archival);
		} else if (tab === 'remaining') {
			fill = fillForRemainingTab(baseColor, result);
		} else if (tab === 'swing') {
			fill = fillForSwingTab(result, state, archival);
		}

		node.style.fill = fill;

		// Outline the selected region. stroke-width is in user-space units so we
		// key off the SVG's viewBox height to keep the outline visible at any zoom.
		const isSelected = selectedAttr && attr === selectedAttr;
		if (isSelected) {
			node.style.stroke = '#f5c518';
			node.style.strokeWidth = '1.25';
			// Bring selected path to front by re-appending it; fixes the case where
			// the neighboring region's edge covers our stroke.
			const parent = node.parentNode;
			if (parent) parent.appendChild(node);
		} else {
			node.style.removeProperty('stroke');
			node.style.removeProperty('stroke-width');
		}
	}

	applyValueTextLabels(svgRoot, state, tab, regionByAttr);
}

// ---------------------------------------------------------------------------
// Per-tab fill logic. Split out for readability; each returns just the hex
// string (or rgb(...)) to apply as `fill` on the path.
// ---------------------------------------------------------------------------

/**
 * Margin tab: more-decisive = full saturation, toss-up = lerped toward white.
 *
 * Intensity source ladder:
 *   1. Live per-region leader share (two-party) if we have it.
 *   2. Live candidates' statewide leader share as a proxy for regions without
 *      per-region breakdowns on the manual side. Works OK for straight-ticket
 *      states; poor for split races — tolerated for now.
 *   3. `archival.margin` from the slider year when live is fully absent.
 *   4. 0 → fully white (no signal).
 */
function fillForMarginTab(
	baseColor: string,
	result: RegionResult | undefined,
	state: StreamState,
	archival: { margin: number } | null
): string {
	if (!result) return baseColor;
	const leader = result.leaderId ? state.candidates.find((c) => c.id === result.leaderId) : null;
	let intensity = 0;

	if (leader && result.votes > 0) {
		// Runner-up inferred as second-highest-voted candidate across the race.
		// Approximates a per-region two-party margin; replaced when civicAPI
		// starts supplying per-region breakdowns.
		const sorted = [...state.candidates].sort((a, b) => b.votes - a.votes);
		const runnerUp = sorted.find((c) => c.id !== leader.id);
		const twoParty = leader.votes + (runnerUp?.votes ?? 0);
		if (twoParty > 0) {
			intensity = (leader.votes - (runnerUp?.votes ?? 0)) / twoParty;
		}
	} else if (archival && archival.margin !== 0) {
		intensity = Math.min(Math.abs(archival.margin) / 100, 1);
	}

	intensity = Math.max(0, Math.min(1, intensity));
	return lerpToWhite(baseColor, 1 - intensity);
}

/**
 * Remaining tab: pure reporting-status view.
 *   0%            -> PENDING gray (awaiting returns)
 *   0% < x < 99.5 -> live leader color (so the host sees who's ahead as
 *                    reporting trickles in)
 *   >= 99.5       -> NEUTRAL (finalized, not interesting)
 *
 * Ignores the archival slider by design — this tab is about where returns
 * are still coming in, not historical context.
 */
function fillForRemainingTab(baseColor: string, result: RegionResult | undefined): string {
	const pct = result?.reportedPct ?? 0;
	if (pct >= 99.5) return NEUTRAL;
	if (pct > 0) return baseColor;
	return PENDING;
}

/**
 * Swing tab: red when the region shifted toward the R nominee vs the archival
 * year, blue when it shifted toward the D nominee, NEUTRAL when we can't
 * compute. Intensity scales linearly up to 20 pts of shift.
 *
 * Only meaningful with BOTH live and archival available. Without archival the
 * tab has nothing to compare to; without live we can't infer direction.
 */
function fillForSwingTab(
	result: RegionResult | undefined,
	state: StreamState,
	archival: { margin: number } | null
): string {
	if (!result || !archival) return NEUTRAL;
	const leader = result.leaderId ? state.candidates.find((c) => c.id === result.leaderId) : null;
	if (!leader || result.votes === 0 || state.candidates.length < 2) return NEUTRAL;

	const sorted = [...state.candidates].sort((a, b) => b.votes - a.votes);
	const runnerUp = sorted.find((c) => c.id !== leader.id);
	const twoParty = leader.votes + (runnerUp?.votes ?? 0);
	if (twoParty === 0) return NEUTRAL;

	// Party direction derived from the live leader's partyColor. Red family
	// (r>b && r>g) => R; otherwise D. Matches how civicAPI / manual assign
	// party colors in our adapters.
	const leaderIsR = isRedParty(leader.partyColor);
	const liveMargin = ((leader.votes - (runnerUp?.votes ?? 0)) / twoParty) * 100;
	const liveSignedR = leaderIsR ? liveMargin : -liveMargin;
	const shift = liveSignedR - archival.margin; // +pp = toward R since archival year

	const magnitude = Math.min(Math.abs(shift) / 20, 1);
	if (magnitude === 0) return '#6b7280'; // flat TIE color
	const ramp = shift > 0 ? '#BF1D29' : '#1C408C';
	return lerpToWhite(ramp, 1 - magnitude);
}

// ---------------------------------------------------------------------------
// Value-text label population ("00" bug).
// ---------------------------------------------------------------------------

/**
 * The yapms SVGs ship with a state/county abbreviation line + a second
 * `<tspan map-type="value-text">00</tspan>` placeholder (intended for EVs or
 * vote totals). We never populate those, so every map shows literal "00"
 * under every region. Walk `[for-region]` text elements, find their
 * value-text child, and either set a meaningful label or hide it.
 */
function applyValueTextLabels(
	svgRoot: SVGElement,
	state: StreamState,
	tab: MapTab,
	regionByAttr: Map<string, RegionResult>
): void {
	const archivalYear = state.ui.archivalYear;
	const texts = svgRoot.querySelectorAll<SVGTextElement>('[for-region]');
	for (const text of Array.from(texts)) {
		const attr = text.getAttribute('for-region');
		const valueTspan = text.querySelector<SVGTSpanElement>('[map-type="value-text"]');
		if (!valueTspan) continue;

		const result = attr ? regionByAttr.get(attr) : undefined;
		const archival =
			archivalYear && result?.archivalByYear?.[archivalYear]
				? result.archivalByYear[archivalYear]
				: null;

		const label = computeLabel(tab, result, state, archival);
		if (label) {
			valueTspan.textContent = label;
			valueTspan.style.display = '';
		} else {
			// Blank string + display:none so the abbr tspan doesn't get
			// orphaned with dangling whitespace.
			valueTspan.textContent = '';
			valueTspan.style.display = 'none';
		}
	}
}

function computeLabel(
	tab: MapTab,
	result: RegionResult | undefined,
	state: StreamState,
	archival: { margin: number } | null
): string {
	if (!result) return '';

	if (tab === 'remaining') {
		// Show reported % (int), else blank (nothing interesting to show).
		const pct = result.reportedPct;
		if (pct > 0) return `${Math.round(pct)}%`;
		return '';
	}

	if (tab === 'margin') {
		// Prefer live-derived margin when we have it; fall back to archival.
		const leader = result.leaderId ? state.candidates.find((c) => c.id === result.leaderId) : null;
		if (leader && result.votes > 0 && state.candidates.length >= 2) {
			const sorted = [...state.candidates].sort((a, b) => b.votes - a.votes);
			const runnerUp = sorted.find((c) => c.id !== leader.id);
			const twoParty = leader.votes + (runnerUp?.votes ?? 0);
			if (twoParty > 0) {
				const pp = ((leader.votes - (runnerUp?.votes ?? 0)) / twoParty) * 100;
				return `+${pp.toFixed(0)}`;
			}
		}
		if (archival) {
			const abs = Math.abs(archival.margin);
			return abs < 1 ? '' : `+${Math.round(abs)}`;
		}
		return '';
	}

	if (tab === 'swing') {
		const shift = computeSwing(result, state, archival);
		if (shift == null) return '';
		const abs = Math.abs(shift);
		if (abs < 0.5) return '=';
		const dir = shift > 0 ? 'R' : 'D';
		return `${dir}+${abs.toFixed(0)}`;
	}

	// `results` tab
	if (result.votes > 0) return fmtShort(result.votes);
	// Pre-results: blank so the map doesn't look perma-marked "00".
	return '';
}

/** Compute signed swing in pp (positive = toward R) or null when insufficient data. */
function computeSwing(
	result: RegionResult,
	state: StreamState,
	archival: { margin: number } | null
): number | null {
	if (!archival) return null;
	const leader = result.leaderId ? state.candidates.find((c) => c.id === result.leaderId) : null;
	if (!leader || result.votes === 0 || state.candidates.length < 2) return null;
	const sorted = [...state.candidates].sort((a, b) => b.votes - a.votes);
	const runnerUp = sorted.find((c) => c.id !== leader.id);
	const twoParty = leader.votes + (runnerUp?.votes ?? 0);
	if (twoParty === 0) return null;
	const liveMargin = ((leader.votes - (runnerUp?.votes ?? 0)) / twoParty) * 100;
	const liveSignedR = isRedParty(leader.partyColor) ? liveMargin : -liveMargin;
	return liveSignedR - archival.margin;
}

/** Compact vote-count label: "9,845" -> "9.8k", "1,234,567" -> "1.2m". */
function fmtShort(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
	if (n >= 10_000) return `${Math.round(n / 1000)}k`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

function isRedParty(color: string): boolean {
	const h = color.replace('#', '').toLowerCase();
	if (h.length < 6) return false;
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return r > b && r > g;
}

/** Lerp a hex color toward white by `t` (0..1). `t=0` returns input. */
function lerpToWhite(hex: string, t: number): string {
	const rgb = hexToRgb(hex);
	if (!rgb) return hex;
	const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
	const r = clamp(rgb.r + (255 - rgb.r) * t);
	const g = clamp(rgb.g + (255 - rgb.g) * t);
	const b = clamp(rgb.b + (255 - rgb.b) * t);
	return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	let h = m[1];
	if (h.length === 3)
		h = h
			.split('')
			.map((c) => c + c)
			.join('');
	const n = parseInt(h, 16);
	return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
