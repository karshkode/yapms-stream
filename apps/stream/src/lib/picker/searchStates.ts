import { STATES, type StateMeta } from '../templates/states';

/**
 * Match a free-text query against the state list so the race search can offer
 * "everything happening in <state>" as a first-class result.
 *
 * Typing a state is the most common way the host looks for a race ("kentucky",
 * "ky", "new mex"), but civicAPI's `/race/search?query=` only matches on
 * `election_name`. A query of "kentucky" therefore misses every Kentucky race
 * whose title doesn't literally contain the word — which is most of them, since
 * titles read "Louisville Mayor" or "US Senate". Surfacing the state itself as a
 * result lets the host pivot into the state-scoped civicAPI lookup
 * (`searchRacesByState`, which filters on `province`) instead of dead-ending.
 */

export interface StateHit {
	state: StateMeta;
	score: number;
}

export function searchStates(query: string, limit = 5): StateHit[] {
	const q = query.trim().toLowerCase();
	// One character matches a third of the country, which buries the race
	// results under a wall of state rows on the first keystroke.
	if (q.length < 2) return [];

	const hits: StateHit[] = [];
	for (const state of STATES) {
		const name = state.name.toLowerCase();
		let score = 0;
		if (q === state.abbrLower || q === name) score = 5;
		else if (name.startsWith(q)) score = 4;
		// Word-start match so "mexico", "carolina" and "dakota" reach the
		// multi-word states without typing the qualifier first.
		else if (name.split(' ').some((word) => word.startsWith(q))) score = 3;
		else if (name.includes(q)) score = 2;
		if (score > 0) hits.push({ state, score });
	}

	hits.sort((a, b) => b.score - a.score || a.state.name.localeCompare(b.state.name));
	return hits.slice(0, limit);
}
