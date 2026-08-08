import { z } from 'zod';

/**
 * What the race looked like before anyone voted: the betting market's price and
 * the polling average.
 *
 * Every other number this app puts on screen is a count of votes, or something
 * derived from past ones. Those are the right numbers once returns are landing,
 * but for most of a broadcast — the hours before poll close, the long flat
 * stretch at 4% reporting, every segment about a race that isn't the one on the
 * map — the honest answer to "where does this stand" is what the market and the
 * pollsters say. A host has that on a second screen today and reads it off by
 * hand.
 *
 * Both sources are public and free. Polymarket's Gamma API is open and sends
 * `Access-Control-Allow-Origin: *`; VoteHub publishes poll-level data under
 * CC-BY 4.0 and sends no CORS header at all, which is why both are fetched
 * through `/api/insights` rather than from the browser. Going through our own
 * origin also means one cache in front of two services that owe us nothing,
 * instead of every open OBS tab hitting them on its own timer.
 *
 * Attribution is not optional for VoteHub: CC-BY requires it, so the source is
 * carried in the payload and rendered wherever the numbers are.
 */

export const MarketOutcome = z.object({
	/** As the market names them, e.g. "Abdul El-Sayed". */
	name: z.string(),
	/** "D" / "R" / "" — parsed out of the market's own label when it carries one. */
	party: z.string().default(''),
	/**
	 * 0-1. A prediction market's price for a $1 contract that pays out if this
	 * candidate wins *is* the market's probability, which is what makes it
	 * quotable on air without further arithmetic.
	 */
	probability: z.number(),
	/** Our candidate's id when the name matched the roster, else null. */
	candidateId: z.string().nullable().default(null)
});
export type MarketOutcome = z.infer<typeof MarketOutcome>;

export const MarketSnapshot = z.object({
	source: z.literal('polymarket').default('polymarket'),
	title: z.string(),
	slug: z.string(),
	url: z.string(),
	/**
	 * Lifetime traded volume in dollars. Carried because it is the only honest
	 * measure of how much a price means: a 62% with $8 behind it is one trader's
	 * opinion, and saying it on air the way you'd say a poll would be wrong.
	 */
	volume: z.number().default(0),
	outcomes: z.array(MarketOutcome).default([])
});
export type MarketSnapshot = z.infer<typeof MarketSnapshot>;

export const PollAverage = z.object({
	name: z.string(),
	pct: z.number(),
	candidateId: z.string().nullable().default(null)
});
export type PollAverage = z.infer<typeof PollAverage>;

export const PollSnapshot = z.object({
	source: z.literal('votehub').default('votehub'),
	/** VoteHub's own name for the contest, e.g. "2026 Michigan". */
	subject: z.string(),
	/** How many polls went into the average. */
	count: z.number().int().default(0),
	/** Field dates of the oldest and newest poll in the average, ISO. */
	from: z.string().default(''),
	to: z.string().default(''),
	averages: z.array(PollAverage).default([]),
	/** The most recent poll, which is the one a host quotes by name. */
	latestPollster: z.string().default(''),
	latestDate: z.string().default('')
});
export type PollSnapshot = z.infer<typeof PollSnapshot>;

export const InsightsData = z.object({
	fetchedAt: z.number().int(),
	market: MarketSnapshot.nullable().default(null),
	polls: PollSnapshot.nullable().default(null),
	/**
	 * Why a side came back empty, in words the host can act on ("no Polymarket
	 * event matched"). A blank strip with no explanation reads as broken, and
	 * the fix is usually a one-word change to the search in the panel.
	 */
	notes: z.array(z.string()).default([])
});
export type InsightsData = z.infer<typeof InsightsData>;

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

/**
 * Neither source knows our candidate ids, so the join is on names — and the
 * three spellings of one person rarely agree. Polymarket labels an outcome
 * "Abdul El-Sayed (D)", VoteHub answers "Abdul El-Sayed", and civicAPI may
 * carry "Abdul El-Sayed Jr." or an initial.
 */
