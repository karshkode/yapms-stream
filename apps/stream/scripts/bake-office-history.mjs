#!/usr/bin/env node
/**
 * bake-office-history.mjs
 *
 * Bakes past US Senate and Governor results, by county, into
 * `src/lib/templates/seed-data/office-history/state-<FIPS>.json`, so the map's
 * Swing and Turnout modes can be measured against the last race for the *same
 * office* rather than against the presidential result.
 *
 * Why this exists
 * ---------------
 * The comparison feature shipped with two kinds of baseline: baked presidential
 * county margins, and a race the host froze mid-broadcast. Neither answers the
 * question a downballot night is actually about. Comparing a Senate race to the
 * presidential margin measures ticket-splitting, which is a real story but not
 * the one a host reaches for first; and the captured baseline only exists if the
 * host watched the earlier race through this app and remembered to press the
 * button. There is no database behind the desk, so a capture is gone the moment
 * browser storage is cleared, and a baseline that has to be earned is a baseline
 * that isn't there on the night it's needed.
 *
 * Baking the prior same-office results means "Wayne County is 9 points redder
 * than it was in the last Senate race" is available on a cold boot, with nothing
 * set up and nothing remembered.
 *
 * Data source
 * -----------
 * MEDSL (MIT Election Data + Science Lab), from their GitHub repos rather than
 * their Harvard Dataverse mirrors. The Dataverse copies are the canonical
 * release, but every MEDSL precinct file there sits behind a guestbook prompt
 * (`/api/access/datafile/<id>` answers HTTP 400 with "You may not download this
 * file without the required Guestbook response"), so a script cannot fetch them
 * unattended. The GitHub copies are the same data, plain HTTP, no auth.
 *
 * Precinct rows are aggregated up to county here rather than downloaded
 * pre-aggregated, because MEDSL only publishes one county-level rollup
 * (2024 Senate) and it covers a single cycle.
 *
 * Coverage, and the 2020 hole
 * ---------------------------
 *   Senate    2016, 2018, 2022, 2024
 *   Governor  2018, 2022, 2024
 *
 * 2020 is missing and cannot be added from here: MEDSL/2020-elections-official
 * is an empty placeholder repo (a README and nothing else, no releases, no other
 * branches), and the 2020 precinct returns exist only on Dataverse behind the
 * guestbook. That leaves a real gap — a Senate seat up in 2026 is Class 2, so
 * the *same seat* was last contested in 2020 — but every state still gets at
 * least one Senate baseline, because each state's two seats sit in two different
 * classes and Classes 1 and 3 are covered by 2018/2024 and 2016/2022. If MEDSL
 * ever fills that repo in, add a SOURCES entry and re-run.
 *
 * Governor skips 2016 (a 12-state year whose states all reappear in 2018-2024,
 * behind an 82 MB archive that inflates to 1.7 GB) and every off-year race
 * (NJ/VA in odd years, LA/MS/KY in the year before the midterm). Those states
 * fall back to the presidential baseline, which the picker labels honestly.
 *
 * Output shape, per state file
 * ----------------------------
 *   {
 *     stateFips, stateName,
 *     races: [{
 *       id: "senate-2024", office: "senate", year: 2024,
 *       label: "2024 US Senate", candRep, candDem, partisan,
 *       margin, votesRep, votesDem, votesTotal,
 *       regions: { "<regionAttr>": { color, label, margin,
 *                                    votesRep, votesDem, votesTotal } }
 *     }]
 *   }
 *
 * Keyed by `regionAttr` (the yapms SVG `region` attribute, e.g. "Wayne26")
 * rather than by county FIPS, so `resolveBaseline` can look a region up without
 * a second mapping table. County names are resolved against the already-baked
 * `state-<FIPS>.json` seeds using the same normalization as
 * bake-historical-margins.mjs, so the two baselines agree about which counties
 * exist.
 *
 * Statewide vote totals are baked alongside the margins, which the presidential
 * seeds don't carry. That is what makes Turnout work against these baselines:
 * a region's share of the prior Senate vote is computable, so "Kent County is
 * carrying a fifth more of the vote than it did in 2022" is answerable.
 *
 * Idempotent — running twice writes identical output.
 *
 * Run:
 *     cd apps/stream
 *     node scripts/bake-office-history.mjs
 *
 * Flags:
 *     --discover     Print every distinct `office` string each source contains
 *                    and exit without writing. Use this after adding a source:
 *                    state ballots name the same job a dozen ways, and a
 *                    silently unmatched office bakes as missing data.
 *     --only=2024    Restrict to one election year (faster iteration).
 *
 * Offline / air-gapped: the downloader caches into `scripts/.cache/`, keyed by
 * filename, and reuses anything already there. Drop the archives in by hand and
 * re-run.
 */

import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { createInterface } from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SEED_DIR = path.resolve(ROOT, 'src', 'lib', 'templates', 'seed-data');
const OUT_DIR = path.resolve(SEED_DIR, 'office-history');
const CACHE_DIR = path.resolve(__dirname, '.cache');

const RAW = 'https://raw.githubusercontent.com';

/** Postal codes MEDSL publishes per-state archives for. DC has no county map. */
const STATE_PO = [
	'al',
	'ak',
	'az',
	'ar',
	'ca',
	'co',
	'ct',
	'de',
	'fl',
	'ga',
	'hi',
	'id',
	'il',
	'in',
	'ia',
	'ks',
	'ky',
	'la',
	'me',
	'md',
	'ma',
	'mi',
	'mn',
	'ms',
	'mo',
	'mt',
	'ne',
	'nv',
	'nh',
	'nj',
	'nm',
	'ny',
	'nc',
	'nd',
	'oh',
	'ok',
	'or',
	'pa',
	'ri',
	'sc',
	'sd',
	'tn',
	'tx',
	'ut',
	'vt',
	'va',
	'wa',
	'wv',
	'wi',
	'wy'
];

/** States that elected a governor in 2024 — the only 2024 per-state archives
 *  worth the download, since 2024 Senate comes from a 1 MB county rollup. */
