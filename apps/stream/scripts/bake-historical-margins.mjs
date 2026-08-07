#!/usr/bin/env node
/**
 * bake-historical-margins.mjs
 *
 * Merges per-county presidential margins for FIVE election years (2008, 2012,
 * 2016, 2020, 2024) into each `src/lib/templates/seed-data/state-<FIPS>.json`
 * under an `archivalByYear` map keyed by year string. Lets the operator desk
 * scrub across history via a single slider without refetching at runtime.
 *
 * Data source: tonmcg/US_County_Level_Election_Results_08-24 — one pre-aggregated
 * CSV per year (https://github.com/tonmcg/US_County_Level_Election_Results_08-24).
 * Chosen over MEDSL because each CSV is ~340 KB instead of ~20 MB, with one row
 * per county and uniform columns across years. The plan originally called for
 * MEDSL; switched for ship speed. Either source produces equivalent baselines.
 *
 * Output shape per county (written into the existing seed's `counties[]`):
 *
 *   archivalByYear: {
 *     "2008": { color, label, margin, votesRep, votesDem, votesTotal },
 *     "2012": { ... },
 *     "2016": { ... },
 *     "2020": { ... },
 *     "2024": { ... }
 *   }
 *
 * The flat archival* fields produced by earlier revisions of this script
 * (archivalColor, archivalLabel, archivalMargin, archivalVotesRep/Dem/Total)
 * are deleted from each county entry so the seed shape matches the new schema
 * in race-profile.ts.
 *
 * Idempotent — running twice writes identical output.
 *
 * Run:
 *     cd apps/stream
 *     node scripts/bake-historical-margins.mjs
 *
 * Offline / air-gapped: drop copies of
 *   <YEAR>_US_County_Level_Presidential_Results.csv
 * into `apps/stream/scripts/.cache/` and re-run; the downloader short-circuits
 * when a cache entry is present and >50 KB.
 */

import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SEED_DIR = path.resolve(ROOT, 'src', 'lib', 'templates', 'seed-data');
const CACHE_DIR = path.resolve(__dirname, '.cache');

/**
 * Per-year metadata. `candR` / `candD` are only used to produce human-friendly
 * labels like "Trump +12.4" — they don't influence color math. 2024 uses
 * "Harris" (Kamala Harris replaced Biden post-primary); all other years use the
 * actual nominee at the top of the two-party ticket.
 *
 * `source` identifies which CSV file and parsing strategy to use. The tonmcg
 * repo publishes 2016/2020/2024 as one file per year (standard "long" layout
 * with `votes_gop`/`votes_dem`/`total_votes` + `state_name`/`county_name`),
 * but bundles 2008 + 2012 into a single `08-16.csv` "wide" file with columns
 * `gop_2008`/`dem_2008`/`total_2008`/`gop_2012`/... and only `fips_code` +
 * `county` (state derived from FIPS prefix).
 */
const YEARS = [
	{ year: '2008', candR: 'McCain', candD: 'Obama', source: 'wide-08-16' },
	{ year: '2012', candR: 'Romney', candD: 'Obama', source: 'wide-08-16' },
	{ year: '2016', candR: 'Trump', candD: 'Clinton', source: 'long-per-year' },
	{ year: '2020', candR: 'Trump', candD: 'Biden', source: 'long-per-year' },
	{ year: '2024', candR: 'Trump', candD: 'Harris', source: 'long-per-year' }
];

const SOURCE_URL = {
	'long-per-year': (year) =>
		`https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/${year}_US_County_Level_Presidential_Results.csv`,
	'wide-08-16': () =>
		`https://raw.githubusercontent.com/tonmcg/US_County_Level_Election_Results_08-24/master/US_County_Level_Presidential_Results_08-16.csv`
};

const SOURCE_CACHE = {
	'long-per-year': (year) =>
		path.resolve(CACHE_DIR, `${year}_US_County_Level_Presidential_Results.csv`),
	'wide-08-16': () =>
		path.resolve(CACHE_DIR, `US_County_Level_Presidential_Results_08-16.csv`)
};

