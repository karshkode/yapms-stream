import type { StreamState, TickerCandidate } from '../stream-state';

/**
 * A DataSource is anything that can produce a `Partial<StreamState>`:
 * manual entry, civicAPI, a Python sidecar wrapping elex-clarity, or a
 * ballpark template seed. The merge layer below lets us layer them.
 */

export type StreamStatePatch = {
	race?: Partial<StreamState['race']>;
	candidates?: StreamState['candidates'];
	performance?: StreamState['performance'];
	regions?: StreamState['regions'];
};

export type DataSourceKind = 'manual' | 'seed' | 'civicapi' | 'clarity' | 'ddhq' | 'openfec';

export interface RaceListEntry {
	id: string;
	title: string;
	date: string;
	state: string | null;
	candidateCount: number | null;
	reportingStatus: 'Pre' | 'Live' | 'Final' | null;
	/**
	 * civicAPI populates `district` with the county name for local/municipal
	 * races — e.g. "Yorktown Town Council" has district="Delaware" (the IN
	 * county). We surface it on the list entry so the resolver can propose
	 * "pre-select Delaware County" when the race is loaded, which makes the
	 * stage auto-zoom to the relevant county instead of dumping the host on
	 * an unfocused statewide map.
	 */
	district: string | null;
	/**
	 * The city/town name for municipal races. Usually narrower than
	 * `district` (Richardson sits inside Dallas county). Not used for
	 * pre-select yet because county-level SVGs don't subdivide by
	 * municipality, but surfaced in the list row so the host can tell
	 * which of 20 "Proposition A" rows they're about to load.
	 */
	municipality: string | null;
}

/**
 * Headline numbers for a race that isn't loaded on the stage. Used by the
 * broadcast ticker, which needs a leader and a reporting percentage for many
 * races at once and none of the per-region detail a `StreamStatePatch` carries.
 */
export interface RaceSummary {
	title: string;
	state: string | null;
	reportedPct: number | null;
	candidates: TickerCandidate[];
}

export interface DataSource {
	kind: DataSourceKind;
	searchRaces?(query: string): Promise<RaceListEntry[]>;
	fetchRace?(raceId: string): Promise<StreamStatePatch>;
	/**
	 * Start polling a race. Yields patches at ~intervalMs cadence. Consumers
	 * iterate and feed each patch through `mergePatches`. Stops when the
	 * consumer breaks out of the `for await` loop (cancellation is handled by
	 * the iterator contract).
	 */
	pollRace?(raceId: string, intervalMs: number): AsyncIterable<StreamStatePatch>;
}

/**
 * Field-by-field merge in priority order: manual > live > seed.
 *
 * Rules:
 *   - Missing / undefined field in a higher layer passes through to the next.
 *   - Arrays (candidates / regions / performance) merge per-row by id (for
 *     candidates) or regionAttr (for regions) or index (for performance).
 *   - `race` is shallow-merged field-by-field.
 */
export function mergePatches(
	seed: StreamStatePatch,
	live: StreamStatePatch,
	manual: StreamStatePatch
): StreamStatePatch {
	return {
		race: {
			...(seed.race ?? {}),
			...(live.race ?? {}),
			...(manual.race ?? {})
		},
		candidates: mergeCandidates(seed.candidates, live.candidates, manual.candidates),
		regions: mergeRegions(seed.regions, live.regions, manual.regions),
		performance: manual.performance ?? live.performance ?? seed.performance ?? []
	};
}

function mergeCandidates(
	seed: StreamState['candidates'] | undefined,
	live: StreamState['candidates'] | undefined,
	manual: StreamState['candidates'] | undefined
): StreamState['candidates'] {
	// Manual wins wholesale when provided (the host has taken control).
	if (manual && manual.length > 0) return manual;
	// Live fills in when present; fall back to seed otherwise.
	if (live && live.length > 0) {
		const seedById = new Map((seed ?? []).map((c) => [c.id, c]));
		return live.map((c) => ({ ...(seedById.get(c.id) ?? c), ...c }));
	}
	return seed ?? [];
}