const GOV_2024 = ['de', 'in', 'mo', 'mt', 'nh', 'nc', 'nd', 'ut', 'vt', 'wa', 'wv'];

/**
 * Where each cycle's rows come from, and which parser reads them.
 *
 * `layout` selects the column vocabulary, not the container:
 *   'medsl-2018'  precinct rows, `party_simplified` / uppercase office names.
 *                 Shared by 2018, 2022 and 2024 despite the name — MEDSL has
 *                 kept these columns stable since 2018.
 *   'medsl-2016'  precinct rows, quoted CSV, `party` in lowercase words,
 *                 title-case office names, unpadded FIPS.
 *   'county-2024' the pre-aggregated 2024 Senate rollup: already one row per
 *                 county per candidate, so no precinct summing.
 */
const SOURCES = [
	{
		year: 2016,
		offices: ['senate'],
		layout: 'medsl-2016',
		files: [
			{
				url: `${RAW}/MEDSL/official-precinct-returns/master/2016-precinct-senate/2016-precinct-senate.zip`,
				entry: '2016-precinct-senate.csv'
			}
		]
	},
	{
		year: 2018,
		offices: ['senate'],
		layout: 'medsl-2018',
		files: [
			{
				url: `${RAW}/MEDSL/2018-elections-official/master/SENATE/SENATE_precinct_general.zip`,
				entry: 'SENATE_precinct_general.csv'
			}
		]
	},
	{
		year: 2018,
		offices: ['governor'],
		layout: 'medsl-2018',
		// 78 MB compressed, 1.9 GB inflated, and every state judicial and
		// legislative race is in there with the governor. Streamed and filtered
		// line by line rather than held in memory.
		files: [
			{
				url: `${RAW}/MEDSL/2018-elections-official/master/STATE/STATE_precinct_general.zip`,
				entry: 'STATE_precinct_general.csv'
			}
		]
	},
	{
		year: 2022,
		offices: ['senate', 'governor'],
		layout: 'medsl-2018',
		files: STATE_PO.map((po) => ({
			url: `${RAW}/MEDSL/2022-elections-official/main/individual_states/2022-${po}-local-precinct-general.zip`,
			entry: `${po}22_cleaned.csv`
		}))
	},
	{
		year: 2024,
		offices: ['senate'],
		layout: 'county-2024',
		files: [{ url: `${RAW}/MEDSL/2024-elections-official/main/2024-senate-county.csv` }]
	},
	{
		year: 2024,
		offices: ['governor'],
		layout: 'medsl-2018',
		files: GOV_2024.map((po) => ({
			url: `${RAW}/MEDSL/2024-elections-official/main/individual_states/${po}24.zip`,
			entry: `${po}24.csv`
		}))
	}
];

/**
 * Which ballot lines count as the office.
 *
 * Whole-string patterns rather than a substring search, because the near-misses
 * are the dangerous part and there are more of them than you would guess. A
 * "STATE SENATE" row summed into a US Senate baseline, or New Hampshire's
 * "GOVERNOR'S COUNCIL" summed into its governor's race, produces a margin that
 * looks entirely plausible and is about a different election. Meanwhile the
 * joint tickets — "GOVERNOR/LIEUTENANT GOVERNOR" is how several states print
 * it — *are* the race we want, so they can't just be excluded on the word
 * "lieutenant". Run with `--discover` after adding a source to see every
 * office string it matched and every near-miss it rejected.
 */
const OFFICE_MATCH = {
	senate: (office) => /^(US|U\.S\.|UNITED STATES) SENATE$/.test(office),
	governor: (office) => /^GOVERNOR( ?(\/|AND|&) ?(LIEUTENANT|LT\.?) GOVERNOR)?$/.test(office)
};

const OFFICE_LABEL = { senate: 'US Senate', governor: 'Governor' };

/** Baked ballot lines that may be an unsplit joint ticket, for the bake report. */
const unsplitTickets = new Set();

// DDHQ / yapms 4-stop ramp, matching bake-historical-margins.mjs so an archival
// and an office-history baseline of the same margin paint the same shade.
const R_STOPS = ['#BF1D29', '#FF5865', '#FF8B98', '#CF8980'];
const D_STOPS = ['#1C408C', '#577CCC', '#8AAFFF', '#949BB3'];
const TIE_COLOR = '#6b7280';

function colorFor(marginPct) {
	const abs = Math.abs(marginPct);
	if (abs < 0.5) return TIE_COLOR;
	const stops = marginPct > 0 ? R_STOPS : D_STOPS;
	if (abs >= 10) return stops[0];
	if (abs >= 5) return stops[1];
	if (abs >= 1) return stops[2];
	return stops[3];
}

function labelFor(marginPct, candR, candD) {
	const abs = Math.abs(marginPct);
	if (abs < 0.1) return 'Tie';
	const who = marginPct > 0 ? candR : candD;
	return `${who} +${abs.toFixed(1)}`;
}

const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V', 'MD', 'PHD', 'ESQ']);

/** Ballot honorifics. Arkansas files its incumbents as "GOVERNOR ASA
 *  HUTCHINSON" and "SENATOR JOHN BOOZMAN", Washington as "DR RAUL GARCIA". */
const HONORIFICS = new Set([
	'GOVERNOR',
	'GOV',
	'SENATOR',
	'SEN',
	'REPRESENTATIVE',
	'REP',
	'CONGRESSMAN',
	'CONGRESSWOMAN',
	'DR',
	'MR',
	'MRS',
	'MS',
	'MISS',
	'JUDGE',
	'HON',
	'HONORABLE',
	'THE'
]);

