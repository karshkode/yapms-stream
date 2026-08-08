import type { RaceTemplate } from '../race-profile';
import type { StreamState } from '../stream-state';

/**
 * Stamp a RaceTemplate's profile + seed onto a StreamState in place.
 *
 * Wipes the current candidate / region / performance lists and the race meta
 * so the host starts from the template. The UI dirty-tracks subsequent edits
 * via `state.ui.dirty`.
 */
export function applyTemplate(state: StreamState, template: RaceTemplate): StreamState {
	return {
		...state,
		profile: template.profile,
		race: {
			...state.race,
			title: template.seed.title ?? state.race.title,
			partyBadge: template.seed.partyBadge ?? state.race.partyBadge,
			partyBadgeColor: template.seed.partyBadgeColor ?? state.race.partyBadgeColor,
			pollsCloseLabel: template.seed.pollsCloseLabel ?? '',
			dateLabel: template.seed.dateLabel ?? '',
			decisionMadeLabel: null,
			reportedPctLabel: null,
			reportedPct: null,
			totalVotes: null,
			// Null rather than keeping the outgoing race's zone: a template with
			// no zone of its own is either national or unplaced, and inheriting
			// Kentucky's clock into a presidential map would be worse than
			// falling back to the host's.
			timeZone: template.seed.timeZone ?? null
		},
		candidates: [...template.seed.candidates],
		regions: [...template.seed.regions],
		performance: [...template.seed.performance],
		ui: {
			...state.ui,
			candidatesExpanded: false,
			regionsPage: 1,
			regionsSearch: '',
			dirty: false
		}
	};
}
