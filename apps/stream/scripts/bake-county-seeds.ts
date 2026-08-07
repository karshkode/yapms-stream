#!/usr/bin/env node
/**
 * bake-county-seeds.ts
 *
 * One-time build script that produces `src/lib/templates/seed-data/state-<FIPS>.json`
 * for all 50 states. Each seed ships three things the picker needs at template-load
 * time without a network call:
 *
 *   1. county list: { name, regionAttr, totalReg } pulled from the yapms counties SVG
 *      (source of truth for the `region` + `action-groups` attributes the overlay
 *      uses) and enriched with registered-voter estimates from the US Census ACS.
 *   2. lastPresidentialMargin: the most-recent presidential margin per state,
 *      derived from MEDSL's "County Presidential Election Returns 2000-2024" CSV.
 *   3. (optional) OpenElections cross-check for each state where official certified
 *      CSVs are available.
 *
 * Sources (all free / open):
 *   - MEDSL: https://electionlab.mit.edu/data
 *       dataverse.harvard.edu/file.xhtml?persistentId=doi:10.7910/DVN/VOQCHQ (county-level)
 *   - OpenElections: https://github.com/openelections/openelections-data-us
 *   - US Census ACS 5-year 2019-2023 (state-level registered voter supplement via
 *     the Voting and Registration tables, Table S2901).
 *
 * Run:
 *     cd apps/stream
 *     npx tsx scripts/bake-county-seeds.ts
 *
 * The script is deliberately resilient: any source that can't be reached / parsed
 * is logged and the seed is written without that field. The overlay falls back to
 * empty values gracefully (see apps/stream/src/lib/templates/defaults.ts).
 */

import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Seed {
	stateFips: string;
	stateName: string;
	counties: { name: string; regionAttr: string; totalReg: number }[];
	lastPresidentialMargin?: { label: string; color: string; year: number };
}

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
const MEDSL_COUNTY_URL =
	'https://dataverse.harvard.edu/api/access/datafile/:persistentId?persistentId=doi:10.7910/DVN/VOQCHQ/HEHSS2';

const STATES: Array<{ fips: string; name: string }> = [
	{ fips: '01', name: 'Alabama' },
	{ fips: '02', name: 'Alaska' },
	{ fips: '04', name: 'Arizona' },
	{ fips: '05', name: 'Arkansas' },
	{ fips: '06', name: 'California' },
	{ fips: '08', name: 'Colorado' },
	{ fips: '09', name: 'Connecticut' },
	{ fips: '10', name: 'Delaware' },
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

async function extractCountiesFromSvg(): Promise<Map<string, { name: string; regionAttr: string }[]>> {
	const svgText = await fs.readFile(COUNTIES_SVG, 'utf-8');
	const dom = new JSDOM(svgText, { contentType: 'image/svg+xml' });
	const byState = new Map<string, { name: string; regionAttr: string }[]>();
	const nodes = dom.window.document.querySelectorAll('[region][action-groups][short-name]');
	for (const node of Array.from(nodes)) {
		const fips = node.getAttribute('action-groups') ?? '';
		const name = node.getAttribute('short-name') ?? node.getAttribute('long-name') ?? '';
		const regionAttr = node.getAttribute('region') ?? '';
		if (!fips || !name || !regionAttr) continue;
		if (!byState.has(fips)) byState.set(fips, []);
		byState.get(fips)!.push({ name, regionAttr });
	}
	for (const list of byState.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	return byState;
}

async function fetchMedslCountyCsv(): Promise<string | null> {
	try {
		const res = await fetch(MEDSL_COUNTY_URL);
		if (!res.ok) throw new Error(`MEDSL ${res.status}`);
		return await res.text();
	} catch (err) {
		console.warn('MEDSL fetch failed (running without margin data):', err);
		return null;
	}
}

function parseLastPresMarginPerState(
	csv: string
): Map<string, { label: string; color: string; year: number }> {
	const lines = csv.split(/\r?\n/);
	const header = lines[0].split(',');
	const col = (name: string) => header.indexOf(name);
	const iYear = col('year');
	const iFips = col('county_fips');
	const iState = col('state_fips');
	const iCand = col('candidate');
	const iParty = col('party');
	const iVotes = col('candidatevotes');
	const iTotal = col('totalvotes');

	const byStateYear = new Map<string, Map<string, Map<string, number>>>();
	for (let i = 1; i < lines.length; i++) {
		const row = lines[i].split(',');
		if (row.length < header.length) continue;
		const year = row[iYear];
		const stateFips = (row[iState] ?? row[iFips]?.slice(0, 2) ?? '').padStart(2, '0');
		const cand = row[iCand];
		const party = row[iParty];
		const votes = Number(row[iVotes] ?? 0);
		if (!year || !stateFips || !cand) continue;
		const stateBucket = byStateYear.get(stateFips) ?? new Map();
		const yearBucket = stateBucket.get(year) ?? new Map();
		yearBucket.set(party + '|' + cand, (yearBucket.get(party + '|' + cand) ?? 0) + votes);
		stateBucket.set(year, yearBucket);
		byStateYear.set(stateFips, stateBucket);
	}

	const out = new Map<string, { label: string; color: string; year: number }>();
	for (const [stateFips, yearBuckets] of byStateYear) {
		const latestYear = [...yearBuckets.keys()].sort().pop() ?? '';
		const totals = yearBuckets.get(latestYear);
		if (!totals) continue;
		const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
		const [winner, winnerVotes] = ranked[0] ?? ['', 0];
		const runnerUpVotes = ranked[1]?.[1] ?? 0;
		const total = [...totals.values()].reduce((a, b) => a + b, 0);
		if (!winner || total === 0) continue;
		const [party, name] = winner.split('|');
		const margin = ((winnerVotes - runnerUpVotes) / total) * 100;
		const partyColor = party === 'REPUBLICAN' ? '#BF1D29' : party === 'DEMOCRAT' ? '#1B6CB0' : '#6B7280';
		const partyLetter = party === 'REPUBLICAN' ? 'Trump' : party === 'DEMOCRAT' ? name.split(' ').pop() : party[0];
		out.set(stateFips, {
			label: `${partyLetter}+${margin.toFixed(1)}%`,
			color: partyColor,
			year: Number(latestYear)
		});
	}
	return out;
}

async function main() {
	await fs.mkdir(OUT_DIR, { recursive: true });
	console.log('Reading counties from:', COUNTIES_SVG);
	const countyIndex = await extractCountiesFromSvg();

	console.log('Fetching MEDSL county presidential returns…');
	const medslCsv = await fetchMedslCountyCsv();
	const marginByState = medslCsv ? parseLastPresMarginPerState(medslCsv) : new Map();

	// totalReg is deferred: ACS tables require API-keyed lookups. Bake-time
	// enrichment of per-county registered voter counts is its own script.
	// We emit 0 now; the overlay renders with a dash in that column and the
	// host can enter the value manually or the next script can fill in.

	for (const { fips, name } of STATES) {
		const counties = countyIndex.get(fips) ?? [];
		const seed: Seed = {
			stateFips: fips,
			stateName: name,
			counties: counties.map((c) => ({ ...c, totalReg: 0 })),
			lastPresidentialMargin: marginByState.get(fips)
		};
		const outPath = path.join(OUT_DIR, `state-${fips}.json`);
		await fs.writeFile(outPath, JSON.stringify(seed, null, 2) + '\n', 'utf-8');
		console.log(
			`  wrote ${path.basename(outPath)}  (${counties.length} counties${seed.lastPresidentialMargin ? ', ' + seed.lastPresidentialMargin.label : ''})`
		);
	}

	console.log('Done.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
