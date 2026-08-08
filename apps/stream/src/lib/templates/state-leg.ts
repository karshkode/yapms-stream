import type { RaceTemplate } from '../race-profile';
import { zoneForStateAbbr } from '../time-zone';
import { FULL_SECTIONS, RESULTS_ONLY } from './defaults';
import { STATES_BY_ABBR } from './states';

/**
 * State legislative races — parameterized like US House. Same rationale: N
 * states × 2 chambers × M districts makes a flat list impractical. Host picks
 * State / Chamber / District from a ParameterizedRow form on /control.
 */

export const STATE_LEG_GENERIC: RaceTemplate = {
	id: 'state-leg-generic',
	name: 'State Legislative (pick State + Chamber + District)',
	category: 'state-leg',
	tags: ['state house', 'state senate', 'legislative', 'district'],
	profile: {
		id: 'state-leg-generic',
		label: 'State Legislative',
		category: 'state-leg',
		geography: null,
		sections: FULL_SECTIONS,
		subTabs: RESULTS_ONLY,
		expectedCandidates: [2, 4]
	},
	seed: {
		title: 'State Legislative',
		candidates: [],
		regions: [],
		performance: []
	}
};

export interface StateLegParams {
	stateAbbr: string;
	chamber: 'lower' | 'upper';
	districtNumber: string;
	year?: number;
}

export function makeStateLegTemplate(params: StateLegParams): RaceTemplate {
	const state = STATES_BY_ABBR[params.stateAbbr.toUpperCase()];
	const stateName = state?.name ?? params.stateAbbr;
	const year = params.year ?? 2022;
	const svgPath = `usa/usa-${state?.abbrLower ?? params.stateAbbr.toLowerCase()}_${params.chamber}-${year}-blank.svg`;

	const chamberLabel = params.chamber === 'lower' ? 'State House' : 'State Senate';

	return {
		id: `state-leg-${params.chamber}-${params.stateAbbr.toUpperCase()}-${params.districtNumber}`,
		name: `${stateName} ${chamberLabel} ${params.districtNumber}`,
		category: 'state-leg',
		tags: [
			'state leg',
			chamberLabel.toLowerCase(),
			stateName.toLowerCase(),
			params.stateAbbr.toLowerCase(),
			`district ${params.districtNumber}`
		],
		profile: {
			id: `state-leg-${params.chamber}-${params.stateAbbr.toUpperCase()}-${params.districtNumber}`,
			label: `${stateName} ${chamberLabel} ${params.districtNumber}`,
			category: 'state-leg',
			geography: {
				svgPath,
				filterAttr: 'region',
				filterValue: params.districtNumber,
				regionLabel: 'Districts'
			},
			sections: FULL_SECTIONS,
			subTabs: RESULTS_ONLY,
			expectedCandidates: [2, 4]
		},
		seed: {
			title: `${stateName} ${chamberLabel} ${params.districtNumber}`,
			timeZone: zoneForStateAbbr(params.stateAbbr) ?? undefined,
			candidates: [],
			regions: [],
			performance: []
		}
	};
}
