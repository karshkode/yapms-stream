import { raceTier } from '../picker/raceImportance';
import type {
	DataSource,
	DataSourceKind,
	RaceListEntry,
	StreamStatePatch
} from './source';

/**
 * How a search/firehose call should bound its result window relative to
 * today. "upcoming" is the default — what the host is most likely to be
 * about to call live. "recent" surfaces past races so the host can
 * review or pull up Tuesday's results on Wednesday morning. "all" hands
 * back the union, sorted upcoming-first then most-recent past, which
 * mirrors how CNN/NYT election home pages stack their content.
 *
 * The "recent" window is bounded to RECENT_WINDOW_DAYS so the picker
 * doesn't dump months of finished cycles when the host probably just
 * wants the latest round.
 */
export type TimeRange = 'upcoming' | 'recent' | 'all';

const RECENT_WINDOW_DAYS = 90;

/**
 * civicAPI adapter — primary live feed.
 *
 * civicAPI (https://civicapi.org) is free, no API key, JSON + CSV, aggregated
 * from state SoS offices and local media. Commercial use OK with attribution.
 *
 * Endpoints (v2):
 *   GET /status                    — health check
 *   GET /race/search?query=<q>     — { count, offset, limit, races: [...] }
 *   GET /race/<id>                 — single race with region_results map
 *
 * Coverage caveat: civicAPI is strong on statewide/federal races; gappy on
 * small-local. Manual (`manual.ts`) is the always-available fallback.
 *
 * Rate limits: default poll every 30s, back off to 60s on failure.
 */

const DEFAULT_BASE = 'https://civicapi.org/api/v2';

/**
 * Per-request hard deadline. civicAPI is generally fast (~1-2s) but
 * occasionally a single probe stalls — without a timeout, the whole
 * `Promise.allSettled` fan-out hangs for the entire browser default
 * (~30s on Chromium), making the StateRacesCard / picker appear broken.
 *
 * Bumped from 8s -> 18s after observing province=KY&offset=100 routinely
 * landing in the 7-9s range on race nights (heavy primary day load).
 * The previous 8s ceiling was right on the edge — under any network
 * jitter the AbortController would fire on the in-flight request, and
 * because all three KY probes were similarly slow, the "all probes
 * rejected" guard would trip and surface "civicAPI unreachable" even
 * though civicAPI was just slow, not down. 18s is well above observed
 * p99 while still cutting off a genuinely-stuck connection in well
 * under the user's patience window.
 */
const FETCH_TIMEOUT_MS = 18_000;

/**
 * In-memory cache TTL for `/race/search` responses. Same URL re-fetched
 * within this window short-circuits to the cached response.
 *
 * Bumped from 60s → 10 min after the host asked for instant hop-back
 * between races in the same state. The search response is the LIST of
 * races (titles, dates, ids, district codes) — race-night vote tallies
 * are fetched separately via `/race/<id>` and have no caching. New
 * civicAPI races rarely appear mid-session, so a 10-minute search cache
 * is effectively free in terms of data freshness while making the
 * "← All <State> races" round trip feel like opening a tab in a
 * native app: zero spinner, no network, instant re-render.
 *
 * Hosts who run multi-hour broadcasts will eventually re-fetch as
 * entries time out; if they need fresher discovery sooner they can
 * brand-click home → reopen the state, which surfaces a fresh fetch
 * (different probe URLs miss the cache when the host changes the
 * timeRange tab from Upcoming → All).
 */
const CACHE_TTL_MS = 600_000;

/**
 * Fetch JSON with a hard deadline. Wraps `fetch` with `AbortController`
 * + `setTimeout` so a single hung request can't stall the calling
 * `Promise.allSettled`. Throws a typed `TimeoutError` on expiry so the
 * caller can distinguish from a 5xx without parsing message strings.
 */
