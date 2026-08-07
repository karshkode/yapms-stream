import type { FollowedRace } from '$lib/stream-state';

/**
 * Pure list operations for the ticker's followed races. Shared by the Broadcast
 * panel and the state-races card so "follow" means the same thing wherever the
 * host clicks it.
 */

/**
 * Ceiling on followed races. Two reasons, both practical: one poll pass fetches
 * every followed race in series, so a long list stretches the time between
 * refreshes of any single race; and a crawl carrying more than a dozen items
 * takes so long to come round that a viewer never sees the race they're
 * waiting for.
 */
export const MAX_FOLLOWED = 12;

export function isFollowed(list: FollowedRace[], raceId: string): boolean {
	return list.some((f) => f.raceId === raceId);
}

export interface FollowSeed {
	raceId: string;
	label: string;
	state?: string | null;
}

/**
 * Append a race, or return the list untouched when it's already followed or
 * full. Tallies start empty and get filled in by the first poll pass, so a
 * newly-followed race shows up in the crawl within one cadence rather than
 * blocking the click on a network round-trip.
 */
export function followRace(list: FollowedRace[], seed: FollowSeed): FollowedRace[] {
	if (!seed.raceId || isFollowed(list, seed.raceId) || list.length >= MAX_FOLLOWED) return list;
	return [
		...list,
		{
			raceId: seed.raceId,
			label: seed.label,
			state: seed.state ?? null,
			reportedPct: null,
			candidates: [],
			updatedAt: null,
			lastError: null
		}
	];
}

export function unfollowRace(list: FollowedRace[], raceId: string): FollowedRace[] {
	return list.filter((f) => f.raceId !== raceId);
}

/** Move an entry by `delta` positions, clamped to the ends. Crawl order is the
 *  host's editorial call — the race they're about to talk about goes first. */
export function moveFollowed(list: FollowedRace[], raceId: string, delta: number): FollowedRace[] {
	const idx = list.findIndex((f) => f.raceId === raceId);
	if (idx === -1) return list;
	const target = Math.max(0, Math.min(list.length - 1, idx + delta));
	if (target === idx) return list;
	const next = [...list];
	const [row] = next.splice(idx, 1);
	next.splice(target, 0, row);
	return next;
}
