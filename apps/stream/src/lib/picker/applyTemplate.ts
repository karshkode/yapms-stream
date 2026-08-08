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
			dirty: false,
			// The shared map camera is a rectangle in the outgoing map's own
			// coordinates. Carried into a different geography it would frame
			// nowhere in particular, so the new race starts at full extent and the
			// first pan on the desk republishes.
			mapCamera: null,
			comparison: {
				...state.ui.comparison,
				// A new race gets a new answer to "compared to what?". The old
				// selection was about the race being replaced — a `history:` ref
				// naming an office this one isn't for, or a capture taken on another
				// state's map — so it reverts to the always-available presidential
				// margin and re-arms the automatic same-office pick, which upgrades
				// it as soon as this state's history loads. Captures themselves are
				// kept; only which one is active is reset.
				baselineRef: 'archival:2024',
				baselineAuto: true
			}
		}
	};
}
