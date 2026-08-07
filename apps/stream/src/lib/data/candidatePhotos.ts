/**
 * Candidate headshot lookup, backed by Wikipedia's page-image API.
 *
 * Why Wikipedia and not Ballotpedia / VoteSmart / FEC?
 *   - Ballotpedia's API needs a paid key (see ballotpedia.ts, still stubbed).
 *   - OpenFEC and civicAPI carry no images at all — civicAPI normalizes every
 *     candidate to `headshotUrl: null`.
 *   - Wikipedia's Action API is free, keyless, sends `Access-Control-Allow-
 *     Origin: *` so the browser can call it directly with no proxy, and the
 *     portraits are Commons-licensed (reusable on a broadcast with credit).
 *   - Coverage is strongest exactly where a broadcast needs it: statewide and
 *     federal candidates. Down-ballot locals usually have no page, so the
 *     lookup returns null and the UI keeps its initial-letter placeholder.
 *
 * The hard part isn't fetching, it's *not* picking the wrong image. A search
 * for "Brian Kemp Georgia governor" ranks the 2026 election article first
 * (whose page image is the state seal) and the candidate's spouse third. So
 * every candidate result is scored: the title has to be name-compatible, the
 * page has to look like a person, and seal/flag/map images are rejected
 * outright. See `scoreCandidatePage`.
 */

const API = 'https://en.wikipedia.org/w/api.php';

/** How many search hits to score per candidate. Past ~5 the hits are noise. */
const SEARCH_LIMIT = 5;

/** Thumbnail width requested from the API. 320px covers the largest place we
 *  paint a headshot (the broadcast dock at ~2x DPR) without pulling full
 *  multi-megabyte Commons originals over a race-night connection. */
const THUMB_PX = 320;

const FETCH_TIMEOUT_MS = 12_000;

const CACHE_KEY = 'yapms-stream:headshots';
/** Successful hits are effectively permanent — a politician's portrait does
 *  not churn. Re-check monthly so a better crop eventually wins. */
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Misses expire faster: a new candidate's page often appears mid-cycle, and
 *  we don't want a lookup during the primary to poison election night. */
const MISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Bound the cache so it can't creep up on localStorage's ~5MB budget after
 *  a season of browsing. Entries are ~120 bytes, so this is well under 100KB. */
const CACHE_MAX_ENTRIES = 600;

export interface HeadshotHit {
	/** Commons thumbnail URL, safe to drop straight into an `<img src>`. */
	url: string;
	/** Wikipedia article the image came from — shown as the credit / source. */
	pageTitle: string;
	/** Wikidata short description ("Governor of Georgia since 2019"), if any. */
	description: string | null;
}

/**
 * Extra signal used to disambiguate common names. Both fields are folded into
 * the search query only — never used as a hard filter, because civicAPI's
 * `province` / race title wording rarely matches Wikipedia's phrasing.
 */
export interface HeadshotContext {
	/** State name or postal abbr, e.g. "Georgia" or "GA". */
	state?: string | null;
	/** Office wording from the race title, e.g. "Governor", "US Senate". */
	office?: string | null;
}

interface CacheEntry {
	at: number;
	hit: HeadshotHit | null;
}

/** Process-lifetime memo in front of localStorage, so repeated renders and
 *  re-enrichment passes in one session never re-read/parse the JSON blob. */
const memo = new Map<string, CacheEntry>();

function readCache(): Record<string, CacheEntry> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
		return typeof parsed === 'object' && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

function writeCacheEntry(key: string, entry: CacheEntry): void {
	memo.set(key, entry);
	if (typeof localStorage === 'undefined') return;
	try {
		const all = readCache();
		all[key] = entry;
		const keys = Object.keys(all);
		if (keys.length > CACHE_MAX_ENTRIES) {
			// Oldest-first eviction. Cheap full sort is fine at this size and
			// only runs on the rare overflow write.
			keys
				.sort((a, b) => (all[a]?.at ?? 0) - (all[b]?.at ?? 0))
				.slice(0, keys.length - CACHE_MAX_ENTRIES)
				.forEach((k) => delete all[k]);
		}
		localStorage.setItem(CACHE_KEY, JSON.stringify(all));
	} catch {
		// Quota or private-mode failure: the memo still serves this session.
	}
}

function cacheKey(name: string, ctx: HeadshotContext): string {
	return [normalizeLoose(name), normalizeLoose(ctx.state ?? ''), normalizeLoose(ctx.office ?? '')]
		.join('|')
		.replace(/\|+$/, '');
}

function readFresh(key: string): CacheEntry | null {
	const entry = memo.get(key) ?? readCache()[key];
	if (!entry) return null;
	memo.set(key, entry);
	const ttl = entry.hit ? HIT_TTL_MS : MISS_TTL_MS;
	if (Date.now() - entry.at > ttl) return null;
	return entry;
}

