import type { StreamState } from '../stream-state';

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
	const keys = new Set<string>([...seedByAttr.keys(), ...liveByAttr.keys(), ...manualByAttr.keys()]);

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
		merged.sort(
			(a, b) => (order.get(a.regionAttr) ?? 9999) - (order.get(b.regionAttr) ?? 9999)
		);
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
 * Remap live region rows onto the seeded regionAttrs by fuzzy-matching name.
 *
 * civicAPI identifies regions by lowercase-snakecase slug (e.g. "hot_spring"),
 * while the yapms SVG uses concatenated-name-plus-FIPS (e.g. "Hot Spring05").
 * Without this, live votes land under a regionAttr the SVG doesn't know about
 * and counties never change color.
 *
 * Strategy:
 *   1. Normalize both sides (lowercase, strip non-alphanum).
 *   2. Index seed regions by normalized name.
 *   3. For each live row, swap its regionAttr to the seed's attr when the
 *      normalized names match. Unmatched live rows fall through unchanged
 *      (they still show up in the regions table).
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
	const seedByName = new Map<string, StreamState['regions'][number]>();
	for (const r of seed) seedByName.set(normalize(r.name), r);

	return live.map((row) => {
		const match = seedByName.get(normalize(row.name));
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
