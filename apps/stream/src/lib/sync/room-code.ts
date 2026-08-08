/**
 * The short code that decides which desk an overlay is watching.
 *
 * Sync started as a BroadcastChannel, which reaches other tabs in the same
 * browser and nothing else. That was fine when the host, the desk and the OBS
 * source were one Chrome profile, and it quietly isn't for anything real: OBS
 * renders its Browser Source in its own embedded browser, so it was never
 * receiving anything, and a second person opening /overlay from their phone got
 * their own empty copy of the app rather than the host's race.
 *
 * A room code fixes both by routing state through the server this app already
 * runs. It is deliberately a code and not a login: the desk generates one on
 * first boot, the overlay URL carries it, and pasting that URL into OBS is the
 * entire setup. Two hosts on the same machine get different codes without
 * doing anything, so their sessions can't collide — which is the failure this
 * is here to prevent.
 *
 * Four characters from an alphabet with no I/O/0/1, because the one time
 * somebody has to read this aloud or type it from a screenshot is the moment it
 * matters.
 */

const STORAGE_KEY = 'yapms-stream:room';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 4;

export function randomRoomCode(): string {
	let out = '';
	const bytes = new Uint8Array(LENGTH);
	crypto.getRandomValues(bytes);
	for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
	return out;
}

/** Uppercase, alphabet-only, length-capped. Anything else isn't a room. */
export function normalizeRoomCode(raw: string | null | undefined): string {
	if (!raw) return '';
	return raw
		.toUpperCase()
		.split('')
		.filter((ch) => ALPHABET.includes(ch))
		.join('')
		.slice(0, 8);
}

/**
 * This desk's room, creating and remembering one on first call.
 *
 * Persisted per browser profile rather than per tab, so reloading /control
 * doesn't orphan the OBS source that was pointed at the old code.
 */
export function deskRoomCode(): string {
	if (typeof localStorage === 'undefined') return '';
	const saved = normalizeRoomCode(localStorage.getItem(STORAGE_KEY));
	if (saved) return saved;
	const fresh = randomRoomCode();
	localStorage.setItem(STORAGE_KEY, fresh);
	return fresh;
}

export function setDeskRoomCode(code: string): string {
	const normalized = normalizeRoomCode(code);
	if (!normalized || typeof localStorage === 'undefined') return deskRoomCode();
	localStorage.setItem(STORAGE_KEY, normalized);
	return normalized;
}

/**
 * The room an overlay should watch, from its own URL.
 *
 * Empty when the URL carries no code, which keeps the old same-browser
 * behaviour working for anyone who has /overlay bookmarked without one.
 */
export function roomFromUrl(search: string): string {
	return normalizeRoomCode(new URLSearchParams(search).get('room'));
}
