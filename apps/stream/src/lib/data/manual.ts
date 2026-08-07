import { StreamState } from '../stream-state';
import type { DataSource, DataSourceKind, StreamStatePatch } from './source';

/**
 * Manual adapter.
 *
 * The host enters everything on /control via forms. There's no network; this
 * adapter simply echoes the current StreamState back as the "manual layer" of
 * the merge. Manual always wins over live / seed.
 */
export class ManualSource implements DataSource {
	kind: DataSourceKind = 'manual';

	toPatch(state: StreamState): StreamStatePatch {
		return {
			race: state.race,
			candidates: state.candidates,
			performance: state.performance,
			regions: state.regions
		};
	}
}

export const manual = new ManualSource();

/**
 * localStorage helpers for persisting the manual layer plus saved-race
 * bookmarks across refreshes. Lives here (rather than in the store) so the
 * same serialization is reusable from an export-to-JSON button.
 */

const STATE_KEY = 'yapms-stream:state';
const RACES_KEY = 'yapms-stream:saved-races';

export function loadPersistedState(): StreamState | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(STATE_KEY);
	if (!raw) return null;
	try {
		// Run through Zod (`StreamState.parse`) so any new fields added since
		// the user last saved get their default values applied. The previous
		// raw `JSON.parse(...) as StreamState` skipped Zod entirely, so stale
		// localStorage from before a schema bump came back with missing
		// fields — most recently `ui.detailCardCorner`, which left the
		// detail-slot CSS class as "corner-undefined" and the StateRacesCard
		// invisibly positioned with no top/left set.
		const parsed = JSON.parse(raw);
		const result = StreamState.safeParse(parsed);
		if (result.success) return result.data;
		console.warn(
			'Persisted state failed validation, falling back to defaults',
			result.error.issues
		);
		return null;
	} catch (err) {
		console.warn('Failed to parse persisted state', err);
		return null;
	}
}

export function persistState(state: StreamState): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STATE_KEY, JSON.stringify(state));
	} catch (err) {
		console.warn('Failed to persist state', err);
	}
}

export function loadSavedRaces(): Record<string, StreamState> {
	if (typeof localStorage === 'undefined') return {};
	const raw = localStorage.getItem(RACES_KEY);
	if (!raw) return {};
	try {
		return JSON.parse(raw) as Record<string, StreamState>;
	} catch {
		return {};
	}
}

export function saveRace(id: string, state: StreamState): void {
	const all = loadSavedRaces();
	all[id] = state;
	localStorage.setItem(RACES_KEY, JSON.stringify(all));
}

export function deleteSavedRace(id: string): void {
	const all = loadSavedRaces();
	delete all[id];
	localStorage.setItem(RACES_KEY, JSON.stringify(all));
}
