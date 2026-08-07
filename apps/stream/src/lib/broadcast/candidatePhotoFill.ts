import {
	isThrottled,
	lookupHeadshots,
	type HeadshotContext,
	type HeadshotHit
} from '$lib/data/candidatePhotos';
import type { StreamState } from '$lib/stream-state';
import { streamStore } from '$lib/stream-store.svelte';
import { STATES_BY_ABBR } from '$lib/templates/states';

/**
 * Glue between the Wikipedia headshot lookup and the live roster.
 *
 * Two call sites share this: the automatic pass on /control that runs whenever
 * a roster loads (gated on `ui.broadcast.autoPhotos`), and the Broadcast
 * panel's "Find photos" button. Both need the same context derivation and the
 * same progressive write-back, so it lives here rather than in either one.
 */

/** Words that describe the *contest* rather than the office, and only add noise
 *  to a people search. */
const CONTEST_WORDS =
	/\b(primary|general|runoff|special|election|elections|recall|convention|caucus|nonpartisan|unexpired|term)\b/gi;

/**
 * Turn the loaded race into search hints. The office wording comes from the
 * race title with the year and contest words stripped, so
 * "Kentucky Governor Republican Primary 2027" narrows to "Kentucky Governor
 * Republican" — enough to pull the right "Cameron" to the top without
 * over-constraining a full-text relevance search.
 */
export function headshotContext(state: StreamState): HeadshotContext {
	const abbr = state.ui.homeStateAbbr;
	const stateName = abbr ? (STATES_BY_ABBR[abbr.toUpperCase()]?.name ?? abbr) : null;
	const office = state.race.title
		.replace(/\b(19|20)\d{2}\b/g, ' ')
		.replace(CONTEST_WORDS, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return { state: stateName, office: office || null };
}

export interface FillOptions {
	/** Re-resolve candidates that already have a photo. Used by the manual
	 *  button so a host can replace a wrong face after clearing the cache. */
	force?: boolean;
	signal?: AbortSignal;
}

export interface FillResult {
	attempted: number;
	resolved: number;
	/** True when Wikipedia asked us to back off, so "0 resolved" means
	 *  "try again shortly" rather than "no photos exist". */
	throttled: boolean;
}

/**
 * Resolve headshots for the roster currently on the stage and write them back
 * as each one lands.
 *
 * Writes go straight to `streamStore` (the same pattern the stage components
 * use) and deliberately do NOT set `ui.dirty`. Dirty means "the host has taken
 * manual control", which makes the poll loop stop applying live candidate
 * updates — setting it here would freeze vote totals as the side effect of
 * fetching a picture. Photos survive poll ticks via `preserveHeadshots`
 * instead.
 */
export async function fillMissingHeadshots(options: FillOptions = {}): Promise<FillResult> {
	const roster = streamStore.state.candidates;
	const targets = roster.filter((c) => !c.hidden && (options.force || !c.headshotUrl));
	if (targets.length === 0) {
		return { attempted: 0, resolved: 0, throttled: isThrottled() };
	}

	const ctx = headshotContext(streamStore.state);
	let resolved = 0;

	const apply = (name: string, hit: HeadshotHit | null) => {
		if (!hit) return;
		// Re-read from the store rather than closing over `roster`: a poll tick
		// may have replaced the array while we were waiting on the network.
		const current = streamStore.state.candidates;
		const idx = current.findIndex((c) => c.name === name);
		if (idx === -1) return;
		if (current[idx].headshotUrl && !options.force) return;
		current[idx].headshotUrl = hit.url;
		current[idx].headshotCredit = hit.pageTitle;
		resolved++;
	};

	await lookupHeadshots(
		targets.map((c) => c.name),
		ctx,
		{ signal: options.signal, onResolved: apply }
	);

	return { attempted: targets.length, resolved, throttled: isThrottled() };
}
