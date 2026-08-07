import type { RecentRaceRef, SavedRacesState } from '../stream-state';

/**
 * FIFO queue of the last races the host loaded (via any tab). Deduped by
 * templateId + parameter hash + civicApiRaceId so:
 *   - Re-loading the same civicAPI race just bumps its timestamp.
 *   - Loading the same archival template twice in a session also just bumps.
 *   - Loading a civicAPI race that happens to use the same template as
 *     another civicAPI race keeps both entries (different raceIds).
 *
 * Bumped to 8 to give civicAPI races room alongside recent templates —
 * the host tends to flip between several live races on election night.
 */

const MAX_RECENT = 8;

export function pushRecent(
	state: SavedRacesState,
	ref: Omit<RecentRaceRef, 'loadedAt'>
): SavedRacesState {
	const now = Date.now();
	const key = serialize(ref);
	const filtered = state.recent.filter((r) => serialize(r) !== key);
	const full: RecentRaceRef = {
		templateId: ref.templateId,
		label: ref.label,
		parameters: ref.parameters ?? {},
		civicApiRaceId: ref.civicApiRaceId ?? null,
		civicApiTitle: ref.civicApiTitle ?? null,
		subtitle: ref.subtitle ?? null,
		preselectCountyName: ref.preselectCountyName ?? null,
		loadedAt: now
	};
	return {
		...state,
		recent: [full, ...filtered].slice(0, MAX_RECENT)
	};
}

function serialize(
	ref: Pick<RecentRaceRef, 'templateId' | 'parameters' | 'civicApiRaceId'>
): string {
	return `${ref.templateId}|${JSON.stringify(ref.parameters ?? {})}|${ref.civicApiRaceId ?? ''}`;
}
