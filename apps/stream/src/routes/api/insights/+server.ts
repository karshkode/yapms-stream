import { json } from '@sveltejs/kit';
import { partyFromLabel } from '$lib/data/insights';
import type { RequestHandler } from './$types';

/**
 * Market prices and poll numbers for the loaded race, from our own origin.
 *
 * This is a proxy rather than a browser fetch for two reasons, and only one of
 * them is CORS. VoteHub sends no `Access-Control-Allow-Origin` header, so the
 * browser can't read it at all — but even for Polymarket, which sends `*`, the
 * broadcast is typically several tabs of the same app (the control desk, the
 * OBS source, a phone the host is watching on) and each would otherwise poll
 * two public services it doesn't pay for on its own timer. One cache here
 * serves all of them.
 *
 * It also keeps the shape of two third-party APIs in one file. Both are free
 * services under no obligation to us, and when one changes its response the
 * blast radius should be a server route, not five components.
 *
 * Deliberately not a general proxy: the only hosts it will ever call are the
 * two constants below, and the caller controls query *values*, never the URL.
 */

const GAMMA = 'https://gamma-api.polymarket.com';
const VOTEHUB = 'https://api.votehub.com';

const FETCH_TIMEOUT_MS = 12_000;

/**
 * Markets move continuously and polls do not, so they get very different
 * lifetimes. A minute-old price is fine to read on air; re-fetching a poll list
 * that changes a few times a week on the same cadence would be pure noise.
 */
const MARKET_TTL_MS = 60_000;
const POLL_TTL_MS = 20 * 60_000;

interface CacheEntry<T> {
	at: number;
	value: T;
}
const marketCache = new Map<string, CacheEntry<MarketPayload | null>>();
const pollCache = new Map<string, CacheEntry<PollPayload | null>>();

interface MarketPayload {
	title: string;
	slug: string;
	url: string;
	volume: number;
	outcomes: { name: string; party: string; probability: number }[];
}

interface RawPoll {
	pollster: string;
	endDate: string;
	sampleSize: number | null;
	population: string;
	/** A poll a campaign commissioned about itself. Kept, but not averaged. */
	internal: boolean;
	answers: { choice: string; pct: number }[];
}

interface PollPayload {
	subject: string;
	polls: RawPoll[];
}

async function getJson(url: string): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			headers: { accept: 'application/json' }
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Gamma sends `outcomes` and `outcomePrices` as JSON-encoded strings on some
 * endpoints and as real arrays on others, and has changed which is which
 * before. Accepting both costs four lines and removes a whole class of silent
 * breakage.
 */
function asArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}
	return [];
}

function num(value: unknown): number {
	const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
	return Number.isFinite(n) ? n : 0;
}

/**
 * A market whose every candidate is a letter of the alphabet.
 *
 * Polymarket pre-creates "Person A" … "Person D" placeholders on election
 * events so a late entrant can be listed without restructuring the market.
 * They carry no price and no volume, and putting "Person C — 0%" on air would
 * be the single most confusing thing on the screen.
 */
function isPlaceholder(label: string, priced: boolean): boolean {
	if (/^(person|party|candidate)\s+[a-z]$/i.test(label.trim())) return true;
	return !priced;
}

async function fetchMarket(query: string, slugOverride: string): Promise<MarketPayload | null> {
	const key = `${query}|${slugOverride}`;
	const hit = marketCache.get(key);
	if (hit && Date.now() - hit.at < MARKET_TTL_MS) return hit.value;

	let value: MarketPayload | null;
	if (slugOverride) {
		// A slug names one event exactly, so nothing has to be chosen — but it
		// still goes through the same reader, since a pinned event has the same
		// placeholder candidates as a searched one.
		const events = await getJson(`${GAMMA}/events?slug=${encodeURIComponent(slugOverride)}`);
		value = pickMarket(Array.isArray(events) ? events : [], '');
	} else {
		const search = (await getJson(
			`${GAMMA}/public-search?q=${encodeURIComponent(query)}&limit_per_type=10`
		)) as { events?: unknown[] };
		value = pickMarket(search?.events ?? [], query);
	}

	marketCache.set(key, { at: Date.now(), value });
	return value;
}

/**
 * The one event the query meant, out of everything the search matched.
 *
 * Search for "Michigan Senate" and Polymarket also returns "Which party will
 * win the Senate in 2026?" — a real market, much larger, and not this race.
 * Requiring every word of the query in the title first, and only then sorting
 * by volume, keeps the biggest market on the page from crowding out the right
 * one. Settled events are dropped: a 2024 race resolved to 100% would otherwise
 * outrank the live one it shares a name with.
 */
function pickMarket(events: unknown[], query: string): MarketPayload | null {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 2);

	const scored = (events as Record<string, unknown>[])
		.filter((e) => e && e.closed !== true)
		.map((e) => {
			const title = String(e.title ?? '');
			const lower = title.toLowerCase();
			const hits = words.filter((w) => lower.includes(w)).length;
			return { event: e, hits, volume: num(e.volume) };
		})
		.filter((row) => words.length === 0 || row.hits === words.length)
		.sort((a, b) => b.volume - a.volume);

	for (const row of scored) {
		const payload = toPayload(row.event);
		if (payload && payload.outcomes.length > 0) return payload;
	}
	return null;
}

