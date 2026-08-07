import type { ArchivalByYear, RaceTemplate } from '../race-profile';
import usPresBaseline from './seed-data/us-presidential-archival.json';

/**
 * "Browse US" — the default homepage template. Renders the US states map with
 * zero candidates, zero tabs, and zero live polling so the host can click
 * straight into a state and get the `StateRacesCard` picker with civicAPI +
 * archival template options. It's effectively a navigation-only shell around
 * the same SVG the US President template uses.
 *
 * Reuses the 2008-2024 archival baselines so if the host scrubs the time
 * slider, the US map still paints historical colors. Keeps the map useful
 * for context while letting the host drill into any state for the races
 * that are actually on.
 *
 * Not surfaced in the picker's category list — it's an internal landing
 * template pinned as the default when no profile is selected (control/+page
 * applies it on boot and when the host clicks the title).
 */
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
	candidateVotes: {},
	archivalByYear: row.archivalByYear ?? {}
}));

export const BROWSE_US_TEMPLATE: RaceTemplate = {
	id: 'browse-us',
	name: 'Browse US races',
	category: 'us-wide',
	tags: ['browse', 'home', 'us', 'usa', 'navigation'],
	profile: {
		id: 'browse-us',
		label: 'Browse US',
		category: 'us-wide',
		geography: {
			svgPath: 'usa/usa-presidential-2024-blank.svg',
			filterAttr: null,
			filterValue: null,
			regionLabel: 'States'
		},
		sections: {
			header: false,
			candidates: false,
			performance: false,
			geography: true,
			regions: false
		},
		subTabs: ['Results'],
		expectedCandidates: [0, 0]
	},
	seed: {
		title: 'Click a state to see current races',
		dateLabel: '',
		candidates: [],
		regions: baselineRegions,
		performance: []
	}
};
