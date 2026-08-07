import { v4 as uuid } from 'uuid';
import type { SavedRaceRef, SavedRacesState, StreamState } from '../stream-state';

/**
 * CRUD over the bookmarked races list. `state` on each SavedRaceRef is the
 * full StreamState at bookmark time so "Load" restores a race exactly as the
 * host saved it — candidates, manual vote overrides, visibility toggles,
 * polling config, everything.
 */

export function saveRace(
	savedRaces: SavedRacesState,
	input: {
		label: string;
		templateId: string | null;
		parameters?: Record<string, string>;
		state: StreamState;
	}
): SavedRacesState {
	const ref: SavedRaceRef = {
		id: uuid(),
		label: input.label,
		templateId: input.templateId,
		parameters: input.parameters ?? {},
		savedAt: Date.now(),
		state: input.state
	};
	return { ...savedRaces, bookmarked: [ref, ...savedRaces.bookmarked] };
}

export function renameSaved(
	savedRaces: SavedRacesState,
	id: string,
	label: string
): SavedRacesState {
	return {
		...savedRaces,
		bookmarked: savedRaces.bookmarked.map((r) => (r.id === id ? { ...r, label } : r))
	};
}

export function duplicateSaved(savedRaces: SavedRacesState, id: string): SavedRacesState {
	const source = savedRaces.bookmarked.find((r) => r.id === id);
	if (!source) return savedRaces;
	const copy: SavedRaceRef = {
		...source,
		id: uuid(),
		label: `${source.label} (copy)`,
		savedAt: Date.now()
	};
	return { ...savedRaces, bookmarked: [copy, ...savedRaces.bookmarked] };
}

export function deleteSaved(savedRaces: SavedRacesState, id: string): SavedRacesState {
	return {
		...savedRaces,
		bookmarked: savedRaces.bookmarked.filter((r) => r.id !== id)
	};
}
