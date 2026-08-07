import type { RaceListEntry } from '../data/source';
import { listAvailableSvgs } from '../map/load-svg';
import type { RaceTemplate } from '../race-profile';
import { STATES_BY_ABBR } from '../templates/states';
import { TEMPLATES_BY_ID } from '../templates';
import { makeStateLegTemplate } from '../templates/state-leg';
import { makeUsHouseTemplate } from '../templates/us-house';

/**
 * Map a civicAPI race list entry to the best-fit RaceTemplate + parameters.
 *
 * Priority order (first match wins):
 *   1. Presidential  → us-president of the matching cycle.
 *   2. US House + district → us-house parameterized.
 *   3. State House / Senate + district → state-leg parameterized IF we ship
 *      an SVG for that state; else fall through to (4) so the host still
 *      gets a county-level map rather than a blank no-map shell.
 *   4. Any statewide office (Governor, US Senate, AG, SoS, Treasurer,
 *      ballot measure, state supreme court, etc.) → state-statewide, which
 *      renders the state's county map.
 *   5. Local races with an identifiable state → state-statewide so the host
 *      can still zoom into the region the race covers. This is a deliberate
 *      upgrade from the old behavior (always fall to local-no-map) because
 *      a county map with no live data plotted is still more useful than a
 *      dead stage for a "Fort Bend County Sheriff" race.
 *   6. Truly unplaceable → local-no-map.
 *
 * The result also carries an optional `preselectCountyName` — the civicAPI
 * `district` field verbatim ("Delaware", "Dallas", "Fountain", ...). When
 * present, the picker's apply path matches it against the resolved
 * template's seeded regions and stamps `ui.selectedRegionAttr` so the stage
 * auto-zooms to that county. Without the hint the host would land on an
 * unfocused statewide map for a race that only covers a single town.
 *
 * The resolver is pure — no network I/O — because the picker calls it
 * synchronously while rendering. `listAvailableSvgs()` is a glob-imported
 * constant built at module init, so the SVG-presence check is O(1).
 */

export interface ResolvedCivicRace {
	template: RaceTemplate;
	/** County name from civicAPI's `district` field, or null when not a
	 *  county-scoped race (e.g. US-wide presidential, statewide governor).
	 *  The apply flow uses fuzzy name matching against the template's
	 *  seeded regions to turn this into a `regionAttr` like "Delaware18".
	 */
	preselectCountyName: string | null;
}

// Precompute: which (state × chamber) pairs do we actually have SVGs for?
// State-leg SVGs are named `usa/usa-<abbrLower>_<chamber>-<YYYY>-blank.svg`;
// we strip the year and index by (abbr, chamber). Lets the resolver decide
// in O(1) whether a state-house race can show a district map.
const STATE_LEG_MAP_INDEX: Map<string, string> = (() => {
	const idx = new Map<string, string>();
	for (const key of listAvailableSvgs()) {
		// e.g. "usa/usa-ri_lower-2022-blank.svg" -> abbrLower="ri" chamber="lower"
		const m = /^usa\/usa-([a-z]{2})_(lower|upper)-\d+-blank\.svg$/.exec(key);
		if (m) idx.set(`${m[1]}_${m[2]}`, key);
	}
	return idx;
})();

export function resolveCivicApiRace(entry: RaceListEntry): ResolvedCivicRace | null {
	const template = resolveTemplate(entry);
	if (!template) return null;

	// A "county preselect" only makes sense when the resolved map is a county
	// map — i.e. the state-statewide category. Presidential (50-state), US
	// House (single-district), and state-leg (single-district) maps all
	// already fill-frame their geography, so injecting a county hint would
	// target a region that isn't in the map.
	const isCountyMap = template.profile.geography?.regionLabel === 'Counties';
	const hint = isCountyMap ? derivePreselectCounty(entry) : null;
	return { template, preselectCountyName: hint };
}

