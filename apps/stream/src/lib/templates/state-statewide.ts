import type { RaceTemplate } from '../race-profile';
import { FULL_SECTIONS, RESULTS_ONLY, getStateSeed } from './defaults';
import { STATES } from './states';

/**
 * 50 state-statewide templates, one per state. Each filters the national
 * counties SVG down to the target state by `action-groups=<FIPS>` and seeds
 * region rows from baked county data (`seed-data/state-<FIPS>.json`). Used
 * for Governor / US Senate / AG / SoS / Treasurer / state-wide ballot
 * measures — the host relabels the title once loaded.
 */

function buildStatewide(stateFips: string, stateName: string, stateAbbr: string): RaceTemplate {
	const seed = getStateSeed(stateFips);
	return {
		id: `state-statewide-${stateFips}`,
		name: `${stateName} — Statewide`,
		category: 'statewide-primary',
		tags: [
			stateName.toLowerCase(),
			stateAbbr.toLowerCase(),
			stateFips,
			'statewide',
			'governor',
			'senate',
			'attorney general',
			'secretary of state',
			'treasurer'
		],
		profile: {
			id: `state-statewide-${stateFips}`,
			label: `${stateName} Statewide`,
			category: 'statewide-primary',
			geography: {
				svgPath: 'usa/usa-counties-2023-blank.svg',
				filterAttr: 'action-groups',
				filterValue: stateFips,
				regionLabel: 'Counties'
			},
			sections: FULL_SECTIONS,
			subTabs: RESULTS_ONLY,
			expectedCandidates: [2, 8]
		},
		seed: {
			title: `${stateName} Statewide Race`,
			dateLabel: '',
			candidates: [],
			regions: (seed?.counties ?? []).map((c) => ({
				name: c.name,
				regionAttr: c.regionAttr,
				leaderId: null,
				votes: 0,
				evr: 0,
				reportedPct: 0,
				totalReg: c.totalReg,
				candidateVotes: {},
				// Forward the baked multi-year archival baselines (2008-2024).
				// The slider in /control picks which year paints the map.
				archivalByYear: c.archivalByYear ?? {}
			})),
			performance: seed?.lastPresidentialMargin
				? [
						{
							raceName: `${seed.lastPresidentialMargin.year} President`,
							partyBadge:
								seed.lastPresidentialMargin.label.startsWith('Trump') ||
								seed.lastPresidentialMargin.label.startsWith('R')
									? 'R'
									: 'D',
							marginLabel: seed.lastPresidentialMargin.label,
							marginColor: seed.lastPresidentialMargin.color,
							shiftLabel: '-'
						}
					]
				: []
		}
	};
}

export const STATE_STATEWIDE_TEMPLATES: RaceTemplate[] = STATES.map((s) =>
	buildStatewide(s.fips, s.name, s.abbr)
);
