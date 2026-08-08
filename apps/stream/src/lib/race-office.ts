/**
 * Which office a loaded race is for, guessed from its title.
 *
 * There is nothing better to go on. One template serves every statewide race in
 * a state — governor, senator, attorney general, a ballot measure — so the
 * profile can't say, and the host renames the race as a matter of course
 * ("Michigan Statewide Race" becomes "Michigan US Senate" before they go on
 * air). Deriving it from the title means that rename is all it takes.
 *
 * A plain module rather than part of `map/office-history.svelte.ts`, where this
 * started, because the markets/polls lookup needs the same answer on the server
 * — and a `.svelte.ts` module carries runes a Node request handler can't run.
 */

export type RaceOffice = 'senate' | 'governor' | 'house';

export function officeFromTitle(title: string): RaceOffice | null {
	const t = title.toLowerCase();
	// "Lieutenant Governor" and "Governor's Council" are their own races, and
	// "Senate District 12" is a state senate seat, not the US Senate.
	if (/\blieutenant\b|\blt\.?\s+gov/.test(t)) return null;
	if (/\bgovernor\b|\bgubernatorial\b/.test(t)) return 'governor';
	if (/\bu\.?\s?s\.?\s+house\b|\bcongressional district\b|\b[a-z]{2}-\d{1,2}\b/.test(t)) {
		return 'house';
	}
	if (/\bdistrict\b|\bstate senate\b/.test(t)) return null;
	if (/\bu\.?\s?s\.?\s+senate\b|\bus senator\b|\bsenate\b|\bsenator\b/.test(t)) return 'senate';
	return null;
}

/**
 * True when the race is a primary rather than a general.
 *
 * Worth knowing separately from the office: a primary's field is same-party, so
 * a market or polling average for "the Michigan Senate race" is about the
 * general and would be the wrong number to caption a primary night with.
 */
export function isPrimaryTitle(title: string): boolean {
	return /\bprimary\b|\brunoff\b|\bcaucus\b/i.test(title);
}