function toPayload(event: Record<string, unknown>): MarketPayload | null {
	const markets = Array.isArray(event.markets) ? (event.markets as Record<string, unknown>[]) : [];
	const outcomes: MarketPayload['outcomes'] = [];

	for (const m of markets) {
		if (m.closed === true) continue;
		const label = String(m.groupItemTitle ?? m.question ?? '').trim();
		if (!label) continue;

		const prices = asArray(m.outcomePrices);
		const names = asArray(m.outcomes).map((o) => String(o).toLowerCase());
		// Each candidate is a separate Yes/No market on these events, so the
		// price of "Yes" is this candidate's probability. Index rather than
		// assume position, because a market with the pair reversed would
		// otherwise report every candidate's chance of losing.
		const yesAt = names.indexOf('yes');
		const priced = prices.length > 0;
		const probability = priced ? num(prices[yesAt >= 0 ? yesAt : 0]) : num(m.lastTradePrice);
		if (isPlaceholder(label, priced)) continue;

		outcomes.push({
			name: label.replace(/\s*\([A-Za-z]{1,3}\)\s*$/, '').trim(),
			party: partyFromLabel(label),
			probability
		});
	}

	if (outcomes.length === 0) return null;
	outcomes.sort((a, b) => b.probability - a.probability);

	const slug = String(event.slug ?? '');
	return {
		title: String(event.title ?? ''),
		slug,
		url: slug ? `https://polymarket.com/event/${slug}` : 'https://polymarket.com',
		volume: num(event.volume),
		outcomes
	};
}

const POLL_TYPE: Record<string, string> = {
	senate: 'us-senator',
	governor: 'governor',
	house: 'us-representative'
};

/** Most recent first, trimmed — an average built from a year of polls isn't one. */
const MAX_POLLS = 40;

async function fetchPolls(office: string, subject: string): Promise<PollPayload | null> {
	const pollType = POLL_TYPE[office];
	if (!pollType || !subject) return null;

	const key = `${pollType}|${subject}`;
	const hit = pollCache.get(key);
	if (hit && Date.now() - hit.at < POLL_TTL_MS) return hit.value;

	const url = `${VOTEHUB}/polls?poll_type=${encodeURIComponent(pollType)}&subject=${encodeURIComponent(subject)}`;
	const rows = (await getJson(url)) as Record<string, unknown>[];

	const polls: RawPoll[] = (Array.isArray(rows) ? rows : [])
		.map((r) => ({
			pollster: String(r.pollster ?? ''),
			endDate: String(r.end_date ?? r.created_at ?? ''),
			sampleSize: typeof r.sample_size === 'number' ? r.sample_size : null,
			population: String(r.population ?? ''),
			internal: r.internal === true || (typeof r.partisan === 'string' && r.partisan.length > 0),
			answers: (Array.isArray(r.answers) ? (r.answers as Record<string, unknown>[]) : [])
				.map((a) => ({ choice: String(a.choice ?? ''), pct: num(a.pct) }))
				.filter((a) => a.choice)
		}))
		.filter((p) => p.endDate && p.answers.length > 0)
		.sort((a, b) => b.endDate.localeCompare(a.endDate))
		.slice(0, MAX_POLLS);

	const value = polls.length > 0 ? { subject, polls } : null;
	pollCache.set(key, { at: Date.now(), value });
	return value;
}

export const GET: RequestHandler = async ({ url }) => {
	const query = (url.searchParams.get('q') ?? '').trim();
	const office = (url.searchParams.get('office') ?? '').trim();
	const subject = (url.searchParams.get('subject') ?? '').trim();
	const slug = (url.searchParams.get('slug') ?? '').trim();

	const notes: string[] = [];

	// Settled independently so one service being down doesn't take the other
	// off the screen. Half the panel is better than none of it, and the note
	// says which half is missing and why.
	const [market, polls] = await Promise.all([
		query || slug
			? fetchMarket(query, slug).catch((err: unknown) => {
					notes.push(`Polymarket lookup failed: ${errText(err)}`);
					return null;
				})
			: Promise.resolve(null),
		office && subject
			? fetchPolls(office, subject).catch((err: unknown) => {
					notes.push(`VoteHub lookup failed: ${errText(err)}`);
					return null;
				})
			: Promise.resolve(null)
	]);

	if (!market && notes.length === 0) notes.push(`No open Polymarket event matched “${query}”.`);
	if (!polls && office && subject) notes.push(`VoteHub has no ${office} polls for “${subject}”.`);
	if (!office) notes.push('No office recognised in the race title, so no polls were looked up.');

	return json(
		{ fetchedAt: Date.now(), market, polls, notes },
		{
			// The client keeps its own copy in state and re-fetches on its own
			// timer; this only stops a reload storm from bypassing the cache above.
			headers: { 'cache-control': 'public, max-age=30' }
		}
	);
};

function errText(err: unknown): string {
	if (err instanceof Error) return err.name === 'AbortError' ? 'timed out' : err.message;
	return String(err);
}
