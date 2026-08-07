import { STATES, type StateMeta } from '../templates/states';

/**
 * Turns what a host types into something civicAPI can actually answer.
 *
 * civicAPI's `/race/search?query=` is a single substring match against
 * `election_name`. That works for one-word queries and falls apart on the way
 * people actually name a race. "nyc mayoral 2025" matches nothing: the literal
 * string never appears in a title, "NYC" isn't spelled out, "mayoral" isn't the
 * word civicAPI uses, and the year lives in `election_date` rather than the
 * name. The host is left staring at an empty list for a race sitting right
 * there in the feed.
 *
 * So the query gets pulled apart here and each piece is used where it actually
 * works:
 *
 * - A **year** becomes a date filter. It's never sent to civicAPI, because
 *   titles are inconsistent about carrying one.
 * - A **state** becomes a `province=` probe, a real server-side filter and far
 *   more reliable than hoping the state's name appears in the title.
 *   `searchRacesByState` already leans on this; typed queries can too.
 * - The **rest of the words** are matched locally against each row, so word
 *   order, filler words and civicAPI's own phrasing stop mattering.
 *
 * Everything here is pure, so it can be exercised without a network.
 */

/**
 * Words naming the office rather than the place. Held separately because the
 * two carry different confidence: the place is what the host is sure about,
 * while the office wording is a guess at civicAPI's vocabulary — the NYC
 * mayoral race may well be filed as "Municipal General". So a place word has
 * to match and an office word only scores.
 */
const OFFICE_WORDS = new Set([
	'president',
	'senate',
	'house',
	'congress',
	'representative',
	'governor',
	'mayor',
	'council',
	'alderman',
	'sheriff',
	'attorney',
	'general',
	'comptroller',
	'treasurer',
	'auditor',
	'secretary',
	'clerk',
	'judge',
	'justice',
	'court',
	'commissioner',
	'board',
	'trustee',
	'assembly',
	'delegate',
	'proposition',
	'amendment',
	'referendum',
	'measure',
	'initiative',
	'bond',
	'levy',
	'primary',
	'runoff',
	'recall',
	'election',
	'race',
	'seat',
	'district'
]);

/**
 * Geography words that describe a *kind* of place rather than a specific one.
 * "New York City Mayor" and "New York Mayor" are the same race as far as a host
 * is concerned, so requiring "city" to appear would hide the second spelling.
 * These score like office words instead of gating the match.
 */
const WEAK_PLACE_WORDS = new Set([
	'city',
	'county',
	'town',
	'township',
	'village',
	'borough',
	'parish',
	'ward',
	'precinct',
	'municipal',
	'municipality',
	'metro',
	'area'
]);

/** Query words with no selectivity, so "mayor of new york" == "new york mayor". */
const STOP_WORDS = new Set(['of', 'the', 'for', 'in', 'at', 'and', 'a', 'an', 'vs', 'v']);

/**
 * How people say it → how civicAPI spells it. Only nationally unambiguous
 * entries: `la` is left out because it collides with Louisiana's abbreviation,
 * and `dc` is already a `province` in its own right.
 */
const PLACE_ALIASES: Record<string, string[]> = {
	nyc: ['new', 'york', 'city'],
	philly: ['philadelphia'],
	vegas: ['las', 'vegas'],
	sf: ['san', 'francisco'],
	atl: ['atlanta'],
	nola: ['new', 'orleans']
};

/**
 * Wording variants collapsed onto the token civicAPI uses. Prefix matching
 * handles "mayors"-style endings by itself; these are the pairs sharing too
 * little of a stem for that to work.
 */
const OFFICE_SYNONYMS: Record<string, string> = {
	gubernatorial: 'governor',
	presidential: 'president',
	senatorial: 'senate',
	senator: 'senate',
	congressional: 'congress',
	mayoral: 'mayor'
};

