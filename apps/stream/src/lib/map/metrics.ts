import type { Candidate, ComparisonBaseline, RegionResult } from '../race-profile';
import type { StreamState } from '../stream-state';
import { countyMapStateFips, inferOffice, officeHistoryFor } from './office-history.svelte';

/**
 * Per-region numbers behind the map's comparison modes, and the baseline they
 * are measured against.
 *
 * Pulled out of apply-colors.ts because the same figures are needed in three
 * places that must agree: the map fill, the value-text label on the map, and
 * the region detail card. When each computed its own version they disagreed —
 * and the versions that read `state.candidates` were computing a statewide
 * number and painting it on every county, which is why Margin and Swing showed
 * one flat shade across the whole map.
 */

/** Positive = R lead. Matches the convention in `ArchivalSnapshot.margin`. */
export interface RegionMargin {
	signed: number;
	leaderId: string;
	runnerUpId: string | null;
}

export function isRedParty(color: string): boolean {
	const h = color.replace('#', '').toLowerCase();
	if (h.length < 6) return false;
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return r > b && r > g;
}

/**
 * This region's two-party margin from its own candidate splits.
 *
 * Returns null when the region carries no per-candidate breakdown, which is the
 * case for manually-entered races (the region editor only takes a leader and a
 * total) and for civicAPI races that report leader-only. Null means "we don't
 * know", and callers paint accordingly — the previous code substituted the
 * statewide margin here, which looked like data but was the same number in
 * every region.
 */
export function regionMargin(result: RegionResult, candidates: Candidate[]): RegionMargin | null {
	const entries = Object.entries(result.candidateVotes ?? {}).filter(([, v]) => v > 0);
	if (entries.length === 0) return null;
	entries.sort((a, b) => b[1] - a[1]);
	const [leaderId, leaderVotes] = entries[0];
	const [runnerUpId, runnerUpVotes] = entries[1] ?? [null, 0];
	const twoParty = leaderVotes + runnerUpVotes;
	if (twoParty === 0) return null;

	const byId = new Map(candidates.map((c) => [c.id, c]));
	const margin = ((leaderVotes - runnerUpVotes) / twoParty) * 100;
	const leaderColor = byId.get(leaderId)?.partyColor ?? '';
	return {
		signed: isRedParty(leaderColor) ? margin : -margin,
		leaderId,
		runnerUpId
	};
}

/**
 * Total votes this region will have reported once counting finishes, estimated
 * by scaling what's counted so far by the share of precincts reporting.
 *
 * Without this, every share-of-vote comparison is dominated by *when* a county
 * reports rather than how it votes: a rural county that finishes counting at
 * 8pm looks like it's carrying a huge share of the electorate, and a city at 4%
 * reporting looks absent. Dividing by the reported fraction removes the
 * counting clock from the comparison, which is the only way the turnout mode
 * says something true before the night is over.
 *
 * Null below a floor of reporting, because dividing 30 votes by 0.004 produces
 * a confident-looking projection built on nothing.
 */
const MIN_REPORTING_PCT = 5;

export function projectedVotes(result: RegionResult): number | null {
	if (result.votes <= 0) return null;
	if (result.reportedPct >= 99.5) return result.votes;
	if (result.reportedPct < MIN_REPORTING_PCT) return null;
	return result.votes / (result.reportedPct / 100);
}