/** Drop every cached lookup. Wired to the Broadcast panel's "clear photo cache"
 *  button so a host who sees a wrong face can force a re-resolve. */
export function clearHeadshotCache(): void {
	memo.clear();
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(CACHE_KEY);
	} catch {
		// Nothing actionable — the memo clear above already took effect.
	}
}

function normalizeLoose(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'md', 'phd', 'esq', 'dr']);

export interface ParsedName {
	first: string;
	last: string;
	/** All tokens except suffixes, in display order. */
	tokens: string[];
}

/**
 * Split a ballot-style name into first/last. Handles the shapes that actually
 * turn up in civicAPI and hand-typed rosters:
 *
 *   "Brian Kemp"                -> first brian, last kemp
 *   "KEMP, BRIAN"               -> first brian, last kemp   (comma-flipped)
 *   "Robert F. Kennedy Jr."     -> first robert, last kennedy (suffix dropped)
 *   "Bill \"Bubba\" Smith"      -> first bill,  last smith  (nickname dropped)
 *   "Maria Elvira Salazar (R)"  -> first maria, last salazar (party tag dropped)
 */
export function parseName(raw: string): ParsedName {
	let s = raw
		// Trailing party tags: "(R)", "- Republican", "[DEM]".
		.replace(/\s*[([{][^)\]}]*[)\]}]\s*$/g, ' ')
		.replace(/\s+[-–—]\s+\w+$/g, ' ')
		// Nicknames in quotes anywhere in the name.
		.replace(/["“”'‘’]([^"“”'‘’]{1,20})["“”'‘’]/g, ' ');

	if (s.includes(',')) {
		const [surname, rest] = s.split(',', 2);
		// Only treat the comma as a surname-first separator when what follows
		// is a given name rather than a suffix ("Kennedy, Jr.").
		const restTokens = normalizeLoose(rest ?? '')
			.split(' ')
			.filter(Boolean);
		if (restTokens.length > 0 && !NAME_SUFFIXES.has(restTokens[0])) {
			s = `${rest} ${surname}`;
		}
	}

	const tokens = normalizeLoose(s)
		.split(' ')
		.filter(Boolean)
		.filter((t) => !NAME_SUFFIXES.has(t));

	return {
		first: tokens[0] ?? '',
		last: tokens.length > 1 ? tokens[tokens.length - 1] : '',
		tokens
	};
}

/**
 * The surname in its original casing, for display. `parseName` lowercases
 * everything for matching, but a ticker wants "BESHEAR", not "beshear" put
 * through `toUpperCase()` — which would mangle "O'Rourke" and "McConnell" if we
 * ever showed mixed case. Falls back to the whole string for single-token
 * names so a placeholder row still renders something.
 */
export function surnameOf(raw: string): string {
	const cleaned = raw
		.replace(/\s*[([{][^)\]}]*[)\]}]\s*$/g, ' ')
		.replace(/["“”'‘’]([^"“”'‘’]{1,20})["“”'‘’]/g, ' ')
		.trim();
	const commaIdx = cleaned.indexOf(',');
	if (commaIdx > 0) {
		const surname = cleaned.slice(0, commaIdx).trim();
		const rest = normalizeLoose(cleaned.slice(commaIdx + 1))
			.split(' ')
			.filter(Boolean);
		// "Kennedy, Jr." is a suffix, not a surname-first listing.
		if (rest.length > 0 && !NAME_SUFFIXES.has(rest[0])) return surname;
	}
	const tokens = cleaned.split(/\s+/).filter((t) => !NAME_SUFFIXES.has(normalizeLoose(t)));
	return tokens.length > 1 ? tokens[tokens.length - 1] : cleaned;
}

/** True when two given names could be the same person: identical, one is an
 *  initial, or one is a prefix of the other ("Chris"/"Christopher"). Deliberately
 *  does NOT accept "same first letter" — that would happily match Jane Smith to
 *  John Smith. */
function firstNamesCompatible(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	if (a.length === 1 || b.length === 1) return a[0] === b[0];
	const [short, long] = a.length < b.length ? [a, b] : [b, a];
	return short.length >= 3 && long.startsWith(short);
}

/** Page images that are institutional art rather than a person. These are the
 *  page image for most election and office articles, and for candidates whose
 *  article has no free portrait. */
const NON_PORTRAIT_IMAGE =
	/seal|flag|coat[_-]?of[_-]?arms|logo|locator|_map|blank|placeholder|no[_-]image|replace[_-]this|ballot[_-]box|vote[_-]icon/i;

