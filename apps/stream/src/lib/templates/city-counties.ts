import type { RaceTemplate, RegionLabel } from '../race-profile';
import { zoneForStateAbbr } from '../time-zone';
import { FULL_SECTIONS, RESULTS_ONLY, getStateSeed } from './defaults';
import { STATES_BY_FIPS } from './states';

/**
 * Maps for the handful of cities big enough to have their own election night.
 *
 * A mayoral race used to land on the state's 62-county map, which is the wrong
 * geography by two orders of magnitude: New York City is five of those counties
 * and about 0.4% of the state's area, so the host got a map of upstate New York
 * with the race they were narrating invisible in one corner. Zooming was manual
 * and had to be redone every time the map reset.
 *
 * These templates filter the same national county SVG down to the counties the
 * city actually covers, and because `filterSvg` recomputes the viewBox from what
 * survives, the city fills the frame with no zooming at all. The regions are the
 * boroughs, so they colour, click and carry their own baselines like counties
 * anywhere else.
 *
 * Deliberately a short hand-written table rather than a general city-to-counties
 * dataset. The general version is a real geography problem — most cities sit
 * inside one county and many straddle a line for a few thousand residents — and
 * a mostly-right table of nine thousand municipalities would put the wrong map on
 * air for the long tail. Every entry here is a city whose county coverage is
 * exact and well known, and anything not in the table keeps the old behaviour.
 */

interface CityMap {
	/**
	 * Accepted as an exact `municipality` value. May include the bare city name,
	 * since a municipality field saying "New York" can only mean the city.
	 */
	municipalityKeys: string[];
	/**
	 * Looked for inside a race title, so these have to be unambiguous on their
	 * own. "New York" is not: it is the start of "New York Governor" and of every
	 * statewide race in the state. "New York City" and "NYC" can only be the city.
	 */
	titleKeys: string[];
	slug: string;
	name: string;
	stateFips: string;
	/** SVG `region` attribute per covered county. */
	regionAttrs: string[];
	/** What one region is called here — "Boroughs", not "Counties". */
	regionLabel: RegionLabel;
}

const CITY_MAPS: CityMap[] = [
	{
		municipalityKeys: ['new york city', 'new york', 'nyc'],
		titleKeys: ['new york city', 'nyc'],
		slug: 'nyc',
		name: 'New York City',
		stateFips: '36',
		// Bronx, Brooklyn, Manhattan, Queens, Staten Island — the five boroughs
		// are exactly five New York counties, which is what makes this one safe
		// to hard-code.
		regionAttrs: ['Bronx36', 'Kings36', 'New York36', 'Queens36', 'Richmond36'],
		regionLabel: 'Boroughs'
	}
];

/**
 * Borough names as a New Yorker says them.
 *
 * The county seed calls them Kings, New York and Richmond, which is correct on a
 * deed and wrong on a results board — nobody watching a mayoral race is waiting
 * on Kings County. The county name is kept in parentheses because the region is
 * still a county everywhere else in the app, including in the baked baselines.
 */
const BOROUGH_NAMES: Record<string, string> = {
	Bronx36: 'The Bronx',
	Kings36: 'Brooklyn (Kings)',
	'New York36': 'Manhattan (New York)',
	Queens36: 'Queens',
	Richmond36: 'Staten Island (Richmond)'
};

function buildCity(city: CityMap): RaceTemplate {
	const stateMeta = STATES_BY_FIPS[city.stateFips];
	const seed = getStateSeed(city.stateFips);
	const covered = new Set(city.regionAttrs);
	const counties = (seed?.counties ?? []).filter((c) => covered.has(c.regionAttr));

	return {
		id: `city-${city.slug}`,
		name: `${city.name} — Citywide`,
		category: 'local-no-map',
		tags: [
			city.name.toLowerCase(),
			city.slug,
			stateMeta?.name.toLowerCase() ?? '',
			stateMeta?.abbr.toLowerCase() ?? '',
			'mayor',
			'city council',
			'comptroller',
			'municipal',
			'citywide'
		].filter(Boolean),
		profile: {
			id: `city-${city.slug}`,
			label: `${city.name} Citywide`,
			category: 'local-no-map',
			geography: {
				svgPath: 'usa/usa-counties-2023-blank.svg',
				// By `region` rather than `action-groups`: that attribute carries the
				// state FIPS and can only select whole states. The region attribute is
				// per county, and `filterSvg` already accepts a `|`-separated set.
				filterAttr: 'region',
				filterValue: city.regionAttrs.join('|'),
				regionLabel: city.regionLabel
			},
			sections: FULL_SECTIONS,
			subTabs: RESULTS_ONLY,
			expectedCandidates: [2, 8]
		},
		seed: {
			title: `${city.name} Citywide Race`,
			dateLabel: '',
			timeZone: zoneForStateAbbr(stateMeta?.abbr) ?? undefined,
			candidates: [],
			regions: counties.map((c) => ({
				name: BOROUGH_NAMES[c.regionAttr] ?? c.name,
				regionAttr: c.regionAttr,
				leaderId: null,
				votes: 0,
				evr: 0,
				reportedPct: 0,
				totalReg: c.totalReg,
				candidateVotes: {},
				archivalByYear: c.archivalByYear ?? {}
			})),
			performance: []
		}
	};
}

export const CITY_TEMPLATES: RaceTemplate[] = CITY_MAPS.map(buildCity);

function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * The city template for a municipality name, or null.
 *
 * Exact on the normalised name, never a prefix. "New York City" prefix-matching
 * "New York" is precisely the confusion this file exists to remove, and the same
 * loose match in the other direction would give Kansas City, Kansas a map of
 * Kansas City, Missouri.
 */
export function cityTemplateFor(municipality: string | null | undefined): RaceTemplate | null {
	if (!municipality) return null;
	const target = normalize(municipality);
	if (!target) return null;
	const index = CITY_MAPS.findIndex((city) => city.municipalityKeys.includes(target));
	return index >= 0 ? CITY_TEMPLATES[index] : null;
}

/**
 * The city template a race title names, or null.
 *
 * Needed because civicAPI often leaves `municipality` unset and puts the city in
 * the title, which for a municipal race it does almost by definition. Matching
 * on `titleKeys` keeps that from swallowing statewide races that merely start
 * with the state's name.
 */
export function cityTemplateFromTitle(title: string): RaceTemplate | null {
	const target = normalize(title);
	if (!target) return null;
	for (const [index, city] of CITY_MAPS.entries()) {
		if (city.titleKeys.some((key) => target.includes(key))) return CITY_TEMPLATES[index];
	}
	return null;
}