function mergeRegions(
	seed: StreamState['regions'] | undefined,
	live: StreamState['regions'] | undefined,
	manual: StreamState['regions'] | undefined
): StreamState['regions'] {
	const seedByAttr = new Map((seed ?? []).map((r) => [r.regionAttr, r]));
	const liveByAttr = new Map((live ?? []).map((r) => [r.regionAttr, r]));
	const manualByAttr = new Map((manual ?? []).map((r) => [r.regionAttr, r]));

	// Union of all keys so a region appearing in any layer survives.
	const keys = new Set<string>([
		...seedByAttr.keys(),
		...liveByAttr.keys(),
		...manualByAttr.keys()
	]);

	const merged: StreamState['regions'] = [];
	const emptyRow = {
		name: '',
		regionAttr: '',
		leaderId: null,
		votes: 0,
		evr: 0,
		reportedPct: 0,
		totalReg: 0,
		candidateVotes: {},
		archivalByYear: {}
	} satisfies StreamState['regions'][number];
	for (const key of keys) {
		const base = seedByAttr.get(key);
		const l = liveByAttr.get(key);
		const m = manualByAttr.get(key);
		const row: StreamState['regions'][number] = {
			...emptyRow,
			...(base ?? { name: key, regionAttr: key }),
			...(l ?? {}),
			...(m ?? {})
		};
		merged.push(row);
	}
	// Preserve seed order where possible.
	if (seed && seed.length > 0) {
		const order = new Map(seed.map((r, i) => [r.regionAttr, i]));
		merged.sort((a, b) => (order.get(a.regionAttr) ?? 9999) - (order.get(b.regionAttr) ?? 9999));
	}
	return merged;
}

/**
 * Apply a `StreamStatePatch` to a full StreamState. Used by both the
 * control-side "host hit save" path and the overlay-side "broadcast arrived"
 * path, so the two sides never diverge in how they assemble final state.
 */
export function applyPatch(state: StreamState, patch: StreamStatePatch): StreamState {
	return {
		...state,
		race: { ...state.race, ...(patch.race ?? {}) },
		candidates: patch.candidates ?? state.candidates,
		performance: patch.performance ?? state.performance,
		regions: patch.regions ?? state.regions
	};
}

/**
 * Carry already-resolved headshots from the current roster onto an incoming
 * live roster.
 *
 * Every live adapter normalizes candidates with `headshotUrl: null` because no
 * results feed publishes portraits. The control desk replaces the whole
 * candidates array on each poll tick, so without this a photo — whether the
 * host pasted the URL by hand or the Wikipedia lookup resolved it — survives
 * only until the next tick, roughly 30 seconds. Faces would appear and then
 * silently vanish on air.
 *
 * Matching is by candidate id first (civicAPI derives ids deterministically
 * from the name, so they're stable across ticks) and by normalized name as a
 * fallback, which covers a roster loaded from a template seed with uuid ids and
 * then refreshed from civicAPI.
 *
 * A non-null `headshotUrl` on the incoming row always wins, so a future feed
 * that does carry portraits takes precedence over our guess.
 */
export function preserveHeadshots(
	prev: StreamState['candidates'],
	next: StreamState['candidates']
): StreamState['candidates'] {
	if (prev.length === 0 || next.length === 0) return next;
	const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
	const byId = new Map<string, StreamState['candidates'][number]>();
	const byName = new Map<string, StreamState['candidates'][number]>();
	for (const c of prev) {
		if (!c.headshotUrl) continue;
		byId.set(c.id, c);
		byName.set(normalize(c.name), c);
	}
	if (byId.size === 0) return next;
	return next.map((c) => {
		if (c.headshotUrl) return c;
		const prior = byId.get(c.id) ?? byName.get(normalize(c.name));
		if (!prior) return c;
		return { ...c, headshotUrl: prior.headshotUrl, headshotCredit: prior.headshotCredit ?? null };
	});
}