// FIPS-to-postal-code, populated once at module load, used in both
// writeUsPresBaseline and the wide-format parser (which has no state_name col).
const FIPS_TO_PO = {
	'01': 'al', '02': 'ak', '04': 'az', '05': 'ar', '06': 'ca', '08': 'co',
	'09': 'ct', '10': 'de', '11': 'dc', '12': 'fl', '13': 'ga', '15': 'hi',
	'16': 'id', '17': 'il', '18': 'in', '19': 'ia', '20': 'ks', '21': 'ky',
	'22': 'la', '23': 'me', '24': 'md', '25': 'ma', '26': 'mi', '27': 'mn',
	'28': 'ms', '29': 'mo', '30': 'mt', '31': 'ne', '32': 'nv', '33': 'nh',
	'34': 'nj', '35': 'nm', '36': 'ny', '37': 'nc', '38': 'nd', '39': 'oh',
	'40': 'ok', '41': 'or', '42': 'pa', '44': 'ri', '45': 'sc', '46': 'sd',
	'47': 'tn', '48': 'tx', '49': 'ut', '50': 'vt', '51': 'va', '53': 'wa',
	'54': 'wv', '55': 'wi', '56': 'wy'
};

// DDHQ / yapms 4-stop color ramp. Index 0 = strongest margin, index 3 = near
// toss-up. Thresholds are absolute percentage points of the two-party margin.
const R_STOPS = ['#BF1D29', '#FF5865', '#FF8B98', '#CF8980'];
const D_STOPS = ['#1C408C', '#577CCC', '#8AAFFF', '#949BB3'];
const TIE_COLOR = '#6b7280';

/** Return a ramp color for a signed 2-party margin percentage (+ = R). */
function colorFor(marginPct) {
	const abs = Math.abs(marginPct);
	if (abs < 0.5) return TIE_COLOR;
	const stops = marginPct > 0 ? R_STOPS : D_STOPS;
	if (abs >= 10) return stops[0];
	if (abs >= 5) return stops[1];
	if (abs >= 1) return stops[2];
	return stops[3];
}

/** e.g. "Trump +12.4" / "Obama +5.2" / "Tie" — candidates vary by year. */
function labelFor(marginPct, candR, candD) {
	const abs = Math.abs(marginPct);
	if (abs < 0.1) return 'Tie';
	const who = marginPct > 0 ? candR : candD;
	return `${who} +${abs.toFixed(1)}`;
}

/**
 * RFC-4180-ish CSV parser for a single line. Handles quoted fields with embedded
 * commas and doubled-quote escapes. Adequate for our dataset.
 */
function parseCsvLine(line) {
	const out = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '"') {
			if (inQuotes && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (c === ',' && !inQuotes) {
			out.push(cur);
			cur = '';
		} else {
			cur += c;
		}
	}
	out.push(cur);
	return out;
}

function normalizeName(s) {
	return (s || '')
		.toLowerCase()
		.replace(/\bcounty\b/g, '')
		.replace(/\bparish\b/g, '')
		.replace(/\bborough\b/g, '')
		.replace(/\bmunicipality\b/g, '')
		.replace(/\bcensus area\b/g, '')
		.replace(/\bcity and borough\b/g, '')
		.replace(/\./g, '')
		.replace(/[^a-z0-9]+/g, '');
}

function normalizeNameStripCity(s) {
	return normalizeName((s || '').replace(/\bcity\b/gi, ''));
}

/** Return the index of the first name in `candidates` that appears in `headers`. */
function firstIndexOf(headers, candidates) {
	for (const name of candidates) {
		const idx = headers.indexOf(name);
		if (idx >= 0) return idx;
	}
	return -1;
}

async function ensureCsv(source, year) {
	await fs.mkdir(CACHE_DIR, { recursive: true });
	const cachePath = SOURCE_CACHE[source](year);
	const tag = source === 'wide-08-16' ? '08-16' : year;
	try {
		const st = await fs.stat(cachePath);
		// Sanity check: real CSVs are 240-350 KB. Under 50 KB implies truncation
		// or a GitHub rate-limit HTML body — bail and re-download.
		if (st.size > 50_000) {
			console.log(`  [${tag}] cached ${st.size} bytes`);
			return cachePath;
		}
		console.log(`  [${tag}] cache truncated (${st.size} bytes), re-fetching`);
	} catch {
		// cache miss
	}

	const url = SOURCE_URL[source](year);
	console.log(`  [${tag}] downloading ${url}`);
	const res = await fetch(url, {
		redirect: 'follow',
		headers: { 'User-Agent': 'yapms-obs-plugin/bake-historical-margins' }
	});
	if (!res.ok || !res.body) {
		throw new Error(
			`Download failed for ${tag} (HTTP ${res.status}). Download manually:\n` +
				`  ${url}\nand save to ${cachePath}, then re-run this script.`
		);
	}
	const ws = createWriteStream(cachePath);
	await finished(Readable.fromWeb(res.body).pipe(ws));
	const st = await fs.stat(cachePath);
	console.log(`  [${tag}] wrote ${st.size} bytes`);
	return cachePath;
}

