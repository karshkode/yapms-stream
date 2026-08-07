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

export const MapTab = z.enum(['results', 'margin', 'swing', 'remaining']);
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
	expectedCandidates: z.tuple([z.number().int().nonnegative(), z.number().int().positive()])
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
	headshotUrl: z.string().nullable().default(null)
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