class TimeoutError extends Error {
	constructor(url: string) {
		super(`civicAPI timeout: ${url}`);
		this.name = 'TimeoutError';
	}
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: { accept: 'application/json' },
			signal: ctl.signal
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()) as T;
	} catch (err) {
		if ((err as Error).name === 'AbortError') throw new TimeoutError(url);
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

export interface CivicApiOptions {
	baseUrl?: string;
}

/**
 * Per-call options for the streaming / cache-bypassing flavor of
 * `searchRacesByState`. Both fields are optional — omitting them
 * preserves the original "await once, get the full list, hit cache"
 * behavior so existing call sites stay simple.
 *
 * - `onPartial`: invoked each time a probe lands, with the merged-and-
 *   sorted entry list seen so far. The UI uses this to render the first
 *   batch of races within ~2-3s instead of waiting for the slowest probe.
 * - `force`: when true, bypass the in-memory TTL cache and re-issue the
 *   network calls. Wired up to the on-screen Refresh buttons so the host
 *   can pull fresh data without waiting for the 10-min cache expiry.
 */
export interface SearchByStateOptions {
	onPartial?: (entries: RaceListEntry[]) => void;
	force?: boolean;
}

export class CivicApiSource implements DataSource {
	kind: DataSourceKind = 'civicapi';
	private baseUrl: string;

	/**
	 * URL → races array TTL cache. Lives on the instance (not module-
	 * global) so test setups that swap in a custom baseUrl get a clean
	 * cache. Eviction is implicit: stale entries are checked on read and
	 * overwritten on miss; we never actively prune because the working
	 * set is bounded (~50 search URLs even for an aggressive host).
	 */
	private searchCache = new Map<string, { at: number; data: CivicApiSearchRace[] }>();

	constructor(opts: CivicApiOptions = {}) {
		this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
	}

	/**
	 * Cached, timeout-bounded fetch of a `/race/search` URL. All probe
	 * fan-outs in this module funnel through here so caching, dedup, and
	 * timeout behavior are uniform.
	 *
	 * Pass `force: true` to bypass the TTL check and re-issue the network
	 * call (used by the on-screen Refresh buttons so the host can pull
	 * fresh data without waiting for the 10-min cache expiry).
	 */
	private async fetchRaces(url: string, force = false): Promise<CivicApiSearchRace[]> {
		const now = Date.now();
		if (!force) {
			const hit = this.searchCache.get(url);
			if (hit && now - hit.at < CACHE_TTL_MS) return hit.data;
		}
		const data = await fetchJsonWithTimeout<{ races?: CivicApiSearchRace[] }>(url);
		const races = data.races ?? [];
		this.searchCache.set(url, { at: now, data: races });
		return races;
	}

	/**
	 * Drop every cached search probe whose URL contains the given substring.
	 * Used by the StateRacesCard's Refresh button to invalidate just one
	 * state's probes (`province=KY`) instead of nuking the whole cache —
	 * other states' results stay snappy.
	 */
	invalidateCacheByMatch(substring: string): void {
		for (const key of this.searchCache.keys()) {
			if (key.includes(substring)) this.searchCache.delete(key);
		}
	}

	/**
	 * State-scoped discovery — used by `StateRacesCard` when the host clicks
	 * a state on the Browse US map.
	 *
	 * Why a separate method instead of `searchRaces(stateName)`?
	 *
	 * civicAPI's `/race/search?query=<q>` does a substring match on
	 * `election_name`. For "Colorado" that returns:
	 *   - "Colorado Governor 2026"            (CO ✓)
	 *   - "Colorado County Sheriff" (TX!)    (CO ✗ — Columbus, TX)
	 *   - "Oregon, IN Town Council"            (when querying "Oregon")
	 *   - "Wyoming, OH Mayor"                   (when querying "Wyoming")
	 * Filtering down to `province === <abbr>` cuts the imposters but also
	 * leaves the list near-empty when civicAPI doesn't currently have many
	 * upcoming statewide races for that state (e.g. Colorado in early May,
	 * before the June primary onboarding).
	 *
	 * The fix: fan out across `province=<abbr>` queries, mirroring the
	 * national firehose. civicAPI accepts `province=` alongside the other
	 * filter params; combined with `election_type` we get a tight,
	 * comprehensive list of upcoming races for the state without dragging
	 * in cross-state title-token collisions. Falls back to the name-based
	 * query for races where civicAPI omitted the province stamp.
	 */
	async searchRacesByState(
		stateAbbr: string,
		stateName: string,
		timeRange: TimeRange = 'upcoming',
		options: SearchByStateOptions = {}
	): Promise<RaceListEntry[]> {
		const upperAbbr = stateAbbr.toUpperCase();
		// Use local-timezone today, not UTC. See `localTodayIso` for the
		// off-by-one rationale (host on Mountain time at 6 PM is already
		// "tomorrow" in UTC, which would push KY May 19 primaries into
		// "Recent" instead of "Upcoming").
		const todayIso = localTodayIso();
		const recentCutoffIso = isoDaysAgo(RECENT_WINDOW_DAYS);
		const base = `${this.baseUrl}/race/search`;

		// civicAPI returns races in id-DESC (newest-onboarded first). Empirically
		// (CLI-tested 2026-05-05): TX offsets 0-100 are all Nov 2026 generals,
		// 200+ is where the May 2 primaries live; smaller states like CO have
		// past races bleeding into offset 0 because they have fewer total rows.
		//
		// Offset selection per range:
		//   - upcoming: 0+100 covers the active pipeline for any state
		//   - recent / all: dig down to 400 to surface the May 2 / Apr 28
		//     past races that the slim probe misses
		// Caching (10min TTL) means switching between ranges on the same state
		// only fetches the previously-uncovered offsets; the upcoming probes
		// already in cache short-circuit.
		const offsets =
			timeRange === 'upcoming' ? [0, 100] : [0, 100, 200, 300, 400];
		// PERF: the old name=<stateName> probe is filtered out by our strict
		// `province === upperAbbr` check anyway (civicAPI's name-search rows
		// either carry the right province — duplicating the province probes —
		// or no province at all, which we drop). Dropping it cuts 1 of 3
		// probes for upcoming, shaving ~7-9s on the slowest case where that
		// probe was the long pole. Recent/all keeps the deeper offset probes.
		const probes = offsets.map(
			(o) => `${base}?country=US&province=${upperAbbr}&limit=100&offset=${o}`
		);

		// Streaming aggregator: each probe writes into `byId` as it resolves,
		// then we re-emit the current filtered+sorted view via `onPartial`.
		// Lets the UI render the first 100 races within ~2-3s instead of
		// waiting for all probes (worst-case ~9s). The final return preserves
		// existing call-site semantics (await once, get the full list).
		const byId = new Map<number, CivicApiSearchRace>();
		const force = options.force === true;
		const onPartial = options.onPartial;
		const settled: PromiseSettledResult<CivicApiSearchRace[]>[] = new Array(
			probes.length
		);

		const emit = () => {
			if (!onPartial) return;
			const partial = filterAndSortByState(
				byId,
				upperAbbr,
				timeRange,
				todayIso,
				recentCutoffIso
			);
			onPartial(partial);
		};

		await Promise.all(
			probes.map(async (url, idx) => {
				try {
					const races = await this.fetchRaces(url, force);
					settled[idx] = { status: 'fulfilled', value: races };
					for (const r of races) byId.set(r.id, r);
					emit();
				} catch (err) {
					settled[idx] = { status: 'rejected', reason: err };
				}
			})
		);

		// If every probe failed (timeouts, 5xx, network), surface that to
		// the caller so the UI can show a clear "civicAPI unreachable"
		// hint instead of a misleading "no races for this state".
		const allFailed = settled.every((r) => r?.status === 'rejected');
		if (allFailed) {
			const reasons = settled
				.map((r) => (r?.status === 'rejected' ? (r.reason as Error).message : ''))
				.filter(Boolean)
				.join('; ');
			throw new Error(`civicAPI state probes all failed: ${reasons}`);
		}

		return filterAndSortByState(
			byId,
			upperAbbr,
			timeRange,
			todayIso,
			recentCutoffIso
		);
	}

	async searchRaces(query: string, timeRange: TimeRange = 'upcoming'): Promise<RaceListEntry[]> {
		// civicAPI's `/race/search` is a substring name matcher on
		// `election_name`. Critically, civicapi does NOT sort results by
		// `election_date` — it returns them in insertion (id) order, which
		// is effectively chronological-by-insert-cycle, not chronological-
		// by-election-date. So a naive `?query=texas` dumps the most-
		// recently-onboarded Nov 2026 general-election races first, burying
		// the May 2026 Dallas bond propositions that were added weeks ago.
		//
		// For the empty-query case (host just opened Ctrl+K) we run the
		// firehose fan-out. For a typed query we fetch the first page (or
		// pages, when timeRange asks for past races), then filter and sort
		// per the requested window so "richardson" with timeRange=recent
		// surfaces the May 2 Richardson Bond proposition results.
		const trimmed = query.trim();
		if (!trimmed) return this.fetchFirehose(timeRange);

		const todayIso = localTodayIso();
		const recentCutoffIso = isoDaysAgo(RECENT_WINDOW_DAYS);
		// For typed queries, always fetch the first page; only paginate
		// deeper when the host asked for past races. Most query terms
		// only return ~10-30 hits anyway, so a single page is plenty.
		const offsets = timeRange === 'upcoming' ? [0] : [0, 100, 200];
		const urls = offsets.map(
			(o) =>
				`${this.baseUrl}/race/search?query=${encodeURIComponent(
					trimmed
				)}&limit=100&offset=${o}`
		);
		const results = await Promise.allSettled(urls.map((u) => this.fetchRaces(u)));
		const byId = new Map<number, CivicApiSearchRace>();
		for (const r of results) {
			if (r.status !== 'fulfilled') continue;
			for (const race of r.value) byId.set(race.id, race);
		}
		const filtered: RaceListEntry[] = [];
		for (const race of byId.values()) {
			const dateStr = race.election_date?.slice(0, 10);
			if (!inTimeRange(dateStr, timeRange, todayIso, recentCutoffIso)) continue;
			filtered.push(normalizeSearchEntry(race));
		}
		return sortByTimeRange(filtered, timeRange, todayIso);
	}

	/**
	 * Discovery query for the Ctrl+K default view.
	 *
	 * civicAPI's pagination is id-descending with NO date-based ordering, so
	 * the single most-recent-inserted page is effectively a "cycle" (e.g.
	 * "everything they loaded for the Nov 2026 general last week"). The May
	 * 2 Dallas bonds and May 5 Indiana primaries live 500-2000 entries deep
	 * in their respective id blocks because they were loaded in a different
	 * onboarding batch.
	 *
	 * To actually surface TODAY-forward races without pulling tens of
	 * thousands of rows, we fan out across:
	 *   1. `election_type=Primary` (newest inserts are 2026 May primaries).
	 *   2. `election_type=General` (2026 Nov general).
	 *   3. `election_type=Statewide` (governorships / AG / comptroller).
	 *   4. `election_type=Local` at multiple offsets (Nov 2026 Locals live
	 *      in offsets 0-400, May 2 2026 municipal bonds live ~500-800 deep).
	 * Each probe pulls 100 races in parallel, we merge+dedupe by id,
	 * filter to today-or-later, and sort ascending by election_date so the
	 * soonest election lands on top.
	 */
	private async fetchFirehose(timeRange: TimeRange = 'upcoming'): Promise<RaceListEntry[]> {
		const todayIso = localTodayIso();
		const recentCutoffIso = isoDaysAgo(RECENT_WINDOW_DAYS);
		const base = `${this.baseUrl}/race/search`;
		// Probe set scales with the requested range. Upcoming uses 5 URLs
		// (fits HTTP/1.1's 6-conn-per-host budget in a single batch).
		// Recent / all add a deeper offset for each type to surface
		// past-week races; cached probes from the upcoming view are
		// re-used so flipping the toggle doesn't refetch what we already
		// have.
		const urls =
			timeRange === 'upcoming'
				? [
						`${base}?country=US&election_type=Primary&limit=100`,
						`${base}?country=US&election_type=Local&limit=100`,
						`${base}?country=US&election_type=Local&limit=100&offset=400`,
						`${base}?country=US&election_type=Statewide&limit=100`,
						`${base}?country=US&election_type=General&limit=100`
					]
				: [
						`${base}?country=US&election_type=Primary&limit=100`,
						`${base}?country=US&election_type=Primary&limit=100&offset=100`,
						`${base}?country=US&election_type=Local&limit=100`,
						`${base}?country=US&election_type=Local&limit=100&offset=200`,
						`${base}?country=US&election_type=Local&limit=100&offset=400`,
						`${base}?country=US&election_type=Statewide&limit=100`,
						`${base}?country=US&election_type=General&limit=100`
					];
		const results = await Promise.allSettled(urls.map((u) => this.fetchRaces(u)));

		const byId = new Map<number, CivicApiSearchRace>();
		for (const r of results) {
			if (r.status !== 'fulfilled') continue;
			for (const race of r.value) {
				if (!race.election_date) continue;
				const dateStr = race.election_date.slice(0, 10);
				if (!inTimeRange(dateStr, timeRange, todayIso, recentCutoffIso)) continue;
				byId.set(race.id, race);
			}
		}
		// Cap the list so the picker doesn't render 400+ rows — beyond the
		// first ~60 the host is better served by typing a query anyway.
		const all = sortByTimeRange(
			Array.from(byId.values()).map(normalizeSearchEntry),
			timeRange,
			todayIso
		);
		return all.slice(0, 60);
	}

	async fetchRace(raceId: string): Promise<StreamStatePatch> {
		const url = `${this.baseUrl}/race/${encodeURIComponent(raceId)}`;
		const res = await fetch(url, { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`civicAPI fetch ${res.status}`);
		const data = (await res.json()) as CivicApiRaceDetail;
		return normalizeRaceToPatch(data);
	}

	async *pollRace(raceId: string, intervalMs: number): AsyncIterable<StreamStatePatch> {
		let delay = intervalMs;
		// Emit an immediate fetch on subscription so the UI populates without
		// waiting a full interval.
		while (true) {
			try {
				yield await this.fetchRace(raceId);
				delay = intervalMs;
			} catch (err) {
				console.warn('civicAPI poll error, backing off:', err);
				delay = Math.min(intervalMs * 2, 120_000);
			}
			await sleep(delay);
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render a civicAPI `election_date` ("2026-05-12T05:00:00.000Z") as a
 * human-readable calendar date. We intentionally slice off the YYYY-MM-DD
 * portion and construct a *local-time* Date instead of letting `new Date`
 * parse the full ISO timestamp. civicAPI stores election dates as midnight-
 * UTC-ish stamps (their May 12 race is "2026-05-12T05:00:00.000Z"), and
 * `new Date(...).toLocaleDateString()` would shift that backwards by a
 * calendar day for any user west of UTC — e.g. the May 12 election would
 * read "May 11, 2026" in Mountain time. The picker and StateRacesCard
 * already handle this correctly via the same slice-and-construct pattern.
 */
function formatElectionDate(iso: string): string {
	const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
	if (!y || !m || !d) return '';
	return new Date(y, m - 1, d).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

/**
 * Strict-province + time-range filter, shared by the streaming and final
 * paths in `searchRacesByState`. Drops anything whose `province` doesn't
 * match the requested abbr (so "Colorado County, TX" never sneaks into
 * Colorado), then applies the time-range and stable-sorts the result.
 */
function filterAndSortByState(
	byId: Map<number, CivicApiSearchRace>,
	upperAbbr: string,
	timeRange: TimeRange,
	todayIso: string,
	recentCutoffIso: string
): RaceListEntry[] {
	const filtered: RaceListEntry[] = [];
	for (const race of byId.values()) {
		const province = race.province?.toUpperCase();
		if (province !== upperAbbr) continue;
		const dateStr = race.election_date?.slice(0, 10);
		if (!inTimeRange(dateStr, timeRange, todayIso, recentCutoffIso)) continue;
		filtered.push(normalizeSearchEntry(race));
	}
	return sortByTimeRange(filtered, timeRange, todayIso);
}

/**
 * Local-timezone YYYY-MM-DD for *today*. Critically NOT
 * `new Date().toISOString().slice(0, 10)` — that's UTC, and at
 * ~6 PM in the Mountain timezone (and similarly anywhere west of GMT
 * after ~6 PM local) UTC has already rolled over to the next calendar
 * day. A Kentucky race dated `2026-05-19` is "today" for the host on
 * May 19 evening, but `toISOString` would report today as `2026-05-20`
 * and the inTimeRange filter would tag the race as "recent" (past).
 * Slicing local Y-M-D matches the host's calendar perception, which is
 * what the Upcoming/Recent toggle needs to reflect.
 */
function localTodayIso(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * ISO YYYY-MM-DD for `n` days before today (in the host's local
 * timezone). Used as the lower bound for the "recent" time-range filter.
 * Mirrors `localTodayIso` to keep the cutoff aligned with the host's
 * calendar perception of "the past 90 days".
 */
function isoDaysAgo(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() - days);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * Decide whether a race's election date (YYYY-MM-DD) falls inside the
 * requested time range. Races with no date are treated as "upcoming"-
 * eligible (civicAPI sometimes onboards races before pinning the date)
 * and excluded from "recent" since they could be either past or future.
 */
function inTimeRange(
	dateStr: string | undefined,
	range: TimeRange,
	todayIso: string,
	recentCutoffIso: string
): boolean {
	if (range === 'all') return true;
	if (!dateStr) return range === 'upcoming';
	if (range === 'upcoming') return dateStr >= todayIso;
	// 'recent': strictly past, but no older than the recent-window cutoff.
	return dateStr < todayIso && dateStr >= recentCutoffIso;
}

/**
 * Sort an entry list per the visible time range, with broadcast-importance
 * as a secondary key so headline races (Senate, Governor) float above
 * the long tail of Town Council / school board races even when they share
 * a date.
 *
 * Sort order:
 *   - upcoming: date asc, then tier asc
 *   - recent:   date desc, then tier asc
 *   - all:      upcoming first (date asc), then past (date desc),
 *               each segment tier-sorted within
 *
 * Tier is the strict secondary, not the primary, because date is the
 * news anchor's mental model: "what's tomorrow / what was yesterday"
 * comes first, then within that day, the host wants Senate before
 * Town Council. Promoting tier above date would put a Nov 2026 Senate
 * race above a Tuesday primary — wrong for live coverage.
 */
function sortByTimeRange(
	entries: RaceListEntry[],
	range: TimeRange,
	todayIso: string
): RaceListEntry[] {
	if (range === 'upcoming') return sortByDateThenTier(entries, 'asc');
	if (range === 'recent') return sortByDateThenTier(entries, 'desc');
	const upcoming: RaceListEntry[] = [];
	const past: RaceListEntry[] = [];
	for (const e of entries) {
		if (!e.date || e.date >= todayIso) upcoming.push(e);
		else past.push(e);
	}
	return [
		...sortByDateThenTier(upcoming, 'asc'),
		...sortByDateThenTier(past, 'desc')
	];
}

function sortByDateThenTier(
	entries: RaceListEntry[],
	dateDir: 'asc' | 'desc'
): RaceListEntry[] {
	return [...entries].sort((a, b) => {
		// Missing-date entries to the bottom regardless of direction.
		if (!a.date && !b.date) return raceTier(a.title) - raceTier(b.title);
		if (!a.date) return 1;
		if (!b.date) return -1;
		const dateCmp =
			dateDir === 'asc'
				? a.date.localeCompare(b.date)
				: b.date.localeCompare(a.date);
		if (dateCmp !== 0) return dateCmp;
		return raceTier(a.title) - raceTier(b.title);
	});
}

/**
 * Race shape as returned by `/race/search`. `id` is a number, not a string,
 * so we stringify on normalize.
 */
interface CivicApiSearchRace {
	id: number;
	type?: string;
	country?: string;
	province?: string;
	district?: string | null;
	municipality?: string | null;
	election_name: string;
	election_type?: string;
	election_date?: string;
	has_breakdown?: boolean;
	has_map?: boolean;
	percent_reporting?: number;
	candidates?: CivicApiCandidate[];
}

/** Race shape as returned by `/race/<id>` — richer than the search entry. */
interface CivicApiRaceDetail {
	election_name: string;
	election_type?: string;
	election_scope?: string;
	election_date?: string;
	country?: string;
	province?: string;
	district?: string | null;
	municipality?: string | null;
	polls_open?: string;
	polls_close?: string;
	is_disputed?: boolean;
	has_map?: boolean;
	registered_voters?: number | null;
	percent_reporting?: number;
	last_updated?: string;
	round?: number;
	maps?: Array<{ name: string; map: string }>;
	candidates?: CivicApiCandidate[];
	region_results?: Record<string, CivicApiRegionResult>;
}

interface CivicApiCandidate {
	name: string;
	party?: string;
	color?: string;
	votes?: number;
	percent?: number;
	winner?: boolean;
	incumbent?: boolean;
	major_candidate?: boolean;
}

interface CivicApiRegionResult {
	name: string;
	type?: string;
	fill?: string;
	percent_reporting?: number;
	registered_voters?: number;
	candidates?: CivicApiCandidate[];
}

function normalizeSearchEntry(r: CivicApiSearchRace): RaceListEntry {
	return {
		id: String(r.id),
		title: r.election_name,
		date: r.election_date ? r.election_date.slice(0, 10) : '',
		state: r.province ?? null,
		candidateCount: r.candidates?.length ?? null,
		reportingStatus: mapReportingStatus(r.percent_reporting),
		district: r.district ?? null,
		municipality: r.municipality ?? null
	};
}

function mapReportingStatus(pct: number | undefined): 'Pre' | 'Live' | 'Final' | null {
	if (pct == null) return null;
	if (pct <= 0) return 'Pre';
	if (pct >= 99.5) return 'Final';
	return 'Live';
}

function normalizeRaceToPatch(r: CivicApiRaceDetail): StreamStatePatch {
	// Each candidate gets a stable id derived from name so leader lookups in
	// region_results line up without us having to remap per-region.
	const candIdFromName = (name: string) =>
		`civ-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

	const candidates = (r.candidates ?? []).map((c) => ({
		id: candIdFromName(c.name),
		name: c.name,
		partyLabel: c.party ?? '',
		partyColor: c.color ?? defaultPartyColor(c.party),
		votes: c.votes ?? 0,
		called: c.winner ?? false,
		hidden: false,
		headshotUrl: null
	}));

	// region_results is keyed by an internal slug (e.g. "hot_spring", "st_francis").
	// The display name is on the value object.
	const regions = Object.entries(r.region_results ?? {}).map(([slug, region]) => {
		const leader = pickLeader(region.candidates ?? []);
		const votes = (region.candidates ?? []).reduce((a, c) => a + (c.votes ?? 0), 0);
		// Preserve the full per-candidate split so RegionDetailCard can
		// render every candidate's vote total for this region, not just
		// the leader. Keyed by the same stable name-derived id used for
		// the global candidates list so the card's cross-reference join
		// is a trivial dict lookup.
		const candidateVotes: Record<string, number> = {};
		for (const c of region.candidates ?? []) {
			candidateVotes[candIdFromName(c.name)] = c.votes ?? 0;
		}
		return {
			// regionAttr targets the yapms SVG's `region` attribute, which is
			// "<ShortName><stateFips>" — unfortunately civicAPI uses lowercase
			// underscore slugs. We fall back to the slug and a merge pass on the
			// overlay side pairs civicAPI data with seed counties by fuzzy name.
			name: region.name,
			regionAttr: slug,
			leaderId: leader ? candIdFromName(leader.name) : null,
			votes,
			evr: 0,
			reportedPct: region.percent_reporting ?? 0,
			totalReg: region.registered_voters ?? 0,
			candidateVotes,
			// civicAPI doesn't carry archival data. source.ts's merge layer
			// preserves the seeded archivalByYear when the live row has an
			// empty object — this avoids clobbering 20 years of history with
			// a single-year live push.
			archivalByYear: {}
		};
	});

	const totalVotes = candidates.reduce((a, c) => a + c.votes, 0);

	return {
		race: {
			title: r.election_name,
			reportedPct: r.percent_reporting ?? null,
			reportedPctLabel:
				r.percent_reporting != null
					? `${r.percent_reporting >= 95 ? '>95' : r.percent_reporting.toFixed(1)}%`
					: null,
			totalVotes: totalVotes > 0 ? totalVotes : null,
			pollsCloseLabel: r.polls_close
				? `Polls close ${new Date(r.polls_close).toLocaleTimeString('en-US', {
						hour: 'numeric',
						minute: '2-digit',
						timeZoneName: 'short'
					})}`
				: '',
			dateLabel: r.election_date ? formatElectionDate(r.election_date) : ''
		},
		candidates,
		regions,
		performance: []
	};
}

function pickLeader(cands: CivicApiCandidate[]): CivicApiCandidate | null {
	if (cands.length === 0) return null;
	let best = cands[0];
	for (const c of cands) {
		if ((c.votes ?? 0) > (best.votes ?? 0)) best = c;
	}
	return (best.votes ?? 0) > 0 ? best : null;
}

function defaultPartyColor(party: string | undefined): string {
	switch ((party ?? '').toLowerCase()) {
		case 'd':
		case 'dem':
		case 'democratic':
			return '#1b6cb0';
		case 'r':
		case 'rep':
		case 'republican':
			return '#bf1d29';
		case 'i':
		case 'ind':
		case 'independent':
			return '#6b7280';
		case 'l':
		case 'lib':
		case 'libertarian':
			return '#facc15';
		case 'g':
		case 'grn':
		case 'green':
			return '#16a34a';
		default:
			return '#6b7280';
	}
}

export const civicApi = new CivicApiSource();