/**
 * Parse a per-year "long" CSV (2016/2020/2024) into a Map keyed by 5-digit
 * county FIPS. Columns: state_name, county_fips, county_name, votes_gop,
 * votes_dem, total_votes. `candR`/`candD` only feed the label formatter.
 */
async function loadMarginsLong(csvPath, candR, candD) {
	const raw = await fs.readFile(csvPath, 'utf8');
	const lines = raw.split(/\r?\n/);
	const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
	// 2016 uses `state_abbr`/`combined_fips`; 2020/2024 use `state_name`/
	// `county_fips`. Try both header forms and whichever exists wins.
	const col = {
		state: firstIndexOf(headers, ['state_name', 'state_abbr']),
		fips: firstIndexOf(headers, ['county_fips', 'combined_fips']),
		county: headers.indexOf('county_name'),
		gop: headers.indexOf('votes_gop'),
		dem: headers.indexOf('votes_dem'),
		total: headers.indexOf('total_votes')
	};
	if ([col.state, col.fips, col.county, col.gop, col.dem].some((x) => x < 0)) {
		throw new Error(`Unexpected long-format headers: ${headers.join(',')}`);
	}

	const byFips = new Map();
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) continue;
		const cells = parseCsvLine(line);
		const state = cells[col.state]?.trim();
		const fips = cells[col.fips]?.trim();
		const county = cells[col.county]?.trim();
		if (!state || !fips || !county) continue;

		const gop = Number(cells[col.gop]) || 0;
		const dem = Number(cells[col.dem]) || 0;
		const total = col.total >= 0 ? Number(cells[col.total]) || 0 : 0;
		const twoParty = gop + dem;
		if (twoParty === 0) continue;
		const marginPct = ((gop - dem) / twoParty) * 100;

		byFips.set(fips.padStart(5, '0'), {
			state,
			county,
			margin: Number(marginPct.toFixed(2)),
			color: colorFor(marginPct),
			label: labelFor(marginPct, candR, candD),
			votesRep: gop,
			votesDem: dem,
			votesTotal: total || twoParty
		});
	}
	return byFips;
}

/**
 * Parse the wide "08-16" CSV for a single requested year (2008 or 2012).
 * Columns: fips_code, county, total_2008, dem_2008, gop_2008, oth_2008,
 * total_2012, dem_2012, gop_2012, oth_2012, total_2016, dem_2016, gop_2016,
 * oth_2016. No state_name — we derive it from the FIPS prefix.
 */
async function loadMarginsWide(csvPath, year, candR, candD) {
	const raw = await fs.readFile(csvPath, 'utf8');
	const lines = raw.split(/\r?\n/);
	const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
	const col = {
		fips: headers.indexOf('fips_code'),
		county: headers.indexOf('county'),
		gop: headers.indexOf(`gop_${year}`),
		dem: headers.indexOf(`dem_${year}`),
		total: headers.indexOf(`total_${year}`)
	};
	if ([col.fips, col.county, col.gop, col.dem].some((x) => x < 0)) {
		throw new Error(`Wide CSV missing columns for ${year}: ${headers.join(',')}`);
	}

	const byFips = new Map();
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) continue;
		const cells = parseCsvLine(line);
		const fips = cells[col.fips]?.trim().padStart(5, '0');
		const county = cells[col.county]?.trim();
		if (!fips || fips.length !== 5 || !county) continue;

		const stateFips = fips.slice(0, 2);
		const po = FIPS_TO_PO[stateFips];
		if (!po) continue;

		const gop = Number(cells[col.gop]) || 0;
		const dem = Number(cells[col.dem]) || 0;
		const total = col.total >= 0 ? Number(cells[col.total]) || 0 : 0;
		const twoParty = gop + dem;
		if (twoParty === 0) continue;
		const marginPct = ((gop - dem) / twoParty) * 100;

		byFips.set(fips, {
			state: po.toUpperCase(),
			county,
			margin: Number(marginPct.toFixed(2)),
			color: colorFor(marginPct),
			label: labelFor(marginPct, candR, candD),
			votesRep: gop,
			votesDem: dem,
			votesTotal: total || twoParty
		});
	}
	return byFips;
}

