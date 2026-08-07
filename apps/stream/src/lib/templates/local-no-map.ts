import type { RaceTemplate } from '../race-profile';

/**
 * For mayor / city council / school board / drainage district / etc. No map,
 * just candidates. The host types the office name into the Race meta form
 * after loading. Common aliases (mayor, council, board, etc.) go in tags so
 * the picker's substring search finds it.
 */

export const LOCAL_NO_MAP_TEMPLATE: RaceTemplate = {
	id: 'local-no-map',
	name: 'Local Race (no map)',
	category: 'local-no-map',
	tags: [
		'local',
		'mayor',
		'city council',
		'council',
		'school board',
		'board',
		'alderman',
		'drainage',
		'at large',
		'municipal',
		'non-partisan'
	],
	profile: {
		id: 'local-no-map',
		label: 'Local Race',
		category: 'local-no-map',
		geography: null,
		sections: {
			header: true,
			candidates: true,
			performance: false,
			geography: false,
			regions: false
		},
		subTabs: ['Results'],
		expectedCandidates: [2, 12]
	},
	seed: {
		title: 'Local Race',
		candidates: [],
		regions: [],
		performance: []
	}
};
