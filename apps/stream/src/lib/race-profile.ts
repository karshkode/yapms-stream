import { z } from 'zod';

/**
 * A RaceProfile describes *shape* only: which SVG to load, how to filter it,
 * which DDHQ-style sections to render, and how many candidates to expect.
 * It is decoupled from the actual numbers; those live in StreamState.
 *
 * Every May 5, 2026 race shape (state-wide primary, US House district, state
 * legislative district, US-wide president, local-no-map, ...) is just a
 * different RaceProfile instance.
 */

export const PartyBadge = z.enum(['D', 'R', 'P', 'I', 'G', 'L', 'N']);
export type PartyBadge = z.infer<typeof PartyBadge>;

export const RegionLabel = z.enum(['Counties', 'Districts', 'States', 'Precincts', 'Wards']);
export type RegionLabel = z.infer<typeof RegionLabel>;

export const SubTab = z.enum(['Results', 'Forecast', 'Early Voting', 'Markets']);
export type SubTab = z.infer<typeof SubTab>;

/**
 * How the map is shaded. Each answers a different on-air question:
 *   results   — who is ahead here?
 *   margin    — by how much, in this region?
 *   swing     — which way has this region moved since the baseline race?
 *   turnout   — is this region carrying more or less of the vote than it did
 *               in the baseline race?
 *   remaining — where is the uncounted vote?
 */
export const MapTab = z.enum(['results', 'margin', 'swing', 'turnout', 'remaining']);
export type MapTab = z.infer<typeof MapTab>;

/**
 * Geography config. `null` for local races with no map.
 *
 * filterAttr / filterValue are the generic mechanism for carving a sub-region
 * out of a larger SVG:
 *   - `{ filterAttr: 'action-groups', filterValue: '39' }` keeps only Ohio
 *     counties from the national usa-counties-2023-blank.svg.
 *   - `{ filterAttr: 'region', filterValue: 'Dallas48|Tarrant48|...' }` keeps
 *     only the counties inside TX State Senate 4.
 *   - `null` / `null` keeps the whole SVG untouched.
 */
export const GeographyConfig = z.object({
	svgPath: z.string(),
	filterAttr: z.string().nullable(),
	filterValue: z.string().nullable(),
	regionLabel: RegionLabel
});
export type GeographyConfig = z.infer<typeof GeographyConfig>;

export const SectionFlags = z.object({
	header: z.boolean(),
	candidates: z.boolean(),
	performance: z.boolean(),
	geography: z.boolean(),
	regions: z.boolean()
});
export type SectionFlags = z.infer<typeof SectionFlags>;

export const RaceProfile = z.object({
	id: z.string(),
	label: z.string(),
	category: z.enum([
		'statewide-primary',
		'statewide-general',
		'us-house',
		'state-leg',
		'us-wide',
		'local-no-map',
		'custom'
	]),
	geography: GeographyConfig.nullable(),
	sections: SectionFlags,
	subTabs: z.array(SubTab),
	// The browse home profile ships [0, 0] because its map has no candidates at
	// all, so the upper bound has to accept zero. Requiring a positive max here
	// meant the profile the app boots into failed validation, and loadState
	// dropped the entire persisted blob — recents, saved races and OBS setup with
	// it — on every reload.
	expectedCandidates: z
		.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
		.refine(([min, max]) => max >= min, {
			message: 'expectedCandidates upper bound must not be below the lower bound'
		})
});
export type RaceProfile = z.infer<typeof RaceProfile>;

/**
 * Seed data shapes. A template ships these baked in so the host loads a ready
 * race and can then edit-in-place. The exact same shapes come back out of
 * DataSource adapters via the merge layer.
 */

export const Candidate = z.object({
	id: z.string(),
	name: z.string(),
	partyColor: z.string(),
	partyLabel: z.string().optional(),
	votes: z.number().int().nonnegative().default(0),
	called: z.boolean().default(false),
	hidden: z.boolean().default(false),
	headshotUrl: z.string().nullable().default(null),
	// Where an auto-resolved headshot came from (a Wikipedia article title).
	// Commons portraits are reusable but most carry an attribution condition,
	// so the editor shows this next to the thumbnail and the host can check
	// the source before putting a face on air. Optional rather than
	// `.default(null)` so persisted state and hand-written seeds that predate
	// the field still parse and still type-check.
	headshotCredit: z.string().nullable().optional()
});
export type Candidate = z.infer<typeof Candidate>;

/**
 * One year's archival snapshot for a region. Baked by
 * apps/stream/scripts/bake-historical-margins.mjs from the tonmcg county-level
 * CSVs. `margin` is the signed 2-party margin percentage (positive = R lead,
 * negative = D lead). `label` is a short display string ("Trump +12.4").
 * `color` is the 4-stop DDHQ ramp hex. Raw vote counts support detail-card
 * breakdowns without another round-trip to the bake data.
 */
export const ArchivalSnapshot = z.object({
	color: z.string(),
	label: z.string(),
	margin: z.number(),
	votesRep: z.number().int().nonnegative(),
	votesDem: z.number().int().nonnegative(),
	votesTotal: z.number().int().nonnegative()
});
export type ArchivalSnapshot = z.infer<typeof ArchivalSnapshot>;