export function normalizeName(raw: string): string {
	return (
		raw
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			// Party suffix on a market label: "Mike Rogers (R)".
			.replace(/\([^)]*\)/g, ' ')
			.replace(/[^a-z\s]/g, ' ')
			.replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

/** The party letter a market label carries, e.g. "(D)". */
export function partyFromLabel(raw: string): string {
	const match = /\(([A-Za-z]{1,3})\)\s*$/.exec(raw.trim());
	return match ? match[1].toUpperCase() : '';
}

function surname(normalized: string): string {
	const parts = normalized.split(' ').filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : '';
}

/**
 * Our candidate id for an external name, or null.
 *
 * Surname is the anchor because it is the one part every source spells the
 * same. When two candidates share one — which happens, and is exactly when
 * getting it wrong is most embarrassing — the first initial breaks the tie, and
 * if it can't, the match is refused rather than guessed. A market price under
 * the wrong face is worse than no market price.
 */
export function matchCandidateId(
	externalName: string,
	candidates: ReadonlyArray<{ id: string; name: string }>
): string | null {
	const target = normalizeName(externalName);
	if (!target) return null;

	const exact = candidates.filter((c) => normalizeName(c.name) === target);
	if (exact.length === 1) return exact[0].id;

	const last = surname(target);
	if (!last) return null;
	const bySurname = candidates.filter((c) => surname(normalizeName(c.name)) === last);
	if (bySurname.length === 1) return bySurname[0].id;
	if (bySurname.length === 0) return null;

	const initial = target.charAt(0);
	const byInitial = bySurname.filter((c) => normalizeName(c.name).charAt(0) === initial);
	return byInitial.length === 1 ? byInitial[0].id : null;
}

// ---------------------------------------------------------------------------
// The feed from /api/insights, and how it becomes numbers on screen
// ---------------------------------------------------------------------------

export interface InsightsFeed {
	fetchedAt: number;
	market: {
		title: string;
		slug: string;
		url: string;
		volume: number;
		outcomes: { name: string; party: string; probability: number }[];
	} | null;
	polls: {
		subject: string;
		polls: {
			pollster: string;
			endDate: string;
			sampleSize: number | null;
			population: string;
			internal: boolean;
			answers: { choice: string; pct: number }[];
		}[];
	} | null;
	notes: string[];
}

export interface InsightsQuery {
	/** Free text for the market search, e.g. "Michigan Senate". */
	q: string;
	office: string;
	/** VoteHub's contest name, e.g. "2026 Michigan". */
	subject: string;
	/** Pins one Polymarket event when the search picks the wrong one. */
	slug: string;
}

export async function fetchInsightsFeed(
	query: InsightsQuery,
	init?: { signal?: AbortSignal }
): Promise<InsightsFeed> {
	const params = new URLSearchParams({
		q: query.q,
		office: query.office,
		subject: query.subject,
		slug: query.slug
	});
	const res = await fetch(`/api/insights?${params.toString()}`, { signal: init?.signal });
	if (!res.ok) throw new Error(`insights HTTP ${res.status}`);
	return (await res.json()) as InsightsFeed;
}

/**
 * Only polls fielded recently enough to describe the race as it is now.
 *
 * Ninety days is generous for a window and deliberately so: in an off-cycle
 * month it's the difference between an average and an empty panel, and the
 * date range travels with the number so a host can see they're quoting
 * something from March.
 */
const POLL_WINDOW_DAYS = 90;
/**
 * Weight halves every fortnight. A poll from last week should dominate one from
 * six weeks ago without erasing it, and a half-life says that in one number
 * rather than in a table of cutoffs.
 */
const POLL_HALF_LIFE_DAYS = 14;
/** Beyond a dozen, older polls only add lag. */
const MAX_POLLS_AVERAGED = 12;

const DAY_MS = 86_400_000;

/**
 * Turn the feed into the shape the overlay reads, joined to this race's roster.
 *
 * The roster is what makes the average trustworthy, and it's why this isn't
 * done on the server. VoteHub returns every poll for "2026 Michigan" under one
 * subject — the Democratic primary field, the Republican one, and the general —
 * and averaging them together would produce a number for a contest nobody is
 * holding. Requiring at least two of the loaded candidates in a poll's answers
 * selects exactly the polls about the race on screen: a general roster matches
 * the general polls, and a primary roster matches that primary's.
 */
export function summarizeInsights(
	feed: InsightsFeed,
	candidates: ReadonlyArray<{ id: string; name: string }>,
	now = Date.now()
): InsightsData {
	const notes = [...feed.notes];

	const market: MarketSnapshot | null = feed.market
		? {
				source: 'polymarket',
				title: feed.market.title,
				slug: feed.market.slug,
				url: feed.market.url,
				volume: feed.market.volume,
				outcomes: feed.market.outcomes.map((o) => ({
					name: o.name,
					party: o.party,
					probability: o.probability,
					candidateId: matchCandidateId(o.name, candidates)
				}))
			}
		: null;

	let polls: PollSnapshot | null = null;
	if (feed.polls) {
		const usable = feed.polls.polls
			.map((p) => {
				const matched = p.answers
					.map((a) => ({ ...a, candidateId: matchCandidateId(a.choice, candidates) }))
					.filter((a) => a.candidateId !== null);
				const ageDays = (now - Date.parse(p.endDate)) / DAY_MS;
				return { poll: p, matched, ageDays };
			})
			.filter((row) => row.matched.length >= 2)
			.filter((row) => Number.isFinite(row.ageDays) && row.ageDays <= POLL_WINDOW_DAYS)
			.filter((row) => !row.poll.internal)
			.slice(0, MAX_POLLS_AVERAGED);

		if (usable.length === 0) {
			notes.push(
				feed.polls.polls.length > 0
					? `VoteHub has polls for “${feed.polls.subject}” but none in the last ${POLL_WINDOW_DAYS} days matching this candidate field.`
					: `No polls found for “${feed.polls.subject}”.`
			);
		} else {
			const totals = new Map<string, { name: string; weighted: number; weight: number }>();
			for (const row of usable) {
				// Age is the dominant term; sample size is a mild correction, so a
				// 300-person survey counts for something without a 2,000-person one
				// swamping three fresher polls. Square root because precision goes
				// with √n, not n.
				const recency = Math.pow(0.5, Math.max(0, row.ageDays) / POLL_HALF_LIFE_DAYS);
				const size = Math.sqrt(Math.min(2000, Math.max(200, row.poll.sampleSize ?? 600)) / 600);
				const weight = recency * size;
				for (const answer of row.matched) {
					const key = answer.candidateId as string;
					const entry = totals.get(key) ?? { name: answer.choice, weighted: 0, weight: 0 };
					entry.weighted += answer.pct * weight;
					entry.weight += weight;
					totals.set(key, entry);
				}
			}

			const dates = usable.map((row) => row.poll.endDate).sort();
			polls = {
				source: 'votehub',
				subject: feed.polls.subject,
				count: usable.length,
				from: dates[0] ?? '',
				to: dates[dates.length - 1] ?? '',
				averages: [...totals.entries()]
					.map(([candidateId, entry]) => ({
						candidateId,
						name: entry.name,
						pct: entry.weight > 0 ? entry.weighted / entry.weight : 0
					}))
					.sort((a, b) => b.pct - a.pct),
				latestPollster: usable[0].poll.pollster,
				latestDate: usable[0].poll.endDate
			};
		}
	}

	return { fetchedAt: feed.fetchedAt || now, market, polls, notes };
}

/** The market's own leader, for a one-line read of where it stands. */
export function marketLeader(market: MarketSnapshot | null): MarketOutcome | null {
	if (!market || market.outcomes.length === 0) return null;
	return market.outcomes.reduce((best, o) => (o.probability > best.probability ? o : best));
}