/**
 * Build an `archivalByYear` object for one county from the per-year Maps.
 * Keys are year strings ("2008" etc.). Years where the county has no CSV row
 * get `null` entries; the slider UI hides those stops or shows "no data".
 */
function buildArchivalByYear(countyName, stateFips, marginsByYear) {
	const out = {};
	for (const { year } of YEARS) {
		const marginsForYear = marginsByYear.get(year);
		if (!marginsForYear) {
			out[year] = null;
			continue;
		}
		// Two-pass name resolution, same as pre-refactor mergeSeed.
		const primary = marginsForYear.primary;
		const stripCity = marginsForYear.stripCity;
		const nameKey = normalizeName(countyName);
		const m = primary.get(nameKey) ?? stripCity.get(nameKey);
		if (!m) {
			out[year] = null;
			continue;
		}
		out[year] = {
			color: m.color,
			label: m.label,
			margin: m.margin,
			votesRep: m.votesRep,
			votesDem: m.votesDem,
			votesTotal: m.votesTotal
		};
	}
	return out;
}

/**
 * Rewrite `state-<FIPS>.json`:
 *   1. Remove legacy flat archival* fields (archivalColor, archivalLabel,
 *      archivalMargin, archivalVotesRep/Dem/Total).
 *   2. Add `archivalByYear` populated from all 5 years.
 */
async function mergeSeed(stateFips, marginsByYear) {
	const seedPath = path.resolve(SEED_DIR, `state-${stateFips}.json`);
	let seed;
	try {
		seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));
	} catch (err) {
		if (err.code === 'ENOENT') {
			console.log(`  state-${stateFips}: no seed, skipping`);
			return;
		}
		throw err;
	}

	let matched = 0;
	for (const county of seed.counties ?? []) {
		delete county.archivalColor;
		delete county.archivalLabel;
		delete county.archivalMargin;
		delete county.archivalVotesRep;
		delete county.archivalVotesDem;
		delete county.archivalVotesTotal;
		county.archivalByYear = buildArchivalByYear(county.name, stateFips, marginsByYear);
		if (Object.values(county.archivalByYear).some((v) => v !== null)) matched++;
	}

	await fs.writeFile(seedPath, JSON.stringify(seed, null, 2) + '\n', 'utf8');
	const pct = seed.counties?.length
		? Math.round((matched / seed.counties.length) * 100)
		: 0;
	console.log(
		`  state-${stateFips} (${seed.stateName ?? '?'}): ${matched}/${seed.counties?.length ?? 0} matched (${pct}%)`
	);
}

/**
 * Aggregate county-level data up to per-state for the US President map, for
 * every year. Writes `seed-data/us-presidential-archival.json`, keyed by
 * 2-letter lowercase postal code. Each state entry has:
 *   { stateName, archivalByYear: { "2008": {...}, ... } }
 *
 * Replaces the older `us-presidential-2020-baseline.json` (deleted at the end
 * of this function).
 */
