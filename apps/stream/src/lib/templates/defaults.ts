import type { ArchivalByYear, RaceTemplate } from '../race-profile';

/** Common tab sets used across templates. */
export const FULL_SUBTABS: RaceTemplate['profile']['subTabs'] = [
	'Results',
	'Forecast',
	'Early Voting',
	'Markets'
];

export const RESULTS_ONLY: RaceTemplate['profile']['subTabs'] = ['Results'];

/** Standard section flags: enable everything and let visibility gate it. */
export const FULL_SECTIONS: RaceTemplate['profile']['sections'] = {
	header: true,
	candidates: true,
	performance: true,
	geography: true,
	regions: true
};

export const NO_GEO_SECTIONS: RaceTemplate['profile']['sections'] = {
	header: true,
	candidates: true,
	performance: false,
	geography: false,
	regions: false
};

/** Per-state seed file shape — produced by scripts/bake-county-seeds.ts. */
export interface StateSeed {
	stateFips: string;
	stateName: string;
	counties: {
		name: string;
		regionAttr: string;
		totalReg: number;
		// Populated by scripts/bake-historical-margins.mjs. Keyed by year string
		// ("2008"-"2024"). Values may be null when the bake script couldn't
		// match the county in that year's CSV (AK boroughs, CT aggregate,
		// newly-split counties, etc.).
		archivalByYear?: ArchivalByYear;
	}[];
	lastPresidentialMargin?: {
		label: string;
		color: string;
		year: number;
	};
}

/**
 * Load a state seed JSON committed under src/lib/templates/seed-data/. Returns
 * null when the seed hasn't been baked yet — the template then falls back to
 * an empty region list, which the host fills in manually. Lets the overlay
 * ship usefully on day one without every seed being present.
 */
const seedGlob = import.meta.glob<StateSeed>('./seed-data/state-*.json', { eager: true });
const seedByFips = new Map<string, StateSeed>();
for (const [path, mod] of Object.entries(seedGlob)) {
	const match = /state-(\d{2})\.json$/.exec(path);
	if (match) {
		seedByFips.set(
			match[1],
			(mod as unknown as { default?: StateSeed }).default ?? (mod as StateSeed)
		);
	}
}

export function getStateSeed(fips: string): StateSeed | null {
	return seedByFips.get(fips) ?? null;
}