/** Votes still to be counted here, or null when it can't be estimated. */
export function outstandingVotes(result: RegionResult): number | null {
	const projected = projectedVotes(result);
	if (projected === null) return null;
	return Math.max(0, projected - result.votes);
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

export interface ResolvedBaseline {
	ref: string;
	label: string;
	/** False for primaries and non-partisan races: margin/swing don't apply. */
	partisan: boolean;
	/** Signed two-party margin (positive = R) for a region, or null. */
	marginFor(regionAttr: string): number | null;
	/**
	 * Votes cast in this region in the baseline race, or null.
	 *
	 * Raw votes rather than a precomputed share, because the denominator that
	 * makes turnout meaningful can only be worked out once both sides are known
	 * — see `turnoutScale`.
	 */
	votesFor(regionAttr: string): number | null;
	/**
	 * False when the baseline carries no vote counts at all, so turnout can't be
	 * computed against it. Stated up front so the legend can explain a blank
	 * turnout map instead of probing every region and guessing.
	 */
	hasVotes: boolean;
	/** How many regions the baseline actually has data for. */
	coverage: number;
}

export const ARCHIVAL_YEARS = ['2008', '2012', '2016', '2020', '2024'] as const;

/**
 * Turn `ui.comparison.baselineRef` into something the map can read, or null
 * when the reference points at data this race doesn't have (a captured baseline
 * the host deleted, a presidential year absent from these seeds, or a past
 * same-office race in a state whose history hasn't loaded yet).
 */
export function resolveBaseline(state: StreamState): ResolvedBaseline | null {
	const ref = state.ui.comparison.baselineRef;

	if (ref.startsWith('archival:')) {
		const year = ref.slice('archival:'.length);
		const margins = new Map<string, number>();
		const votes = new Map<string, number>();
		for (const region of state.regions) {
			const snap = region.archivalByYear?.[year];
			if (!snap) continue;
			margins.set(region.regionAttr, snap.margin);
			if (snap.votesTotal > 0) votes.set(region.regionAttr, snap.votesTotal);
		}
		if (margins.size === 0) return null;
		return {
			ref,
			label: `${year} president`,
			partisan: true,
			marginFor: (attr) => margins.get(attr) ?? null,
			votesFor: (attr) => votes.get(attr) ?? null,
			hasVotes: votes.size > 0,
			coverage: margins.size
		};
	}

	if (ref.startsWith('history:')) {
		const race = officeHistoryFor(countyMapStateFips(state)).find(
			(r) => r.id === ref.slice('history:'.length)
		);
		if (!race) return null;
		return {
			ref,
			label: race.label,
			partisan: race.partisan,
			marginFor: (attr) => race.regions[attr]?.margin ?? null,
			votesFor: (attr) => race.regions[attr]?.votesTotal ?? null,
			hasVotes: race.votesTotal > 0,
			coverage: Object.keys(race.regions).length
		};
	}

	if (ref.startsWith('captured:')) {
		const id = ref.slice('captured:'.length);
		const baseline = state.ui.comparison.baselines.find((b) => b.id === id);
		if (!baseline) return null;
		return {
			ref,
			label: baseline.label,
			partisan: baseline.partisan,
			marginFor: (attr) => baseline.regions[attr]?.margin ?? null,
			votesFor: (attr) => baseline.regions[attr]?.votes ?? null,
			hasVotes: baseline.totalVotes > 0,
			coverage: Object.keys(baseline.regions).length
		};
	}

	return null;
}

/** Every baseline the host can pick, with enough detail to choose sensibly. */
export interface BaselineOption {
	ref: string;
	label: string;
	kind: 'archival' | 'history' | 'captured';
	/** Regions in the loaded race this baseline has data for. */
	coverage: number;
	partisan: boolean;
	/** True when the baseline was captured on a different map. */
	geographyMismatch: boolean;
	/** True when this is a past race for the office the loaded race is for. */
	sameOffice: boolean;
}

export function baselineOptions(state: StreamState): BaselineOption[] {
	const attrs = new Set(state.regions.map((r) => r.regionAttr));

	// Past same-office races first. This is the comparison a host wants by
	// default on a downballot night, and the one they'd otherwise have to know
	// exists to go looking for.
	const office = inferOffice(state.race.title);
	const history: Array<BaselineOption & { year: number }> = [];
	for (const race of officeHistoryFor(countyMapStateFips(state))) {
		let coverage = 0;
		for (const attr of Object.keys(race.regions)) if (attrs.has(attr)) coverage++;
		if (coverage === 0) continue;
		history.push({
			ref: `history:${race.id}`,
			label: race.label,
			kind: 'history',
			coverage,
			partisan: race.partisan,
			geographyMismatch: false,
			sameOffice: race.office === office,
			year: race.year
		});
	}
	// Same office first, each group newest-first. A Senate night should not have
	// to scroll past three governor's races to find the last Senate one, and the
	// baked file's own order is neither.
	history.sort((a, b) => Number(b.sameOffice) - Number(a.sameOffice) || b.year - a.year);

	const archival: BaselineOption[] = [];
	for (const year of ARCHIVAL_YEARS) {
		let coverage = 0;
		for (const region of state.regions) if (region.archivalByYear?.[year]) coverage++;
		if (coverage === 0) continue;
		archival.push({
			ref: `archival:${year}`,
			label: `${year} president`,
			kind: 'archival',
			coverage,
			partisan: true,
			geographyMismatch: false,
			sameOffice: false
		});
	}

	const key = geographyKey(state);
	const captured: BaselineOption[] = [];
	for (const baseline of state.ui.comparison.baselines) {
		let coverage = 0;
		for (const attr of Object.keys(baseline.regions)) if (attrs.has(attr)) coverage++;
		captured.push({
			ref: `captured:${baseline.id}`,
			label: baseline.label,
			kind: 'captured',
			coverage,
			partisan: baseline.partisan,
			geographyMismatch: baseline.geographyKey !== null && baseline.geographyKey !== key,
			sameOffice: false
		});
	}

	// Captures newest-first and presidential years most-recent-first, which is
	// the order a host reaches for each of them.
	return [...history, ...captured.reverse(), ...archival.reverse()];
}

/**
 * The baseline to select for a freshly loaded race, or null to leave it be.
 *
 * Prefers the most recent past race for the same office, which is the whole
 * point of baking them: the host loads Michigan's Senate race and Swing is
 * already measuring against the last Michigan Senate race, with nothing set up.
 *
 * Returns null rather than a fallback when there's no same-office history, so
 * the caller leaves the existing selection — usually the presidential default —
 * alone instead of churning it.
 */
export function autoBaselineRef(state: StreamState): string | null {
	const office = inferOffice(state.race.title);
	if (!office) return null;
	const attrs = new Set(state.regions.map((r) => r.regionAttr));
	const best = officeHistoryFor(countyMapStateFips(state))
		.filter((race) => race.office === office && race.partisan)
		.filter((race) => Object.keys(race.regions).some((attr) => attrs.has(attr)))
		.sort((a, b) => b.year - a.year)[0];
	return best ? `history:${best.id}` : null;
}

/**
 * Identifies the map a baseline was captured on, so Ohio counties don't get
 * compared against Texas ones. The SVG path alone isn't enough — every state's
 * county map is the same national SVG carved by a filter.
 */
export function geographyKey(state: StreamState): string | null {
	const geo = state.profile?.geography;
	if (!geo) return null;
	return [geo.svgPath, geo.filterAttr ?? '', geo.filterValue ?? ''].join('|');
}

/**
 * Freeze the loaded race's per-region results into a comparison baseline.
 *
 * Regions with no counted vote are dropped rather than stored as zeroes: a
 * county that hadn't reported when the host hit capture would otherwise look
 * like a county that genuinely cast no votes, and later show up as an infinite
 * turnout increase.
 */
export function captureBaseline(state: StreamState, label: string): ComparisonBaseline {
	const regions: ComparisonBaseline['regions'] = {};
	const totalVotes = state.regions.reduce((sum, r) => sum + r.votes, 0);

	for (const region of state.regions) {
		if (region.votes <= 0) continue;
		const margin = regionMargin(region, state.candidates);
		regions[region.regionAttr] = {
			margin: margin?.signed ?? 0,
			votes: region.votes,
			share: totalVotes > 0 ? region.votes / totalVotes : 0
		};
	}

	return {
		id: `b${Date.now().toString(36)}`,
		label: label.trim() || state.race.title || 'Captured baseline',
		capturedAt: Date.now(),
		geographyKey: geographyKey(state),
		partisan: isPartisanField(state.candidates),
		totalVotes,
		regions
	};
}

/**
 * Whether the top two candidates represent opposing parties, which decides
 * whether margin and swing mean anything against this race.
 *
 * A Democratic primary has two Democrats, so a "D+8 margin" is a fact about
 * which Democrat won and not about partisan lean — comparing November's margin
 * to it would produce a confident, meaningless swing number. Turnout share
 * survives the distinction, so such baselines are kept and the UI points at the
 * mode that works.
 */
export function isPartisanField(candidates: Candidate[]): boolean {
	const top = [...candidates].sort((a, b) => b.votes - a.votes).slice(0, 2);
	if (top.length < 2) return false;
	return isRedParty(top[0].partyColor) !== isRedParty(top[1].partyColor);
}

// ---------------------------------------------------------------------------
// Derived comparison figures
// ---------------------------------------------------------------------------

/**
 * Signed margin shift for a region since the baseline, in points, positive =
 * toward R. Null when either side is unknown, or when either race's margin has
 * no partisan meaning.
 *
 * Both sides have to be a two-party contest, not just the baseline. A
 * Democratic primary's margin is a fact about which Democrat won, so subtracting
 * a past general's margin from it produces a number — a large one, since the
 * whole primary field reads as one party — and nothing it could be a
 * measurement of. The legend says as much rather than shading the map with it.
 */
export function regionSwing(
	result: RegionResult,
	candidates: Candidate[],
	baseline: ResolvedBaseline | null
): number | null {
	if (!baseline || !baseline.partisan) return null;
	if (!isPartisanField(candidates)) return null;
	const base = baseline.marginFor(result.regionAttr);
	if (base === null) return null;
	const live = regionMargin(result, candidates);
	if (!live) return null;
	return live.signed - base;
}

/**
 * The two denominators a turnout comparison divides by.
 *
 * Both are summed over the *same* set of regions — the ones that have a
 * projectable live count and a baseline figure — rather than over each side's
 * own full extent. That matters more than it sounds. Every baseline has gaps:
 * MEDSL's 2018 file is missing five New York counties including Suffolk, and a
 * captured baseline only holds the counties that had reported when the host
 * pressed the button. Dividing a region's live share of all 62 counties by its
 * baseline share of 57 makes every county in the state look like it turned out
 * below its own history, by roughly whatever share the missing ones held.
 * Restricting both totals to the overlap removes that bias entirely, and leaves
 * the answer meaning what the legend says it means.
 */
export interface TurnoutScale {
	/** Projected live votes across regions the baseline also covers. */
	liveTotal: number;
	/** Baseline votes across regions the live race can be projected for. */
	baseTotal: number;
}

export function turnoutScale(
	regions: RegionResult[],
	baseline: ResolvedBaseline | null
): TurnoutScale {
	const scale: TurnoutScale = { liveTotal: 0, baseTotal: 0 };
	if (!baseline) return scale;
	for (const region of regions) {
		const projected = projectedVotes(region);
		if (projected === null) continue;
		const base = baseline.votesFor(region.regionAttr);
		if (base === null || base <= 0) continue;
		scale.liveTotal += projected;
		scale.baseTotal += base;
	}
	return scale;
}

/**
 * How much more (or less) of the electorate this region accounts for than it
 * did in the baseline race, as a multiple: 1.2 means it's carrying 20% more of
 * the statewide vote than last time.
 *
 * A ratio rather than a point difference because shares are small numbers whose
 * differences don't read well — "0.04pp more of the vote" means nothing on air,
 * while "a fifth more of the vote than the primary" does.
 */
export function regionTurnoutIndex(
	result: RegionResult,
	scale: TurnoutScale,
	baseline: ResolvedBaseline | null
): number | null {
	if (!baseline || scale.liveTotal <= 0 || scale.baseTotal <= 0) return null;
	const base = baseline.votesFor(result.regionAttr);
	if (base === null || base <= 0) return null;
	const projected = projectedVotes(result);
	if (projected === null) return null;
	return projected / scale.liveTotal / (base / scale.baseTotal);
}

/**
 * Sum of every region's projected final vote. Only regions that can be
 * projected contribute, so a race's completeness isn't overstated by counties
 * that haven't started counting.
 */
export function projectedRaceTotal(regions: RegionResult[]): number {
	let total = 0;
	for (const region of regions) {
		const projected = projectedVotes(region);
		if (projected !== null) total += projected;
	}
	return total;
}
