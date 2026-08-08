import { officeFromTitle } from '../race-office';
import type { StreamState } from '../stream-state';
import { STATES, STATES_BY_ABBR, STATES_BY_FIPS } from '../templates/states';
import type { InsightsQuery } from './insights';

/**
 * What to ask the market and the pollsters about, worked out from the loaded race.
 *
 * Neither source can be queried by anything this app already holds. Polymarket
 * names events in prose a human wrote ("Michigan Senate Election Winner"), and
 * VoteHub keys polls to subject strings of its own ("2026 Michigan"). So the
 * query has to be *constructed*, and the two facts it needs — which state and
 * which office — are exactly the two the app has never had to state explicitly.
 *
 * Both are recovered here rather than added as fields the host must fill in,
 * because a race that needs configuring before it shows a number is a race that
 * won't have one when it matters. The Markets panel carries overrides for the
 * cases where this guesses wrong.
 */

/**
 * The state this race is about, in the order the signals deserve trust.
 *
 * Geography first: the 50 statewide templates carve the national county SVG with
 * `action-groups=<FIPS>`, so that filter value *is* the state and cannot drift
 * from what's on screen. Then the breadcrumb the host drilled through, which is
 * right whenever they came in via a state. The title last, since it's free text —
 * but it's free text that almost always starts with the state's name, and it's
 * the only signal a US House or hand-built race has.
 */
export function stateNameFor(state: StreamState): string {
	const geo = state.profile?.geography;
	if (geo?.filterAttr === 'action-groups' && /^\d{2}$/.test(geo.filterValue ?? '')) {
		const meta = STATES_BY_FIPS[geo.filterValue as string];
		if (meta) return meta.name;
	}

	const abbr = state.ui.homeStateAbbr?.toUpperCase();
	if (abbr && STATES_BY_ABBR[abbr]) return STATES_BY_ABBR[abbr].name;

	const title = state.race.title.toLowerCase();
	// Longest name first so "West Virginia" isn't answered with "Virginia" and
	// "North Dakota" isn't answered with "Dakota"'s absence of a match.
	const byLength = [...STATES].sort((a, b) => b.name.length - a.name.length);
	for (const meta of byLength) {
		if (title.includes(meta.name.toLowerCase())) return meta.name;
	}
	return '';
}

/**
 * The cycle this race belongs to.
 *
 * From the race's own date label when it has one, because a host reviewing the
 * 2024 Senate map in 2026 wants 2024's polls, not this year's. The wall clock is
 * the fallback and is right for the case that matters — a live election night.
 */
function yearFor(state: StreamState): number {
	const fromLabel = /\b(19|20)\d{2}\b/.exec(state.race.dateLabel);
	if (fromLabel) return Number(fromLabel[0]);
	const fromTitle = /\b(19|20)\d{2}\b/.exec(state.race.title);
	if (fromTitle) return Number(fromTitle[0]);
	return new Date().getFullYear();
}

const OFFICE_WORD: Record<string, string> = {
	senate: 'Senate',
	governor: 'Governor',
	house: 'House'
};

export function insightsQueryFor(state: StreamState): InsightsQuery {
	const config = state.ui.insights;
	const office = officeFromTitle(state.race.title) ?? '';
	const stateName = stateNameFor(state);
	const year = yearFor(state);

	// "Michigan Senate" finds the event; the race title would not, because it
	// carries words Polymarket's title doesn't ("US", "Democratic Primary") and
	// the match requires every word to appear.
	const defaultQuery =
		stateName && office ? `${stateName} ${OFFICE_WORD[office]}` : state.race.title;

	// VoteHub keys statewide contests as "<year> <State>" and House seats as
	// "<year> <ST>-<NN>". The district number isn't reliably recoverable from a
	// title, so House races fall to the override rather than guess a seat.
	const defaultSubject = stateName && office !== 'house' ? `${year} ${stateName}` : '';

	return {
		q: (config.marketQuery.trim() || defaultQuery).trim(),
		office,
		subject: (config.pollSubject.trim() || defaultSubject).trim(),
		slug: config.marketSlug.trim()
	};
}