/** Titles that are about a contest or an office, not a human. */
const NON_PERSON_TITLE =
	/\belection\b|\bprimary\b|\bballot\b|\breferendum\b|\bproposition\b|^list of|\blegislature\b|\bgeneral assembly\b|\bhouse of representatives\b|\bsenate\b|^governor of|^mayor of|^attorney general of|\bdistrict\b|\bcaucus\b|\bparty\b/i;

/** Occupation words in the Wikidata short description that mark a page as a
 *  person we'd plausibly put on a results card. */
const PERSON_DESCRIPTION =
	/politician|senator|governor|representative|congress|mayor|judge|justice|attorney|lawyer|businessman|businesswoman|physician|activist|author|educator|sheriff|commissioner|treasurer|comptroller|auditor|nominee|candidate|american|member of/i;

interface WikiPage {
	pageid: number;
	title: string;
	index?: number;
	description?: string;
	thumbnail?: { source: string; width: number; height: number };
	categories?: { title: string }[];
}

interface WikiResponse {
	query?: { pages?: WikiPage[] };
}

/**
 * Score one search hit against the candidate we're looking for. Returns null
 * for a hard reject. Higher is better.
 *
 * The name test is the gate: a page only qualifies if its title's surname
 * matches and its given name is compatible (see `firstNamesCompatible`). That
 * single rule is what stops "Marty Kemp" (spouse, living person, has a
 * portrait, ranked above the real hit) from being chosen for "Brian Kemp".
 */
function scoreCandidatePage(page: WikiPage, want: ParsedName): number | null {
	const thumb = page.thumbnail?.source;
	if (!thumb) return null;
	if (NON_PORTRAIT_IMAGE.test(thumb)) return null;
	if (NON_PERSON_TITLE.test(page.title)) return null;
	// Disambiguation-style titles ("Doug Jones (politician)") are fine, so
	// compare on the bare name portion.
	const got = parseName(page.title.replace(/\s*\([^)]*\)\s*$/, ''));
	if (!got.last || got.last !== want.last) return null;
	if (!firstNamesCompatible(got.first, want.first)) return null;

	const isLivingPerson = (page.categories ?? []).some((c) => /Living people/i.test(c.title));
	const describedAsPerson = PERSON_DESCRIPTION.test(page.description ?? '');
	// One of the two person signals is required. Without this a page titled
	// like a person but describing something else (a ship, an award) could pass.
	if (!isLivingPerson && !describedAsPerson) return null;

	let score = 10;
	if (got.first === want.first) score += 4;
	// Middle names/initials lining up is strong evidence for common surnames.
	if (want.tokens.length > 2 && got.tokens.length > 2 && got.tokens[1] === want.tokens[1]) {
		score += 3;
	}
	if (isLivingPerson) score += 3;
	if (describedAsPerson) score += 2;
	// Prefer better-ranked search hits, but only as a tiebreak.
	score += Math.max(0, 3 - (page.index ?? 0));
	// Portrait-shaped images beat wide group shots.
	const t = page.thumbnail;
	if (t && t.height >= t.width) score += 2;
	return score;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimum spacing between calls to the Wikipedia API. Firing a roster of
 * candidates off in parallel earns an HTTP 429 within about ten requests
 * (observed while validating the scorer), and unlike our own civicAPI
 * budget this is somebody else's donated infrastructure. Every request in
 * the module funnels through `paced` so the spacing holds no matter how many
 * lookups the worker pool has in flight.
 */
const MIN_REQUEST_GAP_MS = 350;
let requestGate: Promise<void> = Promise.resolve();

/**
 * Set when the API throttles us past our retry budget. Until it passes,
 * lookups short-circuit to null instead of queueing more doomed requests —
 * otherwise the roster effect would re-run on the next poll tick and pile a
 * fresh batch onto an API that just told us to slow down.
 */
let throttledUntil = 0;
const THROTTLE_COOLDOWN_MS = 60_000;

/** True while the API has asked us to back off. The UI surfaces this so the
 *  host understands why "Find photos" came back empty. */
export function isThrottled(): boolean {
	return Date.now() < throttledUntil;
}

function paced<T>(run: () => Promise<T>): Promise<T> {
	const mine = requestGate.then(run);
	// Chain the next caller behind this request *plus* the gap, swallowing
	// failures so one rejected lookup doesn't poison the queue.
	requestGate = mine.then(
		() => sleep(MIN_REQUEST_GAP_MS),
		() => sleep(MIN_REQUEST_GAP_MS)
	);
	return mine;
}