/**
 * Pick the best "which county is this race in?" hint from a civicAPI entry.
 *
 * Priority order (first non-empty wins):
 *   1. `entry.district` — most civicAPI local races stamp the county here
 *      ("Delaware", "Fountain", "Dallas"). Clean, direct.
 *   2. County name extracted from the race title — covers races whose
 *      `district` field is something like "Precinct 4" instead of the county,
 *      e.g. "Colorado County Commissioner Precinct 4" → county="Colorado".
 *      This was the "Colorado County TX race loads Texas but doesn't zoom
 *      in" bug: the state was right but the county hint was missing.
 *   3. `entry.municipality` — weakest signal, often contains a city name that
 *      isn't itself a county ("Yorktown"), but worth trying when the first
 *      two fail. findRegionAttrByName's fuzzy match will drop it if nothing
 *      in the state's region list even starts with that name.
 */
function derivePreselectCounty(entry: RaceListEntry): string | null {
	const fromDistrict = entry.district?.trim();
	// Reject district values that clearly aren't county names — precincts,
	// wards, seats, ballot-measure shorthand. These would just fail the
	// fuzzy match anyway, but rejecting them here lets step 2 (title parse)
	// fire instead of being skipped.
	if (fromDistrict && !/(precinct|ward|seat|position|place|district|at\s?-?large|proposition|amendment|measure)\s*\d*/i.test(fromDistrict)) {
		return fromDistrict;
	}
	const fromTitle = extractCountyFromTitle(entry.title);
	if (fromTitle) return fromTitle;
	const fromMun = entry.municipality?.trim();
	if (fromMun) return fromMun;
	return null;
}

/**
 * Pull a county name out of a race title for county-office races. Handles
 * the common formats:
 *   "Colorado County Commissioner Precinct 4 Republican Primary" → "Colorado"
 *   "Harris County Sheriff" → "Harris"
 *   "Miami-Dade County Judge Group 2" → "Miami-Dade"
 *   "St. Clair County Clerk" → "St. Clair"
 * The county-office keyword list comes from a practical survey of civicAPI
 * titles — any elected county-level office with a US-wide naming convention.
 * Returns null when the title doesn't follow "<County> County <Office>".
 */
