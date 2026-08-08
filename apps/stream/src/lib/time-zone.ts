/**
 * Which clock the broadcast runs on.
 *
 * An election night is told in the local time of the election. "Polls close at
 * 7" and "we should see Wayne County around 10" are statements about the
 * voters' clock, not the host's, so a Michigan result desk operated from Denver
 * that captions itself 8:14 PM MDT is telling the audience the wrong time about
 * their own election.
 *
 * The zone lives on `race.timeZone` so it travels with the race over the
 * BroadcastChannel and into saved races instead of being re-derived per
 * component. Null means "whatever clock this machine is on", which is the right
 * answer for a national race and is what everything did before.
 */

/**
 * Every US zone, in the vocabulary a host thinks in.
 *
 * Deliberately the canonical identifier per zone rather than the per-state ones
 * (`America/Detroit`, `America/Indiana/Indianapolis`, `America/Boise`), which
 * are aliases with identical rules — Indiana has observed DST since 2006. One
 * identifier per behaviour means the picker below can round-trip any race's
 * zone without a fallback branch for values it doesn't recognise.
 */
export const TIME_ZONE_CHOICES: ReadonlyArray<{ zone: string; label: string }> = [
	{ zone: 'America/New_York', label: 'Eastern' },
	{ zone: 'America/Chicago', label: 'Central' },
	{ zone: 'America/Denver', label: 'Mountain' },
	{ zone: 'America/Phoenix', label: 'Arizona (no DST)' },
	{ zone: 'America/Los_Angeles', label: 'Pacific' },
	{ zone: 'America/Anchorage', label: 'Alaska' },
	{ zone: 'Pacific/Honolulu', label: 'Hawaii' }
];

/**
 * The zone each state's own election coverage runs on.
 *
 * Fourteen states straddle two zones, so for them there is no strictly correct
 * single answer; the entry is the zone holding the population centre, the one a
 * station in that state would put on screen. Florida is Eastern because Miami,
 * Orlando and Jacksonville are. Texas is Central because everything but El Paso
 * is. Tennessee is Central for Nashville and Memphis even though Knoxville and
 * Chattanooga are Eastern, and Kentucky is Eastern for Louisville, Lexington
 * and Frankfort. Where that call is wrong for a particular race — a Panhandle
 * county commission, an El Paso mayoral — the host overrides it in the race
 * meta form.
 */
export const STATE_TIME_ZONES: Record<string, string> = {
	AL: 'America/Chicago',
	AK: 'America/Anchorage',
	AZ: 'America/Phoenix',
	AR: 'America/Chicago',
	CA: 'America/Los_Angeles',
	CO: 'America/Denver',
	CT: 'America/New_York',
	DC: 'America/New_York',
	DE: 'America/New_York',
	FL: 'America/New_York',
	GA: 'America/New_York',
	HI: 'Pacific/Honolulu',
	IA: 'America/Chicago',
	ID: 'America/Denver',
	IL: 'America/Chicago',
	IN: 'America/New_York',
	KS: 'America/Chicago',
	KY: 'America/New_York',
	LA: 'America/Chicago',
	MA: 'America/New_York',
	MD: 'America/New_York',
	ME: 'America/New_York',
	MI: 'America/New_York',
	MN: 'America/Chicago',
	MO: 'America/Chicago',
	MS: 'America/Chicago',
	MT: 'America/Denver',
	NC: 'America/New_York',
	ND: 'America/Chicago',
	NE: 'America/Chicago',
	NH: 'America/New_York',
	NJ: 'America/New_York',
	NM: 'America/Denver',
	NV: 'America/Los_Angeles',
	NY: 'America/New_York',
	OH: 'America/New_York',
	OK: 'America/Chicago',
	OR: 'America/Los_Angeles',
	PA: 'America/New_York',
	RI: 'America/New_York',
	SC: 'America/New_York',
	SD: 'America/Chicago',
	TN: 'America/Chicago',
	TX: 'America/Chicago',
	UT: 'America/Denver',
	VA: 'America/New_York',
	VT: 'America/New_York',
	WA: 'America/Los_Angeles',
	WI: 'America/Chicago',
	WV: 'America/New_York',
	WY: 'America/Denver'
};

/**
 * Zone for a two-letter postal code, or null when it isn't one we know.
 *
 * Null rather than a guess. Falling back to the host's clock is at least
 * visibly the host's clock, whereas defaulting an unrecognised territory to
 * Eastern would put a confident wrong time on screen.
 */
export function zoneForStateAbbr(abbr: string | null | undefined): string | null {
	if (!abbr) return null;
	return STATE_TIME_ZONES[abbr.trim().toUpperCase()] ?? null;
}

/**
 * Guard against a zone this runtime won't accept — a hand-edited state blob, or
 * an identifier retired between releases. Without it `Intl` throws on every
 * clock tick and takes the whole banner down mid-broadcast over a caption.
 */
function usableZone(zone: string | null | undefined): string | undefined {
	if (!zone) return undefined;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return zone;
	} catch {
		return undefined;
	}
}

/**
 * "9:41 PM EDT" for an instant, in the race's zone, falling back to this
 * machine's.
 *
 * The zone abbreviation isn't decoration. Once the time on screen can differ
 * from the host's own, that suffix is the only thing distinguishing 9:41 in one
 * zone from 9:41 in another.
 */
export function formatTimeInZone(instant: Date, zone: string | null | undefined): string {
	return instant.toLocaleTimeString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short',
		timeZone: usableZone(zone)
	});
}
