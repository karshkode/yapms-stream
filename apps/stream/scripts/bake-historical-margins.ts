#!/usr/bin/env node
/**
 * bake-historical-margins.ts
 *
 * Produces per-district Performance-section seed rows (past presidential /
 * senate / governor margins) for every district in every yapms district SVG.
 *
 * Input: MEDSL precinct-level returns
 *   https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/7MRCU4
 * Output: `src/lib/templates/seed-data/district-<svg>-<districtId>.json`
 *
 * For each district (identified by its SVG + `region` attr), we aggregate
 * precinct-level returns that fall inside the district's geometry (by
 * precinct -> county -> district cross-walk that ships with MEDSL) and
 * compute a past-race margin. The overlay then shows these rows in the
 * Performance section when the host loads a district template.
 *
 * Status: scaffold — body is deferred past MVP. Running the script now emits
 * empty seed files so the templates module loads without errors, and the
 * full implementation can slot in without changing the schema.
 *
 * Run:
 *     cd apps/stream
 *     npx tsx scripts/bake-historical-margins.ts
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(ROOT, 'src', 'lib', 'templates', 'seed-data');

async function main() {
	await fs.mkdir(OUT_DIR, { recursive: true });
	console.warn(
		'bake-historical-margins: scaffold only. Implement MEDSL precinct aggregation before MVP+1.'
	);
	// TODO:
	//   1. Download MEDSL precinct-level CSVs (one per state-year).
	//   2. Load the precinct -> district crosswalk (US Census TIGER + per-state
	//      SoS precinct shapes). The easy path is to fetch `openelections`' own
	//      precinct/district mapping tables where they exist.
	//   3. Aggregate votes per (svg, region, contest) and compute margin / shift
	//      vs the prior cycle.
	//   4. Emit `district-<svg-basename>-<regionId>.json`.
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
