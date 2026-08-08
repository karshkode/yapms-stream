import type { RaceTemplate } from '../race-profile';
import { BROWSE_US_TEMPLATE } from './browse';
import { CITY_TEMPLATES } from './city-counties';
import { LOCAL_NO_MAP_TEMPLATE } from './local-no-map';
import { STATE_STATEWIDE_TEMPLATES } from './state-statewide';
import { US_GOVERNORS_TEMPLATES } from './us-governors';
import { US_HOUSE_GENERIC, makeUsHouseTemplate } from './us-house';
import { US_PRESIDENT_TEMPLATES } from './us-president';
import { US_SENATE_TEMPLATES } from './us-senate';
import { STATE_LEG_GENERIC, makeStateLegTemplate } from './state-leg';

/**
 * Flat list of templates the picker enumerates. Parameterized templates
 * (`us-house-generic`, `state-leg-generic`) are placeholders — the host
 * fills in parameters and gets a concrete template via the factory functions
 * exported below.
 *
 * `BROWSE_US_TEMPLATE` is registered here (so TEMPLATES_BY_ID can resolve it
 * on reload / from Recent) but intentionally excluded from the picker's
 * surface list — it's the default landing shell, not something the host
 * picks deliberately.
 */
export const ALL_TEMPLATES: RaceTemplate[] = [
	...STATE_STATEWIDE_TEMPLATES,
	...US_PRESIDENT_TEMPLATES,
	...US_SENATE_TEMPLATES,
	...US_GOVERNORS_TEMPLATES,
	US_HOUSE_GENERIC,
	STATE_LEG_GENERIC,
	...CITY_TEMPLATES,
	LOCAL_NO_MAP_TEMPLATE
];

export const TEMPLATES_BY_ID: Record<string, RaceTemplate> = Object.fromEntries(
	[...ALL_TEMPLATES, BROWSE_US_TEMPLATE].map((t) => [t.id, t])
);

/**
 * Hydrate a template by its id, reconstructing parameterized templates
 * (`us-house-<congress>-<STATE>-<district>`, `state-leg-<chamber>-<STATE>-<district>`)
 * on the fly. Used by the Recent list so a previously-loaded district race
 * survives a full page refresh.
 *
 * Returns null when the id isn't registered and doesn't match a known
 * parametric scheme — the caller falls back to ignoring the Recent row.
 */
export function hydrateTemplateById(id: string): RaceTemplate | null {
	const direct = TEMPLATES_BY_ID[id];
	if (direct) return direct;

	const houseMatch = /^us-house-(\d+)-([A-Z]{2})-(.+)$/.exec(id);
	if (houseMatch) {
		const [, congress, stateAbbr, districtNumber] = houseMatch;
		return makeUsHouseTemplate({
			congress: Number(congress),
			stateAbbr,
			districtNumber
		});
	}

	const legMatch = /^state-leg-(lower|upper)-([A-Z]{2})-(.+)$/.exec(id);
	if (legMatch) {
		const [, chamber, stateAbbr, districtNumber] = legMatch;
		return makeStateLegTemplate({
			chamber: chamber as 'lower' | 'upper',
			stateAbbr,
			districtNumber
		});
	}

	return null;
}

export { BROWSE_US_TEMPLATE, LOCAL_NO_MAP_TEMPLATE, makeStateLegTemplate, makeUsHouseTemplate };
