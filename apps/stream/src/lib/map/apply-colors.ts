import type { MapTab, RegionResult } from '../race-profile';
import type { StreamState } from '../stream-state';
import {
	outstandingVotes,
	regionMargin,
	regionSwing,
	regionTurnoutIndex,
	resolveBaseline,
	turnoutScale,
	type ResolvedBaseline,
	type TurnoutScale
} from './metrics';

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
 * Each tab answers a different question, and every one of them is answered per
 * region — the arithmetic lives in ./metrics.ts:
 *   results   — who leads here (leader party color, full saturation).
 *   margin    — by how much here (leader color, paler as it tightens).
 *   swing     — which way this region moved since the baseline race.
 *   turnout   — whether this region is carrying more or less of the vote than
 *               it did in the baseline race.
 *   remaining — where the uncounted vote is, by how much of it is left.
 *
 * Also fills `<tspan map-type="value-text">` labels that ship with the yapms
 * SVGs (EV counts / vote subtitles) so the map doesn't display naked "00"s.
 */

// NEUTRAL is the default fill when a region has no live leader data AND the
// archival slider is either off or has no row for the region. Picked to read
// as "unreported" without blending into the stage chrome (#0b0b0e area).
const NEUTRAL = '#3a3a44';
// PENDING applies only on the `remaining` tab at 0% reported. A slightly
// warmer gray than NEUTRAL so a host can distinguish "no data at all" (neutral
// base map) from "actively awaiting returns" (pending).
const PENDING = '#4b5563';
// Swing ramp. Party-colored, because a swing toward the Republican is the
// single fact the shade is communicating.
const SWING_R = '#BF1D29';
const SWING_D = '#1C408C';
const FLAT = '#6b7280';
// Turnout ramp, deliberately NOT red/blue: "this county is punching above its
// weight" has nothing to do with which party is winning it, and painting it in
// party colors invites exactly that misreading on air.
const TURNOUT_UP = '#0d9488';
const TURNOUT_DOWN = '#b45309';
// Remaining ramp. A single hue whose intensity tracks outstanding vote, so the
// eye lands on wherever the night is still undecided.
const OUTSTANDING = '#eab308';

/** Full saturation at this much margin shift, in points. */
const SWING_FULL_PP = 20;
/** Full saturation at this far from the baseline share, as a ratio. */
const TURNOUT_FULL_RATIO = 0.4;

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
	const baseline = resolveBaseline(state);
	// Computed once for the whole map rather than per region: each is a sum over
	// every region, and the turnout fill needs both for each of them.
	const scale =
		tab === 'turnout' ? turnoutScale(state.regions, baseline) : { liveTotal: 0, baseTotal: 0 };
	// Scale the remaining tab against the biggest pile of uncounted votes on the
	// map, so the shading always has a top end. An absolute scale would leave a
	// county race almost entirely unshaded and a presidential map saturated.
	const peakOutstanding = tab === 'remaining' ? maxOutstanding(state.regions) : 0;

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
			fill = fillForRemainingTab(result, peakOutstanding);
		} else if (tab === 'swing') {
			fill = fillForSwingTab(result, state, baseline);
		} else if (tab === 'turnout') {
			fill = fillForTurnoutTab(result, baseline, scale);
		}

		node.style.fill = fill;

		// Outline the selected region, at a width measured in screen pixels.
		//
		// This used to be 1.25 in user-space units, which is a hairline on the
		// national map — 959 units across — and catastrophic on anything smaller.
		// New York City's map is 8.6 units wide, so 1.25 was fifteen percent of the
		// frame: centred on a shape as narrow as Manhattan the stroke swallowed the
		// borough whole and the map showed a yellow blob where the selection was.
		// The same width also thickened with the zoom, so drilling into a county
		// grew the outline instead of leaving it alone.
		//
		// `non-scaling-stroke` takes the width out of user space entirely: it means
		// device pixels, so the highlight is the same weight on a city map, a state
		// map and a national one, at every zoom level.
		const isSelected = selectedAttr && attr === selectedAttr;
		if (isSelected) {
			node.style.stroke = '#f5c518';
			node.style.strokeWidth = '3';
			node.style.vectorEffect = 'non-scaling-stroke';
			// Bring selected path to front by re-appending it; fixes the case where
			// the neighboring region's edge covers our stroke.
			const parent = node.parentNode;
			if (parent) parent.appendChild(node);
		} else {
			node.style.removeProperty('stroke');
			node.style.removeProperty('stroke-width');
			node.style.removeProperty('vector-effect');
		}
	}

	applyValueTextLabels(svgRoot, state, tab, regionByAttr, baseline, scale);
}

function maxOutstanding(regions: RegionResult[]): number {
	let peak = 0;
	for (const region of regions) {
		const out = outstandingVotes(region);
		if (out !== null && out > peak) peak = out;
	}
	return peak;
}

// ---------------------------------------------------------------------------
// Per-tab fill logic. Split out for readability; each returns just the hex
// string (or rgb(...)) to apply as `fill` on the path.
// ---------------------------------------------------------------------------

/**
 * Margin tab: more-decisive = full saturation, toss-up = lerped toward white.
 *
 * Intensity source ladder:
 *   1. This region's own candidate splits.
 *   2. `archival.margin` from the slider year, when the region has no live
 *      breakdown to compute from.
 *   3. Flat leader color — we know who's ahead here but not by how much, and
 *      a made-up shade is worse than an honest one.
 */
