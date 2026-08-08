import { officeFromTitle } from '../race-office';
import type { StreamState } from '../stream-state';

/**
 * Past results for the *same office*, so Swing and Turnout have something to
 * measure against on a cold boot.
 *
 * The comparison feature shipped able to compare a race against the baked
 * presidential margins or against a race the host froze mid-broadcast. Neither
 * is the comparison a downballot night is about. Measuring a Senate race against
 * the presidential margin measures ticket-splitting — a real story, but not the
 * first one a host reaches for — and a captured baseline only exists if the host
 * happened to watch the earlier race through this app and remembered to press
 * the button. There is no database behind the desk, so a capture is gone the
 * moment browser storage is cleared.
 *
 * So the prior Senate and Governor results are baked in, by county, per state,
 * by scripts/bake-office-history.mjs. "Wayne County is nine points redder than
 * it was in the last Senate race" needs nothing set up and nothing remembered.
 *
 * Loaded per state on demand rather than bundled. The full set is about 2.6 MB
 * of JSON across 48 states — an order of magnitude more than every other seed in
 * the app put together — and a broadcast only ever looks at one state, so
 * eagerly globbing it the way `defaults.ts` globs the county seeds would put the
 * whole country in the initial payload to serve one state's worth of it.
 *
 * It also deliberately does *not* live in StreamState. Everything in there is
 * serialized onto the BroadcastChannel on a timer to keep /overlay in sync, and
 * /overlay can load the same static file itself. Sending a hundred counties ×
 * four past races over that channel four times a second would be paying the
 * whole cost repeatedly to move data that both ends already have on disk.
 */

/** One region's line in a past race. Shaped like `ArchivalSnapshot`. */
export interface OfficeHistorySnapshot {
	color: string;
	label: string;
	/** Signed two-party margin, positive = R. */
	margin: number;
	votesRep: number;
	votesDem: number;
	/** Every candidate's votes, so turnout share is a share of the electorate. */
	votesTotal: number;
}

export type HistoryOffice = 'senate' | 'governor';

export interface OfficeHistoryRace {
	/** `senate-2024`. Unique within a state, which is all a baselineRef needs. */
	id: string;
	office: HistoryOffice;
	year: number;
	/** "2024 US Senate". */
	label: string;
	candRep: string;
	candDem: string;
	/** Surnames, as they appear in each region's label. */
	shortRep: string;
	shortDem: string;
	/**
	 * False when the top two weren't a Republican against a non-Republican:
	 * California's top-two Senate races are routinely Democrat against Democrat,
	 * and New Mexico's 2022 source carries no party at all. A margin between two
	 * allies says which of them won, not how the state leans, so swing against
	 * one is suppressed while turnout stays usable.
	 */
	partisan: boolean;
	/** Statewide signed two-party margin, positive = R. */
	margin: number;
	votesRep: number;
	votesDem: number;
	votesTotal: number;
	/** Keyed by the SVG `region` attribute, e.g. "Wayne26". */
	regions: Record<string, OfficeHistorySnapshot>;
}

interface OfficeHistoryFile {
	stateFips: string;
	stateName: string;
	races: OfficeHistoryRace[];
}

const loaders = import.meta.glob<{ default: OfficeHistoryFile }>(
	'../templates/seed-data/office-history/state-*.json'
);

const loaderByFips: Record<string, () => Promise<{ default: OfficeHistoryFile }>> = {};
for (const [path, load] of Object.entries(loaders)) {
	const match = /state-(\d{2})\.json$/.exec(path);
	if (match) loaderByFips[match[1]] = load;
}

/**
 * State FIPS -> that state's races, or `[]` once we know there are none.
 *
 * A missing key means "not looked at yet" and an empty array means "looked, and
 * there is nothing".
 */
const loaded = $state<Record<string, OfficeHistoryRace[]>>({});