/**
 * Remap live region rows onto the seeded regionAttrs by fuzzy-matching name.
 *
 * civicAPI identifies regions by lowercase-snakecase slug (e.g. "hot_spring"),
 * while the yapms SVG uses concatenated-name-plus-FIPS (e.g. "Hot Spring05").
 * Without this, live votes land under a regionAttr the SVG doesn't know about
 * and counties never change color.
 *
 * Strategy:
 *   1. Normalize both sides (lowercase, strip non-alphanum).
 *   2. Index seed regions by normalized name, plus the aliases below.
 *   3. For each live row, try its own name and aliases against that index.
 *      Unmatched live rows fall through unchanged (they still show up in the
 *      regions table).
 *
 * The aliases exist because a region can be known by more than one true name
 * and the two sides need not pick the same one. New York City's map labels its
 * regions the way a New Yorker says them — "Brooklyn (Kings)", "The Bronx" —
 * while a feed reports the county, "Kings". Exact-name matching found one
 * borough out of five, and the one it found was Queens, whose two names happen
 * to be the same word. Four boroughs went colourless with their votes filed
 * under a regionAttr the map had never heard of.
 */
export function remapLiveRegionsToSeed(
	seed: StreamState['regions'],
	live: StreamState['regions']
): StreamState['regions'] {
	if (seed.length === 0 || live.length === 0) return live;
	const normalize = (s: string) =>
		s
			.toLowerCase()
			.replace(/\./g, '')
			.replace(/[^a-z0-9]+/g, '');

	/**
	 * Every spelling a region answers to, the full name first.
	 *
	 * A parenthetical is treated as a second name rather than as decoration,
	 * which is the convention the city maps already use, and it works in both
	 * directions: whichever of the two a feed reports, it lands on the same seed
	 * row. The article and the "County" suffix are dropped because they are
	 * noise that one side tends to carry and the other doesn't.
	 */
	const namesFor = (name: string): string[] => {
		const out: string[] = [];
		const add = (value: string) => {
			const key = normalize(value);
			if (key && !out.includes(key)) out.push(key);
		};
		add(name);
		const parenthetical = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
		if (parenthetical) {
			add(parenthetical[1]);
			add(parenthetical[2]);
		}
		add(name.replace(/^the\s+/i, ''));
		add(name.replace(/\s+county$/i, ''));
		return out;
	};

	// Primary names and aliases are kept apart so a full-name match always beats
	// an alias. Two regions in one state can share an alias — a "Baltimore" that
	// is the county and a "Baltimore City" that isn't — and in that case the one
	// that spelled it out should win rather than whichever was indexed last.
	const byName = new Map<string, StreamState['regions'][number]>();
	const byAlias = new Map<string, StreamState['regions'][number]>();
	for (const r of seed) {
		const [primary, ...aliases] = namesFor(r.name);
		if (primary && !byName.has(primary)) byName.set(primary, r);
		for (const alias of aliases) if (!byAlias.has(alias)) byAlias.set(alias, r);
	}

	const find = (name: string) => {
		const candidates = namesFor(name);
		for (const key of candidates) {
			const hit = byName.get(key);
			if (hit) return hit;
		}
		for (const key of candidates) {
			const hit = byAlias.get(key);
			if (hit) return hit;
		}
		return undefined;
	};

	return live.map((row) => {
		const match = find(row.name);
		if (!match) return row;
		// Preserve the seed's baked multi-year archival baseline when civicAPI
		// has nothing to say — the live row never carries archival data (it
		// came from a different dataset) so the remap is the only place to
		// re-attach it. Empty object from a live row means "nothing live to
		// merge"; in that case keep the seed's archival map verbatim.
		const liveHasArchival = Object.keys(row.archivalByYear ?? {}).length > 0;
		return {
			...row,
			regionAttr: match.regionAttr,
			totalReg: row.totalReg > 0 ? row.totalReg : match.totalReg,
			archivalByYear: liveHasArchival ? row.archivalByYear : (match.archivalByYear ?? {})
		};
	});
}
