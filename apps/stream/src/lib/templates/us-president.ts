import type { ArchivalByYear, RaceTemplate } from '../race-profile';
import { FULL_SECTIONS, FULL_SUBTABS } from './defaults';
import usPresBaseline from './seed-data/us-presidential-archival.json';

// Map the baked 2008-2024 state-level margins (keyed by 2-letter lowercase
// postal code) onto the region rows that match the `region="al"` / `region="ca"`
// attributes in usa-presidential-2024-blank.svg. `archivalByYear` feeds the
// archival time slider on /control; when the slider is off, the map paints
// NEUTRAL by default (live-first design).
type BaselineRow = {
	stateName: string;
	archivalByYear: ArchivalByYear;
};
const baseline = usPresBaseline as Record<string, BaselineRow>;
const baselineRegions = Object.entries(baseline).map(([po, row]) => ({
	name: row.stateName,
	regionAttr: po,
	leaderId: null,
	votes: 0,
	evr: 0,
	reportedPct: 0,
	totalReg: 0,
	archivalByYear: row.archivalByYear ?? {}
}));

export const US_PRESIDENT_TEMPLATES: RaceTemplate[] = [
	{
		id: 'us-president-2024',
		name: '2024 US President',
		category: 'us-wide',
		tags: ['president', '2024', 'us', 'usa', 'presidential', 'electoral college'],
		profile: {
			id: 'us-president-2024',
			label: '2024 US President',
			category: 'us-wide',
			geography: {
				svgPath: 'usa/usa-presidential-2024-blank.svg',
				filterAttr: null,
				filterValue: null,
				regionLabel: 'States'
			},
			sections: FULL_SECTIONS,
			subTabs: FULL_SUBTABS,
			expectedCandidates: [2, 6]
		},
		seed: {
			title: '2024 US President',
			dateLabel: 'November 5, 2024',
			candidates: [],
			regions: baselineRegions,
			performance: []
		}
	},
	{
		id: 'us-president-2028',
		name: '2028 US President',
		category: 'us-wide',
		tags: ['president', '2028', 'us', 'usa', 'presidential', 'electoral college'],
		profile: {
			id: 'us-president-2028',
			label: '2028 US President',
			category: 'us-wide',
			geography: {
				svgPath: 'usa/usa-presidential-2028-blank.svg',
				filterAttr: null,
				filterValue: null,
				regionLabel: 'States'
			},
			sections: FULL_SECTIONS,
			subTabs: FULL_SUBTABS,
			expectedCandidates: [2, 6]
		},
		seed: {
			title: '2028 US President',
			dateLabel: 'November 7, 2028',
			candidates: [],
			regions: baselineRegions,
			performance: []
		}
	}
];
