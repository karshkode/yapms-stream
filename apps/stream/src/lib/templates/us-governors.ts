import type { RaceTemplate } from '../race-profile';
import { FULL_SECTIONS, FULL_SUBTABS } from './defaults';

export const US_GOVERNORS_TEMPLATES: RaceTemplate[] = [
	{
		id: 'us-governors-2026',
		name: '2026 US Governors',
		category: 'us-wide',
		tags: ['governor', 'governors', '2026', 'us'],
		profile: {
			id: 'us-governors-2026',
			label: '2026 US Governors',
			category: 'us-wide',
			geography: {
				svgPath: 'usa/usa-governors-2026-blank.svg',
				filterAttr: null,
				filterValue: null,
				regionLabel: 'States'
			},
			sections: FULL_SECTIONS,
			subTabs: FULL_SUBTABS,
			expectedCandidates: [2, 4]
		},
		seed: {
			title: '2026 US Governors',
			dateLabel: 'November 3, 2026',
			candidates: [],
			regions: [],
			performance: []
		}
	},
	{
		id: 'us-governors-2024',
		name: '2024 US Governors',
		category: 'us-wide',
		tags: ['governor', 'governors', '2024', 'us'],
		profile: {
			id: 'us-governors-2024',
			label: '2024 US Governors',
			category: 'us-wide',
			geography: {
				svgPath: 'usa/usa-governors-2024-blank.svg',
				filterAttr: null,
				filterValue: null,
				regionLabel: 'States'
			},
			sections: FULL_SECTIONS,
			subTabs: FULL_SUBTABS,
			expectedCandidates: [2, 4]
		},
		seed: {
			title: '2024 US Governors',
			dateLabel: 'November 5, 2024',
			candidates: [],
			regions: [],
			performance: []
		}
	}
];
