import type { RaceTemplate } from '../race-profile';
import { FULL_SECTIONS, RESULTS_ONLY } from './defaults';
import { STATES_BY_ABBR } from './states';

/**
 * US House is parameterized (Congress × state × district) — 435 × N would
 * blow up the picker list. The `us-house-generic` template is the placeholder
 * shown in the Templates tab; `makeUsHouseTemplate()` produces a concrete
 * instance once the host picks Congress / State / District from the
 * ParameterizedRow form.
 */

export const US_HOUSE_GENERIC: RaceTemplate = {
	id: 'us-house-generic',
	name: 'US House (pick Congress + State + District)',
	category: 'us-house',
	tags: ['us house', 'house', 'congressional district', 'representative'],
	profile: {
		id: 'us-house-generic',
		label: 'US House',
		category: 'us-house',
		geography: {
			svgPath: 'usa/usa-house-2026-blank.svg',
			filterAttr: null,
			filterValue: null,
			regionLabel: 'Districts'
		},
		sections: FULL_SECTIONS,
		subTabs: RESULTS_ONLY,
		expectedCandidates: [2, 6]
	},
	seed: {
		title: 'US House',
		candidates: [],
		regions: [],
		performance: []
	}
};

export interface UsHouseParams {
	congress: number; // e.g. 119
	stateAbbr: string;
	districtNumber: string; // "1".."52"; "AL" for at-large
}

export function makeUsHouseTemplate(params: UsHouseParams): RaceTemplate {
	const state = STATES_BY_ABBR[params.stateAbbr.toUpperCase()];
	const stateName = state?.name ?? params.stateAbbr;
	const stateFips = state?.fips ?? '';

	// Fall back to the closest year-blank map currently in the yapms SVG catalog.
	// Remapping table can grow as new Congress SVGs land.
	const svgByCongress: Record<number, string> = {
		118: 'usa/usa-house-2024-blank.svg',
		119: 'usa/usa-house-2026-blank.svg',
		120: 'usa/usa-house-2026-blank.svg'
	};
	const svgPath = svgByCongress[params.congress] ?? 'usa/usa-house-2026-blank.svg';

	// Region filter format in yapms district SVGs is typically
	// `<district>-<stateFips>` on the `region` attribute. Where that differs,
	// the Custom SVG fallback on /control covers it.
	const regionId = params.districtNumber.padStart(2, '0') + stateFips;

	return {
		id: `us-house-${params.congress}-${params.stateAbbr.toUpperCase()}-${params.districtNumber}`,
		name: `${params.congress}th US House — ${params.stateAbbr.toUpperCase()}-${params.districtNumber}`,
		category: 'us-house',
		tags: [
			'us house',
			'house',
			stateName.toLowerCase(),
			params.stateAbbr.toLowerCase(),
			`${params.stateAbbr.toUpperCase()}-${params.districtNumber}`,
			String(params.congress),
			`district ${params.districtNumber}`
		],
		profile: {
			id: `us-house-${params.congress}-${params.stateAbbr.toUpperCase()}-${params.districtNumber}`,
			label: `US House ${params.stateAbbr.toUpperCase()}-${params.districtNumber}`,
			category: 'us-house',
			geography: {
				svgPath,
				filterAttr: 'region',
				filterValue: regionId,
				regionLabel: 'Districts'
			},
			sections: FULL_SECTIONS,
			subTabs: RESULTS_ONLY,
			expectedCandidates: [2, 6]
		},
		seed: {
			title: `US House ${params.stateAbbr.toUpperCase()}-${params.districtNumber}`,
			candidates: [],
			regions: [],
			performance: []
		}
	};
}