/** Map keyed by year string ("2008", "2012", ..., "2024"). Values may be null
 * when the bake script had no row for the region in that year (Alaska
 * boroughs under a statewide rollup, newly-split counties, etc.). */
export const ArchivalByYear = z.record(z.string(), ArchivalSnapshot.nullable());
export type ArchivalByYear = z.infer<typeof ArchivalByYear>;

export const RegionResult = z.object({
	name: z.string(),
	regionAttr: z.string(),
	leaderId: z.string().nullable().default(null),
	votes: z.number().int().nonnegative().default(0),
	evr: z.number().int().nonnegative().default(0),
	reportedPct: z.number().min(0).max(100).default(0),
	totalReg: z.number().int().nonnegative().default(0),
	// Per-candidate vote tallies for THIS region, keyed by candidate.id
	// (matching `state.candidates[i].id`). Populated by civicAPI when the
	// upstream race detail includes per-region candidate breakdowns; left
	// empty for archival-only snapshots (which carry two-party margin only).
	// RegionDetailCard reads this to render a full candidate table for the
	// selected county/district, not just the live leader.
	candidateVotes: z.record(z.string(), z.number().int().nonnegative()).default({}),
	// Multi-year archival baseline. Default `{}` so a freshly-created region
	// from civicAPI (no baseline available) type-checks. The UI only reads
	// from this when `ui.archivalYear` is set, so missing data gracefully
	// falls back to NEUTRAL coloring.
	archivalByYear: ArchivalByYear.default({})
});
export type RegionResult = z.infer<typeof RegionResult>;

/**
 * One region's line in a captured baseline.
 *
 * Shares, not raw counts, are what make a primary comparable to a general.
 * Turnout roughly doubles between May and November, so raw counts would say
 * every county grew and tell the host nothing, while "Jefferson was 22% of the
 * primary vote and it's 18% tonight" is a real signal about where the
 * electorate showed up. The share is computed at read time from `votes` rather
 * than stored, though — see `turnoutScale` in map/metrics.ts, which has to
 * restrict both sides' denominators to the regions they have in common before
 * either share means anything.
 */
export const BaselineRegion = z.object({
	/** Signed two-party margin, positive = R. Matches ArchivalSnapshot.margin. */
	margin: z.number(),
	/** Votes cast in this region. What turnout comparisons are computed from. */
	votes: z.number().int().nonnegative().default(0),
	/**
	 * This region's fraction (0-1) of the baseline race's total vote, as it
	 * stood at capture. Superseded by `votes` for computation and kept only so
	 * baselines captured by an older build still load.
	 */
	share: z.number().min(0).max(1).default(0)
});
export type BaselineRegion = z.infer<typeof BaselineRegion>;

/**
 * A race's per-region results, frozen so a later race over the same geography
 * can be measured against it.
 *
 * This is what makes "what did the primary tell us about November" answerable.
 * The alternative — baking historical results for every office — is not
 * possible: the seed data covers presidential margins only, and civicAPI
 * carries no prior-cycle downballot results. But the host *watches* the primary
 * in this app, so the numbers pass through it. Capturing them at the end of the
 * night costs one click and turns every later race on that map into a
 * comparison.
 */
export const ComparisonBaseline = z.object({
	id: z.string(),
	/** Host-facing name, e.g. "KY Governor primary, May 2026". */
	label: z.string(),
	capturedAt: z.number().int(),
	/**
	 * The SVG + filter the baseline was captured on. Comparing Ohio counties
	 * against Texas ones would silently produce garbage, so the picker warns
	 * when this doesn't match the loaded race.
	 */
	geographyKey: z.string().nullable().default(null),
	/**
	 * False when the top two candidates weren't from opposing parties — a
	 * primary, or a non-partisan municipal race. Margin and swing are
	 * meaningless against such a baseline (both candidates are Democrats), but
	 * turnout share is still perfectly comparable, so the baseline is kept and
	 * the UI steers to the mode that works.
	 */
	partisan: z.boolean().default(true),
	totalVotes: z.number().int().nonnegative().default(0),
	/** Keyed by `RegionResult.regionAttr`. */
	regions: z.record(z.string(), BaselineRegion).default({})
});
export type ComparisonBaseline = z.infer<typeof ComparisonBaseline>;

export const PerformanceRow = z.object({
	raceName: z.string(),
	partyBadge: PartyBadge,
	marginLabel: z.string(),
	marginColor: z.string(),
	shiftLabel: z.string().default('-')
});
export type PerformanceRow = z.infer<typeof PerformanceRow>;

export const RaceSeed = z.object({
	title: z.string().optional(),
	partyBadge: PartyBadge.optional(),
	partyBadgeColor: z.string().optional(),
	pollsCloseLabel: z.string().optional(),
	dateLabel: z.string().optional(),
	candidates: z.array(Candidate).default([]),
	regions: z.array(RegionResult).default([]),
	performance: z.array(PerformanceRow).default([])
});
export type RaceSeed = z.infer<typeof RaceSeed>;

export const RaceTemplate = z.object({
	id: z.string(),
	name: z.string(),
	category: RaceProfile.shape.category,
	tags: z.array(z.string()).default([]),
	profile: RaceProfile,
	seed: RaceSeed
});
export type RaceTemplate = z.infer<typeof RaceTemplate>;