async function writeUsPresBaseline(marginsByYear) {
	// Per-state-per-year roll-up. stateAgg[po][year] = {gop, dem, total}.
	// Rather than re-reading each CSV, we aggregate out of the already-parsed
	// county-level Maps that main() built via loadMarginsLong / loadMarginsWide.
	const stateAgg = new Map();
	const stateNames = new Map();

	for (const { year, candR, candD } of YEARS) {
		const byFips = marginsByYear.get(year);
		if (!byFips) continue;
		for (const [fips, m] of byFips) {
			const stateFips = fips.slice(0, 2);
			const po = FIPS_TO_PO[stateFips];
			if (!po) continue;
			// Long CSV gives human-readable state name; wide CSV gave postal code.
			// Pick the most descriptive representation we've seen.
			const existing = stateNames.get(po);
			if (!existing || existing.length <= 2) {
				stateNames.set(po, m.state);
			}
			if (!stateAgg.has(po)) stateAgg.set(po, {});
			const byYear = stateAgg.get(po);
			if (!byYear[year]) byYear[year] = { gop: 0, dem: 0, total: 0, candR, candD };
			byYear[year].gop += m.votesRep;
			byYear[year].dem += m.votesDem;
			byYear[year].total += m.votesTotal;
		}
	}

	const out = {};
	for (const [po, byYear] of stateAgg) {
		const archivalByYear = {};
		for (const { year } of YEARS) {
			const agg = byYear[year];
			if (!agg) {
				archivalByYear[year] = null;
				continue;
			}
			const twoParty = agg.gop + agg.dem;
			if (twoParty === 0) {
				archivalByYear[year] = null;
				continue;
			}
			const marginPct = ((agg.gop - agg.dem) / twoParty) * 100;
			archivalByYear[year] = {
				color: colorFor(marginPct),
				label: labelFor(marginPct, agg.candR, agg.candD),
				margin: Number(marginPct.toFixed(2)),
				votesRep: agg.gop,
				votesDem: agg.dem,
				votesTotal: agg.total || twoParty
			};
		}
		out[po] = {
			stateName: stateNames.get(po),
			archivalByYear
		};
	}

	const outPath = path.resolve(SEED_DIR, 'us-presidential-archival.json');
	await fs.writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
	console.log(`Wrote US President archival (${Object.keys(out).length} states, 5 years) -> ${outPath}`);

	// Delete the superseded single-year baseline so stale data doesn't linger
	// in the repo. Safe: us-president.ts imports the new file after the schema
	// migration in this same change set.
	const legacyPath = path.resolve(SEED_DIR, 'us-presidential-2020-baseline.json');
	try {
		await fs.unlink(legacyPath);
		console.log(`Removed legacy ${legacyPath}`);
	} catch (err) {
		if (err.code !== 'ENOENT') throw err;
	}
}

/**
 * Pre-index the per-year margin maps by two name forms (primary, stripCity) so
 * buildArchivalByYear can resolve county names in O(1) across the 50 states.
 */
function indexForState(byFips, stateFips) {
	const primary = new Map();
	const stripCity = new Map();
	for (const [fips, m] of byFips) {
		if (fips.slice(0, 2) !== stateFips) continue;
		const keyPrimary = normalizeName(m.county);
		const keyStrip = normalizeNameStripCity(m.county);
		if (!primary.has(keyPrimary)) primary.set(keyPrimary, m);
		if (keyStrip !== keyPrimary && !stripCity.has(keyStrip)) {
			stripCity.set(keyStrip, m);
		}
	}
	return { primary, stripCity };
}

async function main() {
	console.log('Baking presidential margins (2008-2024) into state seeds...');

	// Download + parse every year up front. We reuse the parsed Maps across
	// all 51 state seeds (51 * 5 lookups is trivial).
	const marginsByYear = new Map(); // year -> Map<fips, margin>
	for (const { year, candR, candD, source } of YEARS) {
		const csvPath = await ensureCsv(source, year);
		const byFips =
			source === 'wide-08-16'
				? await loadMarginsWide(csvPath, year, candR, candD)
				: await loadMarginsLong(csvPath, candR, candD);
		marginsByYear.set(year, byFips);
		console.log(`  [${year}] ${byFips.size} county margins`);
	}

	const files = await fs.readdir(SEED_DIR);
	const fipsList = files
		.filter((f) => /^state-\d{2}\.json$/.test(f))
		.map((f) => f.slice(6, 8))
		.sort();

	// For each state, reshape the per-year global maps into per-state
	// normalized-name indexes, then hand that to mergeSeed. This avoids
	// re-indexing on every county.
	for (const fips of fipsList) {
		const indexedByYear = new Map();
		for (const { year } of YEARS) {
			const byFips = marginsByYear.get(year);
			indexedByYear.set(year, indexForState(byFips, fips));
		}
		await mergeSeed(fips, indexedByYear);
	}

	await writeUsPresBaseline(marginsByYear);
	console.log(`Done. Processed ${fipsList.length} state seeds across ${YEARS.length} years.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
