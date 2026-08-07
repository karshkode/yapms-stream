import type { RaceTemplate } from '../race-profile';
import { FULL_SECTIONS, FULL_SUBTABS } from './defaults';

export const US_SENATE_TEMPLATES: RaceTemplate[] = [
	{
		id: 'us-senate-2024',
		name: '2024 US Senate',
		category: 'us-wide',
		tags: ['senate', 'us senate', '2024', 'class 1'],
		profile: {
			id: 'us-senate-2024',
			label: '2024 US Senate',
			category: 'us-wide',
			geography: {
				svgPath: 'usa/usa-senate-2024-blank.svg',
				filterAttr: null,
				filterValue: null,
				regionLabel: 'States'
			},
			sections: FULL_SECTIONS,
			subTabs: FULL_SUBTABS,
			expectedCandidates: [2, 4]
		},
		seed: {
			title: '2024 US Senate',
			dateLabel: 'November 5, 2024',
			candidates: [],
			regions: [],
			performance: []
		}
	},
	{
		id: 'us-senate-2026',
		name: '2026 US Senate (Class 2)',
		category: 'us-wide',
		tags: ['senate', 'us senate', '2026', 'class 2'],
		profile: {
			id: 'us-senate-2026',
			label: '2026 US Senate (Class 2)',
			category: 'us-wide',
			geography: {
				svgPath: 'usa/usa-senate-2026-blank.svg',
				filterAttr: null,
				filterValue: null,
				regionLabel: 'States'
			},
			sections: FULL_SECTIONS,
			subTabs: FULL_SUBTABS,
			expectedCandidates: [2, 4]
		},
		seed: {
			title: '2026 US Senate (Class 2)',
			dateLabel: 'November 3, 2026',
			candidates: [],
			regions: [],
			performance: []
		}
	}
];
