#!/usr/bin/env node
/**
 * bake-county-seeds.mjs
 *
 * Lightweight bake step that produces
 * `src/lib/templates/seed-data/state-<FIPS>.json` for all 50 states by parsing
 * the yapms counties SVG with a regex (no jsdom / no TypeScript needed).
 *
 * Only emits the county list per state. MEDSL margin data is a separate step
 * (scripts/bake-historical-margins.ts) because the CSV download is >50MB and
 * shouldn't be gated on having network.
 *
 * Run:
 *     cd apps/stream
 *     node scripts/bake-county-seeds.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COUNTIES_SVG = path.resolve(
	ROOT,
	'..',
	'yapms',
	'src',
	'lib',
	'assets',
	'maps',
	'usa',
	'usa-counties-2023-blank.svg'
);
const OUT_DIR = path.resolve(ROOT, 'src', 'lib', 'templates', 'seed-data');

const STATES = [
	{ fips: '01', name: 'Alabama' },
	{ fips: '02', name: 'Alaska' },
	{ fips: '04', name: 'Arizona' },
	{ fips: '05', name: 'Arkansas' },
	{ fips: '06', name: 'California' },
	{ fips: '08', name: 'Colorado' },
	{ fips: '09', name: 'Connecticut' },
	{ fips: '10', name: 'Delaware' },
	{ fips: '11', name: 'District of Columbia' },
	{ fips: '12', name: 'Florida' },
	{ fips: '13', name: 'Georgia' },
	{ fips: '15', name: 'Hawaii' },
	{ fips: '16', name: 'Idaho' },
	{ fips: '17', name: 'Illinois' },
	{ fips: '18', name: 'Indiana' },
	{ fips: '19', name: 'Iowa' },
	{ fips: '20', name: 'Kansas' },
	{ fips: '21', name: 'Kentucky' },
	{ fips: '22', name: 'Louisiana' },
	{ fips: '23', name: 'Maine' },
	{ fips: '24', name: 'Maryland' },
	{ fips: '25', name: 'Massachusetts' },
	{ fips: '26', name: 'Michigan' },
	{ fips: '27', name: 'Minnesota' },
	{ fips: '28', name: 'Mississippi' },
	{ fips: '29', name: 'Missouri' },
	{ fips: '30', name: 'Montana' },
	{ fips: '31', name: 'Nebraska' },
	{ fips: '32', name: 'Nevada' },
	{ fips: '33', name: 'New Hampshire' },
	{ fips: '34', name: 'New Jersey' },
	{ fips: '35', name: 'New Mexico' },
	{ fips: '36', name: 'New York' },
	{ fips: '37', name: 'North Carolina' },
	{ fips: '38', name: 'North Dakota' },
	{ fips: '39', name: 'Ohio' },
	{ fips: '40', name: 'Oklahoma' },
	{ fips: '41', name: 'Oregon' },
	{ fips: '42', name: 'Pennsylvania' },
	{ fips: '44', name: 'Rhode Island' },
	{ fips: '45', name: 'South Carolina' },
	{ fips: '46', name: 'South Dakota' },
	{ fips: '47', name: 'Tennessee' },
	{ fips: '48', name: 'Texas' },
	{ fips: '49', name: 'Utah' },
	{ fips: '50', name: 'Vermont' },
	{ fips: '51', name: 'Virginia' },
	{ fips: '53', name: 'Washington' },
	{ fips: '54', name: 'West Virginia' },
	{ fips: '55', name: 'Wisconsin' },
	{ fips: '56', name: 'Wyoming' }
];

/**
 * Pull `action-groups`, `region`, and `short-name` / `long-name` out of each
 * <path>/<g>/<polygon> tag via regex. The SVG uses single-line tag attributes
 * so a per-attribute regex is sufficient.
 */
function extractCountiesFromSvg(svgText) {
	const byState = new Map();
	// Match any self-closing or opening tag that carries both region + action-groups
	const tagRe = /<(?:path|polygon|g)\b[^>]*\bregion="([^"]+)"[^>]*\baction-groups="([^"]+)"[^>]*>/g;
	const tagRe2 = /<(?:path|polygon|g)\b[^>]*\baction-groups="([^"]+)"[^>]*\bregion="([^"]+)"[^>]*>/g;
	const attr = (tag, name) => {
		const m = new RegExp('\\b' + name + '="([^"]+)"').exec(tag);
		return m ? m[1] : null;
	};
	const visit = (tag) => {
		const region = attr(tag, 'region');
		const fips = attr(tag, 'action-groups');
		const shortName = attr(tag, 'short-name');
		const longName = attr(tag, 'long-name');
		// shortName looks like "Autauga, Alabama"; strip the state suffix so the
		// name matches civicAPI's bare county name (e.g. "Autauga").
		const raw = shortName ?? longName ?? '';
		const name = raw.split(',')[0].trim();
		if (!region || !fips || !name) return;
		if (!byState.has(fips)) byState.set(fips, []);
		byState.get(fips).push({ name, regionAttr: region });
	};
	// Grab any full opening tag so attributes can be in any order.
	const anyTagRe = /<(?:path|polygon|g|rect)\b[^>]*>/g;
	for (const match of svgText.matchAll(anyTagRe)) visit(match[0]);
	// Suppress unused regexes (kept above for reference/debug)
	void tagRe;
	void tagRe2;
	for (const list of byState.values()) {
		// Dedupe by name (SVG sometimes has multiple path elements per county)
		const seen = new Set();
		const dedup = [];
		for (const row of list) {
			if (seen.has(row.name)) continue;
			seen.add(row.name);
			dedup.push(row);
		}
		dedup.sort((a, b) => a.name.localeCompare(b.name));
		list.length = 0;
		list.push(...dedup);
	}
	return byState;
}

async function main() {
	await fs.mkdir(OUT_DIR, { recursive: true });
	console.log('Reading counties SVG:', COUNTIES_SVG);
	const svgText = await fs.readFile(COUNTIES_SVG, 'utf-8');
	const countyIndex = extractCountiesFromSvg(svgText);

	let totalCounties = 0;
	for (const { fips, name } of STATES) {
		const counties = countyIndex.get(fips) ?? [];
		const seed = {
			stateFips: fips,
			stateName: name,
			counties: counties.map((c) => ({ ...c, totalReg: 0 }))
		};
		const outPath = path.join(OUT_DIR, `state-${fips}.json`);
		await fs.writeFile(outPath, JSON.stringify(seed, null, 2) + '\n', 'utf-8');
		totalCounties += counties.length;
		console.log(`  state-${fips} ${name}: ${counties.length} counties`);
	}
	console.log(`\nDone. ${STATES.length} seeds, ${totalCounties} counties total.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