/** Retries after a 429/503, honouring `Retry-After` when the API sends one. */
const RETRY_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 3;

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		const ctl = new AbortController();
		const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
		const onAbort = () => ctl.abort();
		signal?.addEventListener('abort', onAbort);
		try {
			const res = await paced(() =>
				fetch(url, { headers: { accept: 'application/json' }, signal: ctl.signal })
			);
			if (RETRY_STATUSES.has(res.status)) {
				if (attempt >= MAX_ATTEMPTS) {
					throttledUntil = Date.now() + THROTTLE_COOLDOWN_MS;
					throw new Error(`wikipedia HTTP ${res.status} (backing off)`);
				}
				const retryAfter = Number(res.headers.get('retry-after'));
				const waitMs =
					Number.isFinite(retryAfter) && retryAfter > 0
						? Math.min(retryAfter * 1000, 10_000)
						: 500 * 2 ** attempt;
				await sleep(waitMs);
				continue;
			}
			if (!res.ok) throw new Error(`wikipedia HTTP ${res.status}`);
			return (await res.json()) as T;
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
		}
	}
}

function buildQuery(name: string, ctx: HeadshotContext): string {
	// The office/state words don't have to appear in the article — Wikipedia's
	// search is a relevance ranking, so they act as hints that pull the right
	// "John Smith" up the list. `politician` is included for the same reason.
	const parts = [name, ctx.state ?? '', ctx.office ?? '', 'politician'].filter(Boolean);
	return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve one candidate name to a headshot. Returns null when nothing passes
 * the scoring gate — callers should treat that as "keep the placeholder", not
 * as an error. Cached (including the null result) so a re-run is free.
 */
export async function lookupHeadshot(
	name: string,
	ctx: HeadshotContext = {},
	signal?: AbortSignal
): Promise<HeadshotHit | null> {
	const trimmed = name.trim();
	if (!trimmed) return null;
	const want = parseName(trimmed);
	// A bare surname ("Smith") can't be disambiguated safely, and a single
	// token is usually a placeholder row like "Undecided" or "Write-in".
	if (!want.last) return null;

	const key = cacheKey(trimmed, ctx);
	const cached = readFresh(key);
	if (cached) return cached.hit;
	if (isThrottled()) return null;

	const params = new URLSearchParams({
		action: 'query',
		format: 'json',
		formatversion: '2',
		origin: '*',
		generator: 'search',
		gsrsearch: buildQuery(trimmed, ctx),
		gsrlimit: String(SEARCH_LIMIT),
		gsrnamespace: '0',
		prop: 'pageimages|description|categories',
		piprop: 'thumbnail',
		pithumbsize: String(THUMB_PX),
		clcategories: 'Category:Living people',
		cllimit: 'max'
	});

	// Assigned on the success path; the catch below returns, so there's no path
	// to the scoring loop with `pages` unset.
	let pages: WikiPage[];
	try {
		const data = await fetchJson<WikiResponse>(`${API}?${params.toString()}`, signal);
		pages = data.query?.pages ?? [];
	} catch (err) {
		// Network / abort: don't cache, so the next attempt can retry.
		if ((err as Error).name !== 'AbortError') {
			console.warn('headshot lookup failed for', trimmed, err);
		}
		return null;
	}

	let best: { hit: HeadshotHit; score: number } | null = null;
	for (const page of pages) {
		const score = scoreCandidatePage(page, want);
		const source = page.thumbnail?.source;
		if (score == null || !source) continue;
		if (best && score <= best.score) continue;
		best = {
			score,
			hit: {
				// Strip the analytics query Wikimedia appends (`?utm_source=...`);
				// the bare file URL caches better in OBS's browser source and is
				// what we want to persist.
				url: source.split('?')[0],
				pageTitle: page.title,
				description: page.description ?? null
			}
		};
	}

	const hit = best?.hit ?? null;

	writeCacheEntry(key, { at: Date.now(), hit });
	return hit;
}

export interface LookupManyOptions {
	/** Called as each name resolves, so the UI can fill photos in progressively. */
	onResolved?: (name: string, hit: HeadshotHit | null) => void;
	/**
	 * Worker-pool size. Requests are additionally spaced by
	 * `MIN_REQUEST_GAP_MS`, so this mostly controls how quickly *cached* names
	 * drain rather than how hard we hit the network.
	 */
	concurrency?: number;
	signal?: AbortSignal;
}

/**
 * Resolve a roster in parallel with a small worker pool. Names already in the
 * cache resolve without a network call, so calling this on every roster change
 * is cheap after the first pass.
 */
export async function lookupHeadshots(
	names: string[],
	ctx: HeadshotContext = {},
	options: LookupManyOptions = {}
): Promise<Map<string, HeadshotHit | null>> {
	const results = new Map<string, HeadshotHit | null>();
	const queue = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
	const workers = Math.max(1, Math.min(options.concurrency ?? 3, queue.length));

	await Promise.all(
		Array.from({ length: workers }, async () => {
			for (;;) {
				if (options.signal?.aborted) return;
				const name = queue.shift();
				if (!name) return;
				const hit = await lookupHeadshot(name, ctx, options.signal);
				results.set(name, hit);
				options.onResolved?.(name, hit);
			}
		})
	);

	return results;
}