/**
 * Two-letter state abbreviations that are also ordinary English words. Read as
 * a state only when the host typed nothing else, so "mayor in ohio" doesn't
 * become an Indiana race.
 */
const AMBIGUOUS_ABBRS = new Set(['in', 'or', 'me', 'hi', 'oh', 'ok', 'de', 'la', 'pa', 'id', 'ma']);

/** Longest state name first, so "west virginia" never reads as "virginia". */
const STATES_BY_NAME_LENGTH = [...STATES].sort(
	(a, b) => b.name.split(' ').length - a.name.split(' ').length
);

export interface ParsedRaceQuery {
	/** What the host typed, trimmed. */
	raw: string;
	/** Election year to filter on, or null when none was typed. */
	year: number | null;
	/** The state the query named, or null. */
	state: StateMeta | null;
	/** Words a row must match to be considered at all. */
	required: string[];
	/** Words that score and decide strict-vs-loose, but never exclude. */
	optional: string[];
	/** Substrings for civicAPI's name matcher, most selective first. */
	probes: string[];
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/**
 * Pull a state out of the token list. Multi-word names must match as a
 * contiguous run, or "new orleans mayor" would resolve to New Mexico.
 */
function extractState(tokens: string[]): { state: StateMeta | null; rest: string[] } {
	for (const state of STATES_BY_NAME_LENGTH) {
		const nameTokens = tokenize(state.name);
		for (let i = 0; i + nameTokens.length <= tokens.length; i++) {
			const slice = tokens.slice(i, i + nameTokens.length);
			if (slice.every((t, j) => t === nameTokens[j])) {
				return {
					state,
					rest: [...tokens.slice(0, i), ...tokens.slice(i + nameTokens.length)]
				};
			}
		}
	}
	for (const state of STATES) {
		const idx = tokens.indexOf(state.abbrLower);
		if (idx === -1) continue;
		if (AMBIGUOUS_ABBRS.has(state.abbrLower) && tokens.length > 1) continue;
		return { state, rest: [...tokens.slice(0, idx), ...tokens.slice(idx + 1)] };
	}
	return { state: null, rest: tokens };
}

/**
 * The shared spelling of a query: aliases expanded, office wording collapsed,
 * filler and any year dropped. The template index runs on this too, so
 * "nyc mayoral" reaches the same templates that "new york city mayor" does
 * instead of matching nothing.
 */
export function normalizeQueryTokens(raw: string): string[] {
	const tokens: string[] = [];
	let sawYear = false;
	for (const token of tokenize(raw)) {
		if (!sawYear && /^(?:19|20)\d{2}$/.test(token)) {
			sawYear = true;
			continue;
		}
		tokens.push(token);
	}
	const expanded = tokens
		.flatMap((t) => PLACE_ALIASES[t] ?? [t])
		.map((t) => OFFICE_SYNONYMS[t] ?? t);
	// Keep a lone stop word — "in" on its own is the host reaching for Indiana.
	return expanded.length > 1 ? expanded.filter((t) => !STOP_WORDS.has(t)) : expanded;
}

/** The year a query names, or null. */
export function queryYear(raw: string): number | null {
	for (const token of tokenize(raw)) {
		if (/^(?:19|20)\d{2}$/.test(token)) return Number(token);
	}
	return null;
}

export function parseRaceQuery(raw: string): ParsedRaceQuery {
	const trimmed = raw.trim();
	const year = queryYear(trimmed);
	const clean = normalizeQueryTokens(trimmed);
	const { state, rest } = extractState(clean);

	const required: string[] = [];
	const optional: string[] = [];
	for (const token of rest) {
		if (OFFICE_WORDS.has(token) || WEAK_PLACE_WORDS.has(token)) optional.push(token);
		else required.push(token);
	}

	return {
		raw: trimmed,
		year,
		state,
		required,
		optional,
		probes: buildProbes(clean)
	};
}

/**
 * Substrings worth asking civicAPI's name matcher for, most selective first
 * and capped to keep a typed query inside the request budget the rest of this
 * module works to.
 *
 * The full phrase goes first because civicAPI's matcher is genuinely good at
 * the one thing it does, and "new york city mayor" hits "New York City Mayor"
 * dead on. Dropping the office words is the second attempt, since
 * "new york city" also finds the race when civicAPI filed it as a municipal
 * general. A bare office word would return thousands of rows nationwide, so it
 * only appears when the host typed nothing else to narrow by.
 */
function buildProbes(clean: string[]): string[] {
	const probes: string[] = [];
	const add = (parts: string[]) => {
		const value = parts.join(' ').trim();
		if (value && !probes.includes(value)) probes.push(value);
	};

	add(clean);
	add(clean.filter((t) => !OFFICE_WORDS.has(t)));
	add(clean.filter((t) => !OFFICE_WORDS.has(t) && !WEAK_PLACE_WORDS.has(t)));

	return probes.slice(0, 3);
}

/** The fields of a row a query token may match against. */
export interface RaceQueryRow {
	title: string;
	state?: string | null;
	district?: string | null;
	municipality?: string | null;
	date?: string;
}

/**
 * Bidirectional prefix match, which is what lets "mayoral" find "Mayor" and
 * "philadelph" find "Philadelphia" without a real stemmer. Only for tokens of
 * four characters or more, so short words still match exactly and "at" can't
 * claim "Atlanta".
 */
function tokenMatches(queryToken: string, rowTokens: string[]): boolean {
	for (const rowToken of rowTokens) {
		if (rowToken === queryToken) return true;
		if (queryToken.length >= 4 && rowToken.startsWith(queryToken)) return true;
		if (rowToken.length >= 4 && queryToken.startsWith(rowToken)) return true;
	}
	return false;
}

function rowTokens(row: RaceQueryRow): string[] {
	return tokenize(
		[row.title, row.state ?? '', row.district ?? '', row.municipality ?? ''].join(' ')
	);
}

export interface RaceQueryMatch {
	/** Higher is better. */
	score: number;
	/** True when every optional word matched too, not just the required ones. */
	strict: boolean;
}

/**
 * Score a row against a parsed query, or return null when it doesn't match.
 *
 * Year and state are hard filters: asking for the 2025 New York race and being
 * shown a 2023 Ohio one is worse than being shown nothing. The words are
 * scored, and whether they *all* landed is reported back so the caller can
 * prefer precise matches while still having something to fall back on.
 */
export function matchRaceQuery(row: RaceQueryRow, parsed: ParsedRaceQuery): RaceQueryMatch | null {
	if (parsed.year !== null) {
		if (!row.date) return null;
		if (Number(row.date.slice(0, 4)) !== parsed.year) return null;
	}

	// Naming a state is a promise about where the race is, so a row stamped
	// with a different province is wrong however well the words line up. Rows
	// civicAPI left unstamped stay eligible.
	if (parsed.state && row.state && row.state.toUpperCase() !== parsed.state.abbr) return null;

	const tokens = rowTokens(row);
	let score = 0;

	for (const token of parsed.required) {
		if (!tokenMatches(token, tokens)) return null;
		score += 3;
	}

	let strict = true;
	for (const token of parsed.optional) {
		if (tokenMatches(token, tokens)) score += 2;
		else strict = false;
	}

	// Prefer the row whose province the host named over an identically-titled
	// one civicAPI never stamped.
	if (parsed.state && row.state?.toUpperCase() === parsed.state.abbr) score += 2;

	return { score, strict };
}

/**
 * True when the parse found nothing to search on — the host typed only filler,
 * or only a year. The caller treats this like an empty query rather than
 * matching every race in the feed.
 */
export function isEmptyQuery(parsed: ParsedRaceQuery): boolean {
	return (
		parsed.required.length === 0 &&
		parsed.optional.length === 0 &&
		parsed.state === null &&
		parsed.year === null
	);
}
