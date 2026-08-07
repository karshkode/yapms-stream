/**
 * MRU queue of state abbrs the host has opened the StateRacesCard for.
 *
 * Mirrors savedRaces.recent's FIFO-with-dedupe semantics but for plain
 * state navigation rather than full race loads — clicking a state on
 * the browse-us map / regions panel pushes here, while clicking a
 * race button pushes to savedRaces.recent. The TopBar Recent dropdown
 * surfaces both lists side-by-side so the host can hop between
 * (state list, individual race) at click-speed.
 *
 * Cap matches MAX_RECENT in recent.ts so the two columns of the
 * dropdown stay visually balanced.
 */

const MAX_RECENT_STATES = 8;

export function pushRecentState(current: string[], abbr: string): string[] {
	const upper = abbr.toUpperCase();
	if (!upper) return current;
	const filtered = current.filter((a) => a.toUpperCase() !== upper);
	return [upper, ...filtered].slice(0, MAX_RECENT_STATES);
}