function extractCountyFromTitle(title: string): string | null {
	// Accept letters, spaces, periods, hyphens, apostrophes in the county
	// name. Lazy match so we stop at the first " County " occurrence.
	const m = /^([A-Za-z\u00c0-\u024f][A-Za-z\u00c0-\u024f.\-'\s]*?)\s+County\s+(commissioner|sheriff|judge|clerk|assessor|treasurer|recorder|auditor|attorney|coroner|surveyor|constable|executive|mayor|board|council|court|supervisor|comptroller|prosecutor|district\s+attorney|superintendent)/i.exec(
		title
	);
	if (!m) return null;
	return m[1].trim();
}

function resolveTemplate(entry: RaceListEntry): RaceTemplate | null {
	const state = entry.state ? STATES_BY_ABBR[entry.state.toUpperCase()] : null;
	const title = entry.title.toLowerCase();
	const year = extractYear(entry.date);

	if (title.includes('president')) {
		return TEMPLATES_BY_ID[`us-president-${year ?? 2024}`] ?? null;
	}

	// US House federal (has "US House" or "Congressional District" in title).
	if (/(us house|u\.s\. house|congressional district|congress\b)/i.test(title) && state) {
		const districtNumber = extractDistrict(title);
		if (districtNumber) {
			return makeUsHouseTemplate({
				congress: 119,
				stateAbbr: state.abbr,
				districtNumber
			});
		}
	}

	// State legislative. Match "State House", "State Senate", "State Assembly"
	// (NY naming), and the shorthand "HD 135" / "SD 14". Fall through to
	// statewide if we can't pin a district or don't have an SVG.
	const stateLeg = detectStateLeg(title);
	if (stateLeg && state) {
		const mapKey = `${state.abbrLower}_${stateLeg.chamber}`;
		if (STATE_LEG_MAP_INDEX.has(mapKey)) {
			return makeStateLegTemplate({
				stateAbbr: state.abbr,
				chamber: stateLeg.chamber,
				districtNumber: stateLeg.district
			});
		}
		// We know it's a state-leg race but don't have a district-level map.
		// Fall through to the state's county map so the host gets *some*
		// geographic context rather than a blank stage.
	}

	// Any US House race without a district number, or unmatched federal
	// chamber race with a state — use the state's county map as a reasonable
	// fallback.
	if (/(us senate|u\.s\. senate|us house|u\.s\. house)/i.test(title) && state) {
		return TEMPLATES_BY_ID[`state-statewide-${state.fips}`] ?? null;
	}

	// Statewide offices.
	if (
		state &&
		/(governor|senate|attorney general|secretary of state|treasurer|comptroller|supreme court|land commissioner|agriculture commissioner|insurance commissioner|railroad commissioner|state board|public service|labor commissioner|auditor|ballot measure|proposition|amendment)/i.test(
			title
		)
	) {
		return TEMPLATES_BY_ID[`state-statewide-${state.fips}`] ?? null;
	}

	// Local / city / county races. When we know the state, prefer the state's
	// county map — even without district-level tie-in, the host can manually
	// zoom into the county where the city sits (e.g. Allen Mayor → zoom
	// Collin County on the TX map). Falls back to local-no-map only when we
	// can't even place the state, which in practice never happens because
	// civicAPI always stamps `province`.
	if (state) {
		return TEMPLATES_BY_ID[`state-statewide-${state.fips}`] ?? null;
	}

	return TEMPLATES_BY_ID['local-no-map'] ?? null;
}

/**
 * Fuzzy-match a civicAPI county label (e.g. "St. Clair", "De Kalb", "La Porte")
 * against a template's seeded regions and return the matching `regionAttr`
 * ("StClair48", "DeKalb18", "LaPorte18"). Handles:
 *   - whitespace / period / apostrophe / hyphen stripping ("St. Clair" ≈ "StClair")
 *   - "LaPorte" ≈ "La Porte", "DeKalb" ≈ "De Kalb"
 *   - case-insensitive comparison
 *   - trailing FIPS suffix on the regionAttr ("Delaware18" matches "Delaware")
 * Returns null when no region's normalized name starts with the normalized
 * query — better to leave the map unfocused than to auto-zoom to the wrong
 * county.
 */
export function findRegionAttrByName(
	regions: ReadonlyArray<{ name: string; regionAttr: string }>,
	countyName: string
): string | null {
	const normalize = (s: string) =>
		s.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, '');
	const target = normalize(countyName);
	if (!target) return null;

	// Exact normalized match preferred; fall back to startsWith so "Delaware"
	// matches "Delaware County" if civicAPI ever stamps the suffix.
	let exact: string | null = null;
	let prefix: string | null = null;
	for (const r of regions) {
		const name = normalize(r.name);
		if (name === target) {
			exact = r.regionAttr;
			break;
		}
		if (!prefix && (name.startsWith(target) || target.startsWith(name))) {
			prefix = r.regionAttr;
		}
	}
	return exact ?? prefix;
}

/** Match "State House", "State Senate", "Assembly", or "HD/SD ###". */
function detectStateLeg(title: string): { chamber: 'lower' | 'upper'; district: string } | null {
	// Prefer explicit "State House N" / "State Senate N" / "Assembly N".
	// Regexes are order-sensitive: check upper first so we don't mistake
	// "state senate" for "state house".
	const upperMatch =
		/state\s+senate\s+(?:district\s+)?(\d+)/i.exec(title) ??
		/\bsd[\s-]?(\d+)\b/i.exec(title);
	if (upperMatch) return { chamber: 'upper', district: upperMatch[1] };

	const lowerMatch =
		/state\s+house\s+(?:district\s+)?(\d+)/i.exec(title) ??
		/state\s+assembly\s+(?:district\s+)?(\d+)/i.exec(title) ??
		/general\s+assembly\s+(?:district\s+)?(\d+)/i.exec(title) ??
		/house\s+of\s+delegates\s+(?:district\s+)?(\d+)/i.exec(title) ??
		/\bhd[\s-]?(\d+)\b/i.exec(title);
	if (lowerMatch) return { chamber: 'lower', district: lowerMatch[1] };

	return null;
}

function extractDistrict(title: string): string | null {
	const m =
		/district\s*(\d+)/i.exec(title) ??
		/\b-(\d+)$/i.exec(title) ??
		/\b(\d+)(?:st|nd|rd|th)?\s*(?:congressional\s+)?district/i.exec(title);
	return m?.[1] ?? null;
}

function extractYear(dateIso: string | undefined): number | null {
	if (!dateIso) return null;
	const m = /(\d{4})/.exec(dateIso);
	return m ? Number(m[1]) : null;
}