/**
 * One canonical spelling for a candidate, used as both the identity key and the
 * source of the display name.
 *
 * Every state's returns are typed by a different clerk, and within a single
 * MEDSL file one candidate routinely appears under several spellings. Kansas's
 * 2016 Senate rows carry Jerry Moran as both "Moran, Jerry" (395k votes) and
 * "Jerry Moran" (337k), and keying by the raw string counted them as two people
 * — which is why that race baked as a same-party contest of Moran against
 * himself, at a margin of +100 in every county. Kentucky spells Rand Paul three
 * ways in one file ("Rand PAUL", "Rand Paul", "RAND PAUL").
 *
 * So the raw string is reduced to something stable: "Last, First" is swapped
 * back into reading order, honorifics and parenthetical nicknames are dropped,
 * case and punctuation are flattened, and middle initials are removed so
 * "Roger F. Wicker" and "Roger Wicker" are one senator. A single-letter *final*
 * token is kept, because there it's a generational suffix ("Sammy Davis V") and
 * not an initial.
 */
function cleanName(raw) {
	let s = (raw || '')
		.replace(/["]/g, '')
		.replace(/\([^)]*\)/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();

	// "CORTEZ MASTO, CATHERINE" -> "CATHERINE CORTEZ MASTO". Only for a single
	// comma with text on both sides; anything else is left alone rather than
	// reordered on a guess.
	const parts = s.split(',');
	if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
		s = `${parts[1].trim()} ${parts[0].trim()}`;
	} else {
		s = s.replace(/,/g, ' ');
	}

	let tokens = s.replace(/\./g, '').split(/\s+/).filter(Boolean);
	while (tokens.length > 1 && HONORIFICS.has(tokens[0])) tokens.shift();
	// Single *letters* only. A lone "/" is a joint-ticket separator standing on
	// its own between two names ("IGE / GREEN"), and dropping it would weld the
	// governor and the lieutenant governor into one unsplittable name.
	tokens = tokens.filter((t, i) => !(/^[A-Z]$/.test(t) && i !== tokens.length - 1));
	return tokens.join(' ');
}

/**
 * Utah prints its gubernatorial ticket as one unpunctuated run of two people's
 * names — "SPENCER J COX DEIDRE M HENDERSON" — so unlike every other joint-
 * ticket state there is no separator to cut on and no way to tell where the
 * governor's name ends. Splitting on token count would be a guess that happens
 * to work for Cox and breaks the moment someone has a two-word surname.
 *
 * Keyed on the cleaned ticket string rather than on (state, year) so it applies
 * only to the exact ballot line it was written for; a re-bake that picks up a
 * different ticket falls through to the warning in `principalName` instead of
 * silently inheriting the wrong split.
 */
const TICKET_PRINCIPAL = {
	'SPENCER COX DEIDRE HENDERSON': 'SPENCER COX',
	'BRIAN SMITH KING REBEKAH CUMMINGS': 'BRIAN SMITH KING',
	'PHIL LYMAN NATALIE CLAWSON': 'PHIL LYMAN'
};

/**
 * The candidate at the top of a joint ticket.
 *
 * Governor and lieutenant governor run as a pair in most states, and the file
 * carries both names on one ballot line. Whichever way it's punctuated, the
 * governor is printed first — so the label on the map has to come from the first
 * half. Reading the last token instead names the running mate, which is how the
 * first bake of this data labelled North Dakota's 2024 map "Strinden" and Ohio's
 * 2018 map "Husted".
 */
function principalName(cleaned) {
	const split = cleaned.split(/\s+(?:AND|&)\s+|\s*\/\s*/);
	if (split.length > 1 && split[0].trim()) return split[0].trim();
	return TICKET_PRINCIPAL[cleaned] ?? cleaned;
}

/**
 * A name that may be two people with nothing to cut on.
 *
 * Four or more tokens and no separator is either a genuinely long single name
 * ("Michelle Lujan Grisham" is three, "Mandy Powers Norrell" is three) or an
 * unpunctuated ticket. Rather than split on a token count that happens to work
 * for the cases in front of us, the bake reports these and leaves the label
 * alone; the fix is an explicit TICKET_PRINCIPAL entry.
 */
function looksUnsplit(cleaned) {
	if (TICKET_PRINCIPAL[cleaned]) return false;
	if (/\s(AND|&)\s|\//.test(cleaned)) return false;
	return cleaned.split(' ').length >= 4;
}

/**
 * Surname, for the short label on the map.
 *
 * The last token that isn't a generational suffix. Gets a two-word surname
 * wrong ("VAN HOLLEN" reads as "Hollen"), which is why the full name is baked
 * alongside it for the UI to show.
 */
function surname(cleaned) {
	const tokens = cleaned.split(' ').filter(Boolean);
	while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
	return titleCase(tokens[tokens.length - 1] ?? '');
}

/**
 * Surnames whose conventional capitalisation can't be recovered from an
 * all-caps source.
 *
 * "MCCAIN" is fixable by rule — every Mc- name camel-cases the next letter —
 * but "DESANTIS" is not: De- is camel-cased in DeSantis and DeWine, spaced in
 * De Leon, and lower-cased in de Blasio, and the ballot line gives no way to
 * tell which. Rather than pick a rule that gets one group right and the others
 * wrong, the handful that appear as major-party nominees in this data are listed.
 * Display only; nothing keys off these.
 */
const CASED_SURNAMES = {
	DESANTIS: 'DeSantis',
	DEWINE: 'DeWine',
	DEJEAR: 'DeJear',
	LEPAGE: 'LePage',
	LAROSE: 'LaRose',
	DELEON: 'De Leon',
	VANHOLLEN: 'Van Hollen'
};

function titleCase(s) {
	const tokens = s.split(' ');
	return tokens
		.map((token, i) => {
			if (!token) return token;
			const upper = token.toUpperCase();
			if (SUFFIXES.has(upper)) return upper;
			if (CASED_SURNAMES[upper]) return CASED_SURNAMES[upper];
			// "JD Vance", "JB Pritzker": initials standing in for a first name.
			// Only before the surname, so the surname "Ng" survives as written.
			if (i < tokens.length - 1 && upper.length <= 3 && !/[AEIOUY]/.test(upper)) return upper;
			return token
				.toLowerCase()
				.replace(/(^|[-'\s])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
				.replace(/^(Mc)([a-z])/, (_, mc, ch) => mc + ch.toUpperCase());
		})
		.join(' ');
}

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

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function ensureFile(url) {
	await fs.mkdir(CACHE_DIR, { recursive: true });
	const dest = path.resolve(CACHE_DIR, path.basename(new URL(url).pathname));
	try {
		const st = await fs.stat(dest);
		// A GitHub 404 body is a few hundred bytes of HTML; every real archive
		// here is tens of KB at minimum, so size is enough of a sanity check.
		if (st.size > 20_000) return dest;
	} catch {
		// cache miss
	}
	const res = await fetch(url, {
		redirect: 'follow',
		headers: { 'user-agent': 'yapms-obs-plugin/bake-office-history' }
	});
	if (!res.ok || !res.body) {
		throw new Error(
			`Download failed (HTTP ${res.status}) for ${url}\n` +
				`Fetch it by hand and save to ${dest}, then re-run.`
		);
	}
	await finished(Readable.fromWeb(res.body).pipe(createWriteStream(dest)));
	return dest;
}

// ---------------------------------------------------------------------------
// Minimal zip reader
// ---------------------------------------------------------------------------

/**
 * Read one entry out of a zip as a stream, without a zip dependency.
 *
 * These archives inflate to hundreds of megabytes — the 2018 state-office file
 * reaches 1.9 GB — so the entry has to be streamed rather than buffered. All we
 * need for that is the entry's offset and compressed length from the central
 * directory, then a bounded file read piped through raw inflate. Adding a zip
 * package to the workspace to avoid ~60 lines here would put a dependency in
 * the tree for the sake of one dev script.
 */
async function zipCentralDirectory(file) {
	const fd = await fs.open(file, 'r');
	try {
		const { size } = await fd.stat();
		// The end-of-central-directory record is last, but a trailing comment can
		// push it up to 64 KB back from the end.
		const tailLen = Math.min(size, 66_000);
		const tail = Buffer.alloc(tailLen);
		await fd.read(tail, 0, tailLen, size - tailLen);
		let eocd = -1;
		for (let i = tail.length - 22; i >= 0; i--) {
			if (tail.readUInt32LE(i) === 0x06054b50) {
				eocd = i;
				break;
			}
		}
		if (eocd < 0) throw new Error(`${file}: no end-of-central-directory record`);
		const count = tail.readUInt16LE(eocd + 10);
		const cdSize = tail.readUInt32LE(eocd + 12);
		const cdOffset = tail.readUInt32LE(eocd + 16);
		const cd = Buffer.alloc(cdSize);
		await fd.read(cd, 0, cdSize, cdOffset);

		const entries = [];
		let p = 0;
		for (let i = 0; i < count && p + 46 <= cd.length; i++) {
			const method = cd.readUInt16LE(p + 10);
			const compressed = cd.readUInt32LE(p + 20);
			const nameLen = cd.readUInt16LE(p + 28);
			const extraLen = cd.readUInt16LE(p + 30);
			const commentLen = cd.readUInt16LE(p + 32);
			const localOffset = cd.readUInt32LE(p + 42);
			entries.push({
				name: cd.toString('utf8', p + 46, p + 46 + nameLen),
				method,
				compressed,
				localOffset
			});
			p += 46 + nameLen + extraLen + commentLen;
		}
		return entries;
	} finally {
		await fd.close();
	}
}

async function openZipEntry(file, entry) {
	// The local header repeats the name and extra field, and its extra field can
	// differ in length from the central directory's, so the data offset has to
	// come from the local header rather than being computed from the CD copy.
	const fd = await fs.open(file, 'r');
	let start;
	try {
		const head = Buffer.alloc(30);
		await fd.read(head, 0, 30, entry.localOffset);
		start = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
	} finally {
		await fd.close();
	}
	const raw = createReadStream(file, { start, end: start + entry.compressed - 1 });
	return entry.method === 0 ? raw : raw.pipe(zlib.createInflateRaw());
}

/**
 * Line reader over a source file, transparently unwrapping a zip.
 *
 * `entry` names the expected member, but falls back to the first CSV in the
 * archive: MEDSL's per-state archives are named inconsistently between cycles
 * (`mi22_cleaned.csv` in 2022, `mi24.csv` in 2024, and a handful of 2022 states
 * that use neither), and a missing member should not fail the bake when there's
 * exactly one data file to read.
 */
async function openLines(file, entryName) {
	if (!file.endsWith('.zip')) {
		return createInterface({ input: createReadStream(file), crlfDelay: Infinity });
	}
	const entries = (await zipCentralDirectory(file)).filter(
		(e) => !e.name.startsWith('__MACOSX/') && !e.name.endsWith('/')
	);
	const csvs = entries.filter((e) => /\.(csv|tab|txt)$/i.test(e.name));
	const pick = (entryName && csvs.find((e) => e.name === entryName)) ?? csvs[0];
	if (!pick)
		throw new Error(`${file}: no CSV entry (saw ${entries.map((e) => e.name).join(', ')})`);
	return createInterface({ input: await openZipEntry(file, pick), crlfDelay: Infinity });
}

// ---------------------------------------------------------------------------
// Row extraction
// ---------------------------------------------------------------------------

function columnsFor(layout, headers) {
	const idx = (...names) => {
		for (const n of names) {
			const i = headers.indexOf(n);
			if (i >= 0) return i;
		}
		return -1;
	};
	const col = {
		stateFips: idx('state_fips'),
		countyName: idx('county_name'),
		office: idx('office'),
		candidate: idx('candidate'),
		// Read BOTH party columns, always. `party_simplified` looks like the
		// convenient one and quietly files every state-affiliated Democratic
		// party under "OTHER": Minnesota's DFL, North Dakota's Dem-NPL and
		// Vermont's Dem/Prog all land there, which is why the first bake of this
		// data reported Walz, Christiansen and Charlestin as having no opponent
		// and flagged their races as same-party contests. `party_detailed`
		// carries the real label.
		partySimple: layout === 'medsl-2016' ? -1 : idx('party_simplified'),
		partyDetailed: layout === 'medsl-2016' ? idx('party') : idx('party_detailed'),
		// 2016 only, and worth reading because that file's `party` column is
		// blank on most rows: Johnny Isakson's Georgia returns carry a party on
		// 5,170 of his 2.13 million votes and nothing on the rest. This column
		// is populated from MEDSL's candidate crosswalk instead of the county
		// clerk's ballot, so it fills in a good share of those gaps.
		partyCandidate: layout === 'medsl-2016' ? idx('candidate_party') : -1,
		votes: idx('votes'),
		// Absent from the pre-aggregated 2024 county rollup, which has one row
		// per county already.
		precinct: idx('precinct'),
		mode: idx('mode'),
		stage: idx('stage'),
		special: idx('special'),
		writein: idx('writein')
	};
	const required = ['stateFips', 'countyName', 'office', 'candidate', 'votes'];
	const missing = required.filter((k) => col[k] < 0);
	if (missing.length) {
		throw new Error(`missing columns ${missing.join(', ')} in headers: ${headers.join(',')}`);
	}
	if (col.partySimple < 0 && col.partyDetailed < 0) {
		throw new Error(`no party column in headers: ${headers.join(',')}`);
	}
	return col;
}

/**
 * 'rep' | 'dem' | 'other' for one party line.
 *
 * Word-boundary matching rather than a prefix test, because a party label is
 * frequently a fusion of two: Vermont prints "DEM/PROG" one cycle and
 * "DEMOCRAT/PROGRESSIVE" the next and "PROG/DEM" for a candidate whose
 * Progressive line came first. All three are the Democrat.
 */
function partyFamily(raw) {
	const p = (raw || '').replace(/"/g, '').toUpperCase();
	if (/\bREPUBLICAN\b|\bGOP\b/.test(p)) return 'rep';
	if (/\bDEMOCRAT(IC)?\b|\bDEM\b|\bDFL\b/.test(p)) return 'dem';
	return 'other';
}

/**
 * Ballot lines that aren't a person.
 *
 * Vermont's returns include a "TOTAL VOTES CAST" row alongside the candidates,
 * so summing every row in a county double-counts the whole election, and
 * "BLANKS" / "UNDERVOTES" / "OVERVOTES" would be counted as votes for someone.
 * New York goes further and files a "REGISTERED VOTERS" row as a candidate,
 * which is how the first bake of this data reported Cuomo's 2018 re-election as
 * a race against the electorate — 100% of the vote in every county, and a
 * turnout figure roughly three times the real one.
 *
 * Left out of the totals entirely rather than folded into "other": these are
 * counts of ballots and registrations, not votes cast for anybody.
 */
const ADMIN_ROW = new RegExp(
	'^(' +
		[
			// Totals and ballot counts.
			'TOTAL(\\s+(VOTES|BALLOTS)(\\s+CAST)?)?',
			'LESS\\s+PUBLIC\\s+COUNTER',
			'BALLOTS?(\\s+CAST)?',
			'REGISTERED\\s+VOTERS?',
			'ELIGIBLE(\\s+VOTERS?)?',
			'VOTER\\s+TURNOUT',
			'TIMES\\s+(COUNTED|BLANK\\s+VOTED|OVER\\s+VOTED)',
			// Ballots that recorded no choice.
			'BLANKS?',
			'BLANK\\s+VOTES',
			'BLANK\\s*/\\s*VOID',
			'WHOLE\\s+BALLOT\\s+VOID',
			'UNDER\\s?VOTES?',
			'OVER\\s?VOTES?',
			'UNRECORDED',
			'SPOILED.*',
			'VOID.*',
			'REJECTED.*',
			'EXHAUSTED.*',
			// New York files its whole per-election-district reporting vocabulary
			// in the candidate column, so these arrive looking like people who ran.
			'PUBLIC\\s+COUNTER',
			'STATE\\s+BALLOTS?',
			'FEDERAL(\\s+BALLOTS?)?',
			'AFFIDAVIT(\\s+BALLOTS?)?',
			'ABSENTEE(\\s*/\\s*MILITARY)?',
			'MILITARY',
			'(MANUALLY\\s+COUNTED\\s+)?EMERGENCY',
			'SPECIAL\\s+PRESIDENTIAL',
			// Nothing at all.
			'NA',
			'N/A',
			'NONE',
			'-+'
		].join('|') +
		')$'
);

/**
 * Real votes, but never a candidate the margin can be measured between.
 *
 * Counted toward a region's turnout because someone cast them, but excluded
 * from the two-way pick — a scattering of write-ins is not the runner-up.
 */
const NOT_A_PERSON =
	/^(\[?WRITE[- ]?IN\]?.*|OTHER\s+WRITE[- ]?INS?|OTHER\s+INDIVIDUAL\s+VOTES|SCATTER(ING|ED)?|MISCELLANEOUS|OTHER|NONE\s+OF\s+THESE.*|NO\s+CANDIDATE.*)$/;

function isGeneralRow(cells, col) {
	// `stage` distinguishes the general from a primary in the combined files;
	// specials are dropped so a state that ran a special alongside its regular
	// Senate race (MN 2018, GA and AZ 2020) doesn't merge two contests into one.
	if (col.stage >= 0) {
		const stage = (cells[col.stage] || '').replace(/"/g, '').trim().toUpperCase();
		if (stage && stage !== 'GEN' && stage !== 'GENERAL') return false;
	}
	if (col.special >= 0 && /^"?true"?$/i.test((cells[col.special] || '').trim())) return false;
	return true;
}

/**
 * Fold one source file's rows into the accumulator.
 *
 * Two things make this more than a group-by.
 *
 * First, votes are counted per *precinct* before being rolled up, because a
 * precinct's row set is not always a partition. Michigan's 2022 file reports
 * Wayne County both as a `TOTAL` per precinct and as separate `ABSENTEE` and
 * `ELECTION DAY` rows for the same precinct, so summing every row credits
 * Whitmer with 3.4 million votes in a race she won with 2.4 million. Where a
 * precinct has a `TOTAL` row that is the answer and the component modes are its
 * breakdown; where it doesn't, the components are all there is. Deciding that
 * per precinct rather than per state handles a county that reports one way while
 * the rest of the state reports the other.
 *
 * Rows that collide on (county, precinct) are added rather than deduplicated.
 * Detroit has several reporting units per printed precinct name, and the
 * statewide totals come out right only if they all count.
 *
 * Second, votes are accumulated per candidate *identity* rather than per
 * (candidate string, party). Two different things collapse here. New York and
 * Connecticut let one candidate hold several ballot lines — Hochul ran as both a
 * Democrat and a Working Families candidate — and those are one person's votes.
 * And the same person is frequently spelled several ways within one file, which
 * `cleanName` reconciles.
 */
async function ingest(file, entryName, layout, offices, acc, discovered) {
	const rl = await openLines(file, entryName);
	let col = null;
	let rows = 0;
	let kept = 0;
	try {
		for await (const line of rl) {
			if (!line) continue;
			if (col === null) {
				col = columnsFor(
					layout,
					parseCsvLine(line).map((h) => h.trim().toLowerCase().replace(/"/g, ''))
				);
				continue;
			}
			rows++;
			const cells = parseCsvLine(line);
			const office = (cells[col.office] || '')
				.replace(/"/g, '')
				.replace(/\s+/g, ' ')
				.trim()
				.toUpperCase();
			if (!office) continue;

			let matched = null;
			for (const o of offices) {
				if (OFFICE_MATCH[o](office)) {
					matched = o;
					break;
				}
			}
			if (discovered) {
				// Record near-misses too, so --discover shows what was rejected.
				if (matched || /SENATE|GOVERNOR/.test(office)) {
					discovered.add(`${matched ? '  MATCH' : 'reject'} ${office}`);
				}
				continue;
			}
			if (!matched) continue;
			if (!isGeneralRow(cells, col)) continue;

			const votes = Number(cells[col.votes]);
			if (!Number.isFinite(votes) || votes <= 0) continue;

			const stateFips = String(cells[col.stateFips] || '')
				.replace(/"/g, '')
				.trim()
				.padStart(2, '0');
			if (!/^\d{2}$/.test(stateFips)) continue;
			const countyName = (cells[col.countyName] || '').replace(/"/g, '').trim();
			if (!countyName) continue;
			const candidate = cleanName(cells[col.candidate]);
			if (!candidate || ADMIN_ROW.test(candidate)) continue;

			kept++;
			const raceKey = `${stateFips}|${matched}`;
			let race = acc.get(raceKey);
			if (!race) {
				race = { stateFips, office: matched, parties: new Map(), counties: new Map() };
				acc.set(raceKey, race);
			}

			// Party lines per candidate, so a fusion candidate's family can be
			// read off whichever line carried most of their vote.
			let lines = race.parties.get(candidate);
			if (!lines) {
				lines = new Map();
				race.parties.set(candidate, lines);
			}
			// Every party column joined, so a row whose simplified column says
			// OTHER still resolves through the detailed one, and a 2016 row with
			// an empty ballot party still resolves through the crosswalk.
			const family = partyFamily(
				[col.partySimple, col.partyDetailed, col.partyCandidate]
					.filter((i) => i >= 0)
					.map((i) => cells[i] ?? '')
					.join(' ')
			);
			lines.set(family, (lines.get(family) ?? 0) + votes);

			const nameKey = normalizeName(countyName);
			let county = race.counties.get(nameKey);
			if (!county) {
				county = { display: countyName, precincts: new Map() };
				race.counties.set(nameKey, county);
			}
			const precinctKey = col.precinct >= 0 ? (cells[col.precinct] ?? '') : '';
			let precinct = county.precincts.get(precinctKey);
			if (!precinct) {
				precinct = new Map();
				county.precincts.set(precinctKey, precinct);
			}
			let tally = precinct.get(candidate);
			if (!tally) {
				tally = { total: 0, parts: 0 };
				precinct.set(candidate, tally);
			}
			const mode = col.mode >= 0 ? (cells[col.mode] || '').replace(/"/g, '').trim() : '';
			if (mode === '' || mode.toUpperCase() === 'TOTAL') tally.total += votes;
			else tally.parts += votes;
		}
	} finally {
		rl.close();
	}
	return { rows, kept };
}

/** County-level votes per candidate, resolving each precinct's TOTAL-vs-modes. */
function countyVotes(county) {
	const byCandidate = new Map();
	for (const precinct of county.precincts.values()) {
		for (const [candidate, { total, parts }] of precinct) {
			const votes = total > 0 ? total : parts;
			if (votes <= 0) continue;
			byCandidate.set(candidate, (byCandidate.get(candidate) ?? 0) + votes);
		}
	}
	return byCandidate;
}

/**
 * Reduce one accumulated (state, office) contest to the baked race record.
 *
 * The margin is between the top two finishers statewide, not between "the
 * Republican" and "the Democrat", because in a growing number of races one of
 * those doesn't exist. Nebraska's 2024 Senate race was Fischer against the
 * independent Osborn with no Democrat on the ballot; Utah's 2022 was Lee against
 * McMullin on the same basis; Vermont keeps returning Sanders as an independent.
 * Insisting on a major-party pair would report all of those as uncontested,
 * whereas the top two are exactly the two the margin was between.
 *
 * `partisan` then records whether the shade means what the Swing map claims it
 * means: true when precisely one of the two is a Republican, so a positive
 * margin really is a Republican lead. California and Washington's top-two
 * systems routinely produce a Democrat against a Democrat, and Alaska's
 * ranked-choice final produced a Republican against a Republican — margins that
 * say which of two allies won, not how the state leans. Those bake with
 * `partisan: false`, which suppresses swing against them while leaving their
 * turnout shares usable, and the picker labels them so.
 */
function summarize(race, year) {
	const byCounty = new Map();
	const statewide = new Map();
	for (const [nameKey, county] of race.counties) {
		const votes = countyVotes(county);
		byCounty.set(nameKey, { display: county.display, votes });
		for (const [candidate, v] of votes) {
			statewide.set(candidate, (statewide.get(candidate) ?? 0) + v);
		}
	}

	/**
	 * Which party a candidate ran under, from every ballot line they appeared on.
	 *
	 * Rows with no party at all are ignored rather than being allowed to win a
	 * vote-weighted majority. This distinction is the whole game in the 2016
	 * file, where the party column is blank on the great majority of rows:
	 * Georgia carries a party on 5,170 of Johnny Isakson's 2.13 million votes,
	 * and North Dakota carries none of John Hoeven's. Counting blanks meant every
	 * one of those senators resolved to "other", so the races baked as
	 * non-partisan and — because the sign of the margin is then arbitrary — put
	 * the Republican on the Democratic side. North Dakota 2016 came out as
	 * Hoeven losing by 64 points in the year he won by 61.
	 *
	 * Among the labels that *do* say something, the one carrying the most votes
	 * wins, which is what resolves a fusion candidate who holds a Democratic and
	 * a Working Families line to the Democrat.
	 */
	const familyOf = (candidate) => {
		let best = 'other';
		let bestVotes = 0;
		for (const [family, votes] of race.parties.get(candidate) ?? []) {
			if (family === 'other') continue;
			if (votes > bestVotes) {
				best = family;
				bestVotes = votes;
			}
		}
		return best;
	};

	const ranked = [...statewide.entries()]
		.filter(([name]) => !NOT_A_PERSON.test(name.toUpperCase()))
		.sort((a, b) => b[1] - a[1])
		.map(([name, votes]) => ({ name, votes, family: familyOf(name) }));
	if (ranked.length < 2) return null;

	const [first, second] = ranked;
	const firstRep = first.family === 'rep';
	const secondRep = second.family === 'rep';
	// A positive margin means a Republican lead — the convention
	// `ArchivalSnapshot.margin` uses and what the Swing ramp paints red — so the
	// Republican of the pair goes on the `rep` side whichever of the two of them
	// finished ahead.
	const partisan = firstRep !== secondRep;
	let rep;
	let dem;
	if (secondRep && !firstRep) {
		rep = second;
		dem = first;
	} else if (firstRep) {
		rep = first;
		dem = second;
	} else if (second.family === 'dem' && first.family !== 'dem') {
		// Neither is a Republican, so the sign is arbitrary and `partisan` is
		// already false. Put the Democrat on the `dem` side anyway so the label
		// names the right person.
		rep = first;
		dem = second;
	} else {
		rep = second;
		dem = first;
	}

	const principalR = principalName(rep.name);
	const principalD = principalName(dem.name);
	for (const name of [rep.name, dem.name]) {
		if (looksUnsplit(name)) unsplitTickets.add(name);
	}
	const labelR = surname(principalR);
	const labelD = surname(principalD);

	const regions = {};
	let sumRep = 0;
	let sumDem = 0;
	let sumTotal = 0;
	for (const { display, votes } of byCounty.values()) {
		const votesRep = votes.get(rep.name) ?? 0;
		const votesDem = votes.get(dem.name) ?? 0;
		// Every candidate's votes, not just the pair, so a region's share of the
		// electorate is its real share and not its share of the two-way vote.
		let total = 0;
		for (const v of votes.values()) total += v;
		const twoWay = votesRep + votesDem;
		if (twoWay === 0) continue;

		const marginPct = ((votesRep - votesDem) / twoWay) * 100;
		regions[display] = {
			color: colorFor(marginPct),
			label: labelFor(marginPct, labelR, labelD),
			margin: Number(marginPct.toFixed(2)),
			votesRep,
			votesDem,
			votesTotal: total || twoWay
		};
		sumRep += votesRep;
		sumDem += votesDem;
		sumTotal += total || twoWay;
	}
	if (Object.keys(regions).length === 0) return null;

	const stateTwoWay = sumRep + sumDem;
	const stateMargin = stateTwoWay > 0 ? ((sumRep - sumDem) / stateTwoWay) * 100 : 0;

	return {
		id: `${race.office}-${year}`,
		office: race.office,
		year,
		label: `${year} ${OFFICE_LABEL[race.office]}`,
		// The head of the ticket, not the whole ticket. A picker line reading
		// "Reynolds vs Hubbell" is what a host scans for; "Kim Reynolds/Adam
		// Gregg vs Fred Hubbell/Rita Hart" is the same fact at four times the
		// width.
		candRep: titleCase(principalR),
		candDem: titleCase(principalD),
		// Surnames, baked because they're already computed here and every region
		// label is built from them — the detail card would otherwise have to
		// re-derive them from the full names and could disagree with the map.
		shortRep: labelR,
		shortDem: labelD,
		partisan,
		margin: Number(stateMargin.toFixed(2)),
		votesRep: sumRep,
		votesDem: sumDem,
		votesTotal: sumTotal,
		regions
	};
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Fold a second row for the same region into an existing snapshot. */
function mergeSnapshot(existing, snap, labelR, labelD) {
	if (!existing) return snap;
	const votesRep = existing.votesRep + snap.votesRep;
	const votesDem = existing.votesDem + snap.votesDem;
	const twoParty = votesRep + votesDem;
	const marginPct = twoParty > 0 ? ((votesRep - votesDem) / twoParty) * 100 : 0;
	return {
		color: colorFor(marginPct),
		// Rebuilt rather than patched: merging two spellings of one county can
		// flip which candidate led it, and editing the number out of the old
		// string would leave the loser's name in front of it.
		label: labelFor(marginPct, labelR, labelD),
		margin: Number(marginPct.toFixed(2)),
		votesRep,
		votesDem,
		votesTotal: existing.votesTotal + snap.votesTotal
	};
}

/**
 * Re-key a race's regions from county name onto the seed's `regionAttr`.
 *
 * Indexes the *source* names under two normalizations — the plain one, and one
 * that also drops "city" — and then asks that index for each county the seed
 * lists. This is deliberately the same direction as bake-historical-margins.mjs,
 * and the direction matters: it's what lets Virginia's 34 independent cities
 * find a home. The state reports them as "ALEXANDRIA CITY" while the map calls
 * the region "Alexandria", so a seed-side index only ever gets asked about
 * "alexandriacity" and misses every one of them — which is how Virginia's 2018
 * Senate baseline came out covering 95 of 129 regions and omitting Norfolk,
 * Virginia Beach and Richmond.
 *
 * Where a county and a city share a name (Richmond, Fairfax and Franklin all
 * exist as both), the plain index holds the county and the strip-city index
 * holds the city, so the seed's single region resolves to the county — the same
 * choice the presidential bake makes, which is the point: two baselines that
 * disagree about which Richmond a region is would produce a swing number
 * measured between two different places.
 */
function keyByRegionAttr(regions, seedCounties, labelR, labelD) {
	const byKey = new Map();
	const aliases = new Map();
	for (const [countyName, snap] of Object.entries(regions)) {
		const key = normalizeName(countyName);
		// Alaska reports statewide races by house district while its map is
		// boroughs, and a few states split one county across spellings. Either
		// way, rows landing on the same key are summed rather than dropped.
		byKey.set(key, mergeSnapshot(byKey.get(key), snap, labelR, labelD));
		const strip = normalizeNameStripCity(countyName);
		if (strip !== key && !aliases.has(strip)) aliases.set(strip, key);
	}

	const out = {};
	const used = new Set();
	for (const county of seedCounties) {
		const seedKey = normalizeName(county.name);
		const key = byKey.has(seedKey) ? seedKey : aliases.get(seedKey);
		if (key === undefined) continue;
		out[county.regionAttr] = byKey.get(key);
		used.add(key);
	}
	// Source counties no seed region claimed. Reported rather than silently
	// dropped: a nonzero count on a state that should match cleanly means the
	// source is reporting a geography the map doesn't draw.
	let unmatched = 0;
	for (const key of byKey.keys()) if (!used.has(key)) unmatched++;
	return { regions: out, unmatched };
}

async function main() {
	const args = process.argv.slice(2);
	const discoverMode = args.includes('--discover');
	const onlyYear = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;

	// state FIPS -> [race, ...], accumulated across every source.
	const byState = new Map();

	for (const source of SOURCES) {
		if (onlyYear && String(source.year) !== onlyYear) continue;
		const tag = `${source.year} ${source.offices.join('+')}`;
		console.log(`\n[${tag}] ${source.files.length} file(s), layout ${source.layout}`);

		const acc = new Map();
		const discovered = discoverMode ? new Set() : null;
		for (const spec of source.files) {
			let file;
			try {
				file = await ensureFile(spec.url);
			} catch (err) {
				// A per-state archive can be absent for a state that held no race
				// that cycle. That's data, not breakage.
				console.log(`  skip ${path.basename(spec.url)}: ${err.message.split('\n')[0]}`);
				continue;
			}
			const { rows, kept } = await ingest(
				file,
				spec.entry,
				source.layout,
				source.offices,
				acc,
				discovered
			);
			if (!discoverMode) {
				console.log(`  ${path.basename(spec.url)}: ${rows} rows -> ${kept} kept`);
			}
		}

		if (discoverMode) {
			console.log([...discovered].sort().join('\n') || '  (no senate/governor rows seen)');
			continue;
		}

		for (const race of acc.values()) {
			const summary = summarize(race, source.year);
			if (!summary) continue;
			const list = byState.get(race.stateFips) ?? [];
			list.push(summary);
			byState.set(race.stateFips, list);
		}
	}

	if (discoverMode) return;

	await fs.mkdir(OUT_DIR, { recursive: true });
	// Rewrite from scratch so a source removed from SOURCES doesn't leave a
	// stale race behind, which would keep offering a baseline the bake no
	// longer stands behind.
	for (const stale of await fs.readdir(OUT_DIR).catch(() => [])) {
		if (/^state-\d{2}\.json$/.test(stale)) await fs.unlink(path.resolve(OUT_DIR, stale));
	}

	let written = 0;
	const report = [];
	for (const [stateFips, races] of [...byState.entries()].sort()) {
		const seedPath = path.resolve(SEED_DIR, `state-${stateFips}.json`);
		let seed;
		try {
			seed = JSON.parse(await fs.readFile(seedPath, 'utf8'));
		} catch {
			console.log(`  state-${stateFips}: no county seed, skipping`);
			continue;
		}
		const counties = seed.counties ?? [];
		if (counties.length === 0) continue;

		const kept = [];
		for (const race of races.sort((a, b) => b.year - a.year || a.office.localeCompare(b.office))) {
			const { regions, unmatched } = keyByRegionAttr(
				race.regions,
				counties,
				race.shortRep,
				race.shortDem
			);
			const matched = Object.keys(regions).length;
			// A handful of matched counties out of a hundred means the source
			// reported that state by something other than county (Alaska by house
			// district, New England towns), and a baseline covering a tenth of the
			// map is worse than no baseline: the legend would advertise a
			// comparison the map can't draw.
			if (matched < Math.max(3, counties.length * 0.6)) {
				report.push(
					`  state-${stateFips} ${race.id}: dropped, only ${matched}/${counties.length} counties matched`
				);
				continue;
			}
			kept.push({ ...race, regions });
			report.push(
				`  state-${stateFips} ${race.id}: ${matched}/${counties.length} counties` +
					(unmatched ? `, ${unmatched} source rows unmatched` : '') +
					(race.partisan ? '' : ' (same-party contest, turnout only)')
			);
		}
		if (kept.length === 0) continue;

		const outPath = path.resolve(OUT_DIR, `state-${stateFips}.json`);
		await fs.writeFile(
			outPath,
			JSON.stringify({ stateFips, stateName: seed.stateName ?? '', races: kept }, null, 2) + '\n',
			'utf8'
		);
		written++;
	}

	console.log(`\n${report.join('\n')}`);
	if (unsplitTickets.size > 0) {
		console.log(
			`\n${unsplitTickets.size} ballot line(s) may be an unpunctuated joint ticket. If any of\n` +
				`these is two people, the map will label it with the wrong surname — add the\n` +
				`principal to TICKET_PRINCIPAL and re-run:\n` +
				[...unsplitTickets]
					.sort()
					.map((t) => `  ${t}`)
					.join('\n')
		);
	}
	console.log(`\nWrote ${written} state files to ${OUT_DIR}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