function fillForMarginTab(
	baseColor: string,
	result: RegionResult | undefined,
	state: StreamState,
	archival: { margin: number } | null
): string {
	if (!result) return baseColor;

	const live = regionMargin(result, state.candidates);
	if (live) {
		const intensity = clamp01(Math.abs(live.signed) / 100);
		return lerpToWhite(baseColor, 1 - intensity);
	}
	if (archival && archival.margin !== 0) {
		const intensity = clamp01(Math.abs(archival.margin) / 100);
		return lerpToWhite(baseColor, 1 - intensity);
	}
	return baseColor;
}

/**
 * Remaining tab: how much vote is still out, not merely whether any is.
 *
 * The old version was a three-way traffic light — grey when finished, leader
 * color while counting, darker grey at zero — which answered "has this county
 * reported" and never "does what's left matter". On a map where one city holds
 * 200,000 uncounted ballots and forty rural counties hold two thousand between
 * them, those are completely different questions, and only the second one tells
 * a host whether the race can still move.
 */
function fillForRemainingTab(result: RegionResult | undefined, peak: number): string {
	if (!result) return NEUTRAL;
	if (result.reportedPct >= 99.5) return NEUTRAL;
	if (result.votes <= 0) return PENDING;

	const out = outstandingVotes(result);
	// Counting has started but too little has landed to project from. It is
	// still outstanding, so it can't read as finished.
	if (out === null || peak <= 0) return PENDING;
	return lerpToWhite(OUTSTANDING, 1 - clamp01(out / peak));
}

/**
 * Swing tab: red where the region moved toward the Republican since the
 * baseline race, blue where it moved toward the Democrat.
 *
 * Previously this required the archival slider to be off "Live" and otherwise
 * painted the entire map neutral grey, so the tab looked broken until the host
 * found an unrelated control. The baseline now defaults to the most recent
 * baked presidential year, and is chosen explicitly in the Compare panel.
 */
function fillForSwingTab(
	result: RegionResult | undefined,
	state: StreamState,
	baseline: ResolvedBaseline | null
): string {
	if (!result) return NEUTRAL;
	const shift = regionSwing(result, state.candidates, baseline);
	if (shift === null) return NEUTRAL;

	const magnitude = clamp01(Math.abs(shift) / SWING_FULL_PP);
	if (magnitude === 0) return FLAT;
	return lerpToWhite(shift > 0 ? SWING_R : SWING_D, 1 - magnitude);
}

/**
 * Turnout tab: teal where this region is carrying more of the statewide vote
 * than it did in the baseline race, amber where it's carrying less.
 *
 * This is the mode that answers "what did the primary tell us about tonight".
 * Comparing shares rather than raw counts is what makes a May primary and a
 * November general commensurable at all, and projecting each region to its
 * final total (see `projectedVotes`) keeps the answer from being a readout of
 * which counties happen to have finished counting.
 */
function fillForTurnoutTab(
	result: RegionResult | undefined,
	baseline: ResolvedBaseline | null,
	scale: TurnoutScale
): string {
	if (!result) return NEUTRAL;
	const index = regionTurnoutIndex(result, scale, baseline);
	if (index === null) return NEUTRAL;

	const delta = index - 1;
	const magnitude = clamp01(Math.abs(delta) / TURNOUT_FULL_RATIO);
	if (magnitude === 0) return FLAT;
	return lerpToWhite(delta > 0 ? TURNOUT_UP : TURNOUT_DOWN, 1 - magnitude);
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
	regionByAttr: Map<string, RegionResult>,
	baseline: ResolvedBaseline | null,
	scale: TurnoutScale
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

		const label = computeLabel(tab, result, state, archival, baseline, scale);
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
	archival: { margin: number } | null,
	baseline: ResolvedBaseline | null,
	scale: TurnoutScale
): string {
	if (!result) return '';

	if (tab === 'remaining') {
		if (result.reportedPct >= 99.5) return '';
		const out = outstandingVotes(result);
		if (out === null) return result.reportedPct > 0 ? `${Math.round(result.reportedPct)}%` : '';
		return fmtShort(Math.round(out));
	}

	if (tab === 'margin') {
		const live = regionMargin(result, state.candidates);
		if (live) return `+${Math.abs(live.signed).toFixed(0)}`;
		if (archival) {
			const abs = Math.abs(archival.margin);
			return abs < 1 ? '' : `+${Math.round(abs)}`;
		}
		return '';
	}

	if (tab === 'swing') {
		const shift = regionSwing(result, state.candidates, baseline);
		if (shift === null) return '';
		const abs = Math.abs(shift);
		if (abs < 0.5) return '=';
		return `${shift > 0 ? 'R' : 'D'}+${abs.toFixed(0)}`;
	}

	if (tab === 'turnout') {
		const index = regionTurnoutIndex(result, scale, baseline);
		if (index === null) return '';
		const pct = (index - 1) * 100;
		if (Math.abs(pct) < 1) return '=';
		return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`;
	}

	// `results` tab
	if (result.votes > 0) return fmtShort(result.votes);
	// Pre-results: blank so the map doesn't look perma-marked "00".
	return '';
}

/** Compact vote-count label: "9,845" -> "9.8k", "1,234,567" -> "1.2m". */
function fmtShort(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
	if (n >= 10_000) return `${Math.round(n / 1000)}k`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
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