/**
 * States whose load is already under way, so the second reader of the same
 * frame doesn't fetch the file again.
 *
 * A plain object rather than a Set because it must *not* be reactive: it is
 * written during a read, which for anything Svelte tracks would mean writing
 * state inside a `$derived` and taking down the component that asked.
 */
const inFlight: Record<string, true> = {};

/**
 * A state's baked races, kicking off the load on first ask.
 *
 * Warming the cache as a side effect of reading it, rather than from an effect
 * in each route, because both /control and /overlay paint the same map from the
 * same functions and either could be the first to need it. Wiring an effect per
 * route means the map silently loses its baseline on whichever surface someone
 * forgets — and /overlay is the one that's on air.
 *
 * Returns `[]` while the load is in flight. `loaded` is `$state`, so the read
 * registers a dependency and the map repaints once the file arrives; the caller
 * doesn't have to know this is asynchronous at all.
 */
export function officeHistoryFor(stateFips: string | null): OfficeHistoryRace[] {
	if (!stateFips) return [];
	const cached = loaded[stateFips];
	if (cached) return cached;
	if (!inFlight[stateFips]) {
		inFlight[stateFips] = true;
		// Resolved rather than called directly so that `loaded` is only ever
		// written from a microtask. The first caller is typically a `$derived`
		// painting the map, and writing tracked state from inside one is an error
		// in Svelte 5 — the point of a derived being that it doesn't have effects.
		const load = loaderByFips[stateFips];
		Promise.resolve(load?.())
			.then((mod) => {
				loaded[stateFips] = mod?.default?.races ?? [];
			})
			.catch(() => {
				// A failed chunk fetch is recorded as "no history" rather than retried
				// on every frame. The map falls back to the presidential baseline,
				// which is where it was before any of this existed.
				loaded[stateFips] = [];
			});
	}
	return [];
}

/**
 * The past race the comparison is currently measured against, or null when it's
 * measured against something else (a presidential year, a capture).
 *
 * Lets the region detail card show that race's own numbers for the county under
 * the cursor — "Slotkin took Wayne 68-31" — rather than only the shift since
 * it. The shift is what the map colours; the numbers behind it are what the host
 * says out loud, and having to hold them in their head is how a wrong one gets
 * said.
 */
export function activeHistoryRace(state: StreamState): OfficeHistoryRace | null {
	const ref = state.ui.comparison.baselineRef;
	if (!ref.startsWith('history:')) return null;
	const id = ref.slice('history:'.length);
	return officeHistoryFor(countyMapStateFips(state)).find((race) => race.id === id) ?? null;
}

/**
 * The state whose counties this race's map draws, or null.
 *
 * Read off the geography rather than stored on the race, because the geography
 * is already the authority on it and can't drift: the 50 statewide templates all
 * carve the national county SVG with `action-groups=<FIPS>`, so a two-digit
 * filter value on that attribute *is* the state. Storing a parallel
 * `race.stateFips` would add a field that a saved race could contradict.
 *
 * Null for everything else, which is correct rather than merely safe. A US House
 * or state-legislative map is a district geography, and county-keyed history has
 * nothing to say about a region called "12-26".
 */
export function countyMapStateFips(state: StreamState): string | null {
	const geo = state.profile?.geography;
	if (!geo || geo.filterAttr !== 'action-groups') return null;
	const value = geo.filterValue ?? '';
	return /^\d{2}$/.test(value) ? value : null;
}

/**
 * Which office the loaded race is for, of the two the bake covers.
 *
 * Only used to decide which baseline is offered *first*; every baked race for
 * the state is selectable either way. So a wrong guess costs a default, not a
 * wrong number on screen — which is what makes a guess acceptable here.
 *
 * A US House race reads as `house` upstream and null here, which is right: the
 * bake is county-keyed and has nothing to say about a district map.
 */
export function inferOffice(title: string): HistoryOffice | null {
	const office = officeFromTitle(title);
	return office === 'senate' || office === 'governor' ? office : null;
}
