/**
 * Curated list of major US cities, each anchored to the `region` attribute of
 * its parent county in the yapms SVG basemaps. Used by the stage map overlay
 * to draw a city-marker layer on top of the colored counties so the host can
 * orient "which blob is Dallas?" at a glance.
 *
 * Tiers:
 *   1 — mega (top ~20 cities): always visible, even on the zoomed-out
 *       national map.
 *   2 — major (top ~50): visible when zoomed in to statewide scale or
 *       tighter.
 *   3 — secondary: only rendered when the host has already zoomed deep into
 *       a county/district.
 *
 * regionAttr follows the yapms convention `<CountyName><FIPS>` with the
 * specific quirks the SVGs use (e.g. `Miami-Dade12` keeps its hyphen,
 * `BaltimoreCity24` is one word, `St. Louis City29` preserves the period
 * and space). When a city's parent county isn't in the currently-loaded
 * SVG (e.g. state maps filter to a single state's counties), the overlay
 * silently skips it rather than error.
 */

export interface UsCity {
	name: string;
	regionAttr: string;
	state: string;
	tier: 1 | 2 | 3;
}

export const US_CITIES: UsCity[] = [
	// ─── Tier 1: megacities (always on) ──────────────────────────────────
	{ name: 'New York', regionAttr: 'New York36', state: 'NY', tier: 1 },
	{ name: 'Los Angeles', regionAttr: 'Los Angeles06', state: 'CA', tier: 1 },
	{ name: 'Chicago', regionAttr: 'Cook17', state: 'IL', tier: 1 },
	{ name: 'Houston', regionAttr: 'Harris48', state: 'TX', tier: 1 },
	{ name: 'Phoenix', regionAttr: 'Maricopa04', state: 'AZ', tier: 1 },
	{ name: 'Philadelphia', regionAttr: 'Philadelphia42', state: 'PA', tier: 1 },
	{ name: 'San Antonio', regionAttr: 'Bexar48', state: 'TX', tier: 1 },
	{ name: 'San Diego', regionAttr: 'San Diego06', state: 'CA', tier: 1 },
	{ name: 'Dallas', regionAttr: 'Dallas48', state: 'TX', tier: 1 },
	{ name: 'Austin', regionAttr: 'Travis48', state: 'TX', tier: 1 },
	{ name: 'Jacksonville', regionAttr: 'Duval12', state: 'FL', tier: 1 },
	{ name: 'Fort Worth', regionAttr: 'Tarrant48', state: 'TX', tier: 1 },
	{ name: 'San Jose', regionAttr: 'Santa Clara06', state: 'CA', tier: 1 },
	{ name: 'Columbus', regionAttr: 'Franklin39', state: 'OH', tier: 1 },
	{ name: 'Charlotte', regionAttr: 'Mecklenburg37', state: 'NC', tier: 1 },
	{ name: 'Indianapolis', regionAttr: 'Marion18', state: 'IN', tier: 1 },
	{ name: 'San Francisco', regionAttr: 'San Francisco06', state: 'CA', tier: 1 },
	{ name: 'Seattle', regionAttr: 'King53', state: 'WA', tier: 1 },
	{ name: 'Denver', regionAttr: 'Denver08', state: 'CO', tier: 1 },
	{ name: 'Washington, DC', regionAttr: 'District of Columbia11', state: 'DC', tier: 1 },
	{ name: 'Boston', regionAttr: 'Suffolk25', state: 'MA', tier: 1 },
	{ name: 'Atlanta', regionAttr: 'Fulton13', state: 'GA', tier: 1 },
	{ name: 'Miami', regionAttr: 'Miami-Dade12', state: 'FL', tier: 1 },
	{ name: 'Detroit', regionAttr: 'Wayne26', state: 'MI', tier: 1 },
	{ name: 'Minneapolis', regionAttr: 'Hennepin27', state: 'MN', tier: 1 },

	// ─── Tier 2: major cities (shown statewide zoom and up) ─────────────
	{ name: 'Nashville', regionAttr: 'Davidson47', state: 'TN', tier: 2 },
	{ name: 'Oklahoma City', regionAttr: 'Oklahoma40', state: 'OK', tier: 2 },
	{ name: 'El Paso', regionAttr: 'El Paso48', state: 'TX', tier: 2 },
	{ name: 'Portland', regionAttr: 'Multnomah41', state: 'OR', tier: 2 },
	{ name: 'Las Vegas', regionAttr: 'Clark32', state: 'NV', tier: 2 },
	{ name: 'Memphis', regionAttr: 'Shelby47', state: 'TN', tier: 2 },
	{ name: 'Louisville', regionAttr: 'Jefferson21', state: 'KY', tier: 2 },
	{ name: 'Baltimore', regionAttr: 'BaltimoreCity24', state: 'MD', tier: 2 },
	{ name: 'Milwaukee', regionAttr: 'Milwaukee55', state: 'WI', tier: 2 },
	{ name: 'Albuquerque', regionAttr: 'Bernalillo35', state: 'NM', tier: 2 },
	{ name: 'Tucson', regionAttr: 'Pima04', state: 'AZ', tier: 2 },
	{ name: 'Fresno', regionAttr: 'Fresno06', state: 'CA', tier: 2 },
	{ name: 'Sacramento', regionAttr: 'Sacramento06', state: 'CA', tier: 2 },
	{ name: 'Kansas City', regionAttr: 'Jackson29', state: 'MO', tier: 2 },
	{ name: 'Raleigh', regionAttr: 'Wake37', state: 'NC', tier: 2 },
	{ name: 'Omaha', regionAttr: 'Douglas31', state: 'NE', tier: 2 },
	{ name: 'Oakland', regionAttr: 'Alameda06', state: 'CA', tier: 2 },
	{ name: 'Virginia Beach', regionAttr: 'Virginia Beach51', state: 'VA', tier: 2 },
	{ name: 'Tulsa', regionAttr: 'Tulsa40', state: 'OK', tier: 2 },
	{ name: 'Tampa', regionAttr: 'Hillsborough12', state: 'FL', tier: 2 },
	{ name: 'New Orleans', regionAttr: 'Orleans22', state: 'LA', tier: 2 },
	{ name: 'Wichita', regionAttr: 'Sedgwick20', state: 'KS', tier: 2 },
	{ name: 'Cleveland', regionAttr: 'Cuyahoga39', state: 'OH', tier: 2 },
	{ name: 'Honolulu', regionAttr: 'Honolulu15', state: 'HI', tier: 2 },
	{ name: 'Anaheim', regionAttr: 'Orange06', state: 'CA', tier: 2 },
	{ name: 'Lexington', regionAttr: 'Fayette21', state: 'KY', tier: 2 },
	{ name: 'Stockton', regionAttr: 'San Joaquin06', state: 'CA', tier: 2 },
	{ name: 'Cincinnati', regionAttr: 'Hamilton39', state: 'OH', tier: 2 },
	{ name: 'St. Louis', regionAttr: 'St. Louis City29', state: 'MO', tier: 2 },
	{ name: 'Pittsburgh', regionAttr: 'Allegheny42', state: 'PA', tier: 2 },
	{ name: 'Saint Paul', regionAttr: 'Ramsey27', state: 'MN', tier: 2 },
	{ name: 'Anchorage', regionAttr: 'Anchorage02', state: 'AK', tier: 2 },
	{ name: 'Orlando', regionAttr: 'Orange12', state: 'FL', tier: 2 },
	{ name: 'Newark', regionAttr: 'Essex34', state: 'NJ', tier: 2 },
	{ name: 'Buffalo', regionAttr: 'Erie36', state: 'NY', tier: 2 },
	{ name: 'Boise', regionAttr: 'Ada16', state: 'ID', tier: 2 },
	{ name: 'Richmond', regionAttr: 'Richmond51-02', state: 'VA', tier: 2 },

	// ─── Tier 3: state capitals + secondary cities (deep zoom) ───────────
	{ name: 'Salt Lake City', regionAttr: 'Salt Lake49', state: 'UT', tier: 3 },
	{ name: 'Hartford', regionAttr: 'Hartford09', state: 'CT', tier: 3 },
	{ name: 'Providence', regionAttr: 'Providence44', state: 'RI', tier: 3 },
	{ name: 'Jersey City', regionAttr: 'Hudson34', state: 'NJ', tier: 3 },
	{ name: 'Des Moines', regionAttr: 'Polk19', state: 'IA', tier: 3 },
	{ name: 'Little Rock', regionAttr: 'Pulaski05', state: 'AR', tier: 3 },
	{ name: 'Madison', regionAttr: 'Dane55', state: 'WI', tier: 3 },
	{ name: 'Columbia', regionAttr: 'Richland45', state: 'SC', tier: 3 },
	{ name: 'Jackson', regionAttr: 'Hinds28', state: 'MS', tier: 3 },
	{ name: 'Birmingham', regionAttr: 'Jefferson01', state: 'AL', tier: 3 },
	{ name: 'Montgomery', regionAttr: 'Montgomery01', state: 'AL', tier: 3 },
	{ name: 'Baton Rouge', regionAttr: 'East Baton Rouge22', state: 'LA', tier: 3 },
	{ name: 'Charleston', regionAttr: 'Charleston45', state: 'SC', tier: 3 },
	{ name: 'Spokane', regionAttr: 'Spokane53', state: 'WA', tier: 3 },
	{ name: 'Tacoma', regionAttr: 'Pierce53', state: 'WA', tier: 3 },
	{ name: 'Toledo', regionAttr: 'Lucas39', state: 'OH', tier: 3 },
	{ name: 'Lincoln', regionAttr: 'Lancaster31', state: 'NE', tier: 3 },
	{ name: 'Reno', regionAttr: 'Washoe32', state: 'NV', tier: 3 },
	{ name: 'Plano', regionAttr: 'Collin48', state: 'TX', tier: 3 },
	{ name: 'Arlington', regionAttr: 'Tarrant48', state: 'TX', tier: 3 },
	{ name: 'Corpus Christi', regionAttr: 'Nueces48', state: 'TX', tier: 3 },
	{ name: 'Lubbock', regionAttr: 'Lubbock48', state: 'TX', tier: 3 },
	{ name: 'Akron', regionAttr: 'Summit39', state: 'OH', tier: 3 },
	{ name: 'Huntsville', regionAttr: 'Madison01', state: 'AL', tier: 3 },
	{ name: 'Mobile', regionAttr: 'Mobile01', state: 'AL', tier: 3 },
	{ name: 'Rochester', regionAttr: 'Monroe36', state: 'NY', tier: 3 },
	{ name: 'Syracuse', regionAttr: 'Onondaga36', state: 'NY', tier: 3 },
	{ name: 'Albany', regionAttr: 'Albany36', state: 'NY', tier: 3 },
	{ name: 'Grand Rapids', regionAttr: 'Kent26', state: 'MI', tier: 3 },
	{ name: 'Norfolk', regionAttr: 'Norfolk51', state: 'VA', tier: 3 },
	{ name: 'Fargo', regionAttr: 'Cass38', state: 'ND', tier: 3 },
	{ name: 'Sioux Falls', regionAttr: 'Minnehaha46', state: 'SD', tier: 3 },
	{ name: 'Billings', regionAttr: 'Yellowstone30', state: 'MT', tier: 3 },
	{ name: 'Cheyenne', regionAttr: 'Laramie56', state: 'WY', tier: 3 },
	{ name: 'Manchester', regionAttr: 'Hillsborough33', state: 'NH', tier: 3 },
	{ name: 'Burlington', regionAttr: 'Chittenden50', state: 'VT', tier: 3 },
	{ name: 'Portland', regionAttr: 'Cumberland23', state: 'ME', tier: 3 },
	{ name: 'Wilmington', regionAttr: 'New Castle10', state: 'DE', tier: 3 },
	{ name: 'Charleston', regionAttr: 'Kanawha54', state: 'WV', tier: 3 }
];

/**
 * Helper: return only the cities whose parent county is present in the
 * provided SVG. Useful when a state-filtered SVG has dropped 49 states'
 * worth of counties — we'd otherwise iterate the full list on every repaint.
 */
export function filterCitiesForSvg(svg: SVGElement): UsCity[] {
	return US_CITIES.filter((c) =>
		svg.querySelector(`[region="${cssEscape(c.regionAttr)}"]`) != null
	);
}

/** CSS.escape polyfill — handles the period / hyphen / space region attrs. */
function cssEscape(value: string): string {
	// Prefer the built-in when available (modern browsers); fall back to a
	// minimal shim for SSR/unit-tests.
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
		return CSS.escape(value);
	}
	return value.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}
