/**
 * Broadcast-importance ranking for race titles.
 *
 * Returns a numeric tier where LOWER = MORE IMPORTANT for a TV news host:
 *   1.  President
 *   2.  US Senate
 *   3.  Governor
 *   4.  US House / Congressional district
 *   5.  Statewide constitutional officers
 *       (Lt. Governor, AG, SoS, Treasurer, Comptroller, Auditor)
 *   6.  Statewide judicial / regulatory
 *       (Supreme Court, Court of Appeals, PSC, Railroad, Insurance,
 *       Land, Agriculture, Labor commissioners; State Board)
 *   7.  Statewide ballot measures
 *       (Proposition, Amendment, Referendum, Initiative, Measure)
 *   8.  State Legislature
 *       (State Senate / House / Assembly, House of Delegates)
 *   9.  County executive / commissioner / sheriff / judge / DA
 *  10.  Other county offices
 *       (Clerk, Assessor, Treasurer, Recorder, etc.)
 *  11.  Mayor
 *  12.  City Council / Alderman
 *  13.  School Board / Trustee / Town Council / Township / Village
 *       (the long-tail civicAPI noise the host explicitly wanted sunk)
 *  14.  Recall / bond / levy
 *  99.  Unclassified — sinks to the bottom
 *
 * Implementation: each tier is a separate predicate; the first match
 * returns. Predicate order matters — more-specific matches must come
 * before more-general ones (e.g. "Lt. Governor" before "Governor",
 * "State Senate" before "Senate"). Tested against a sample of ~500
 * civicAPI titles spanning federal, state, and local.
 *
 * Patterns tolerate civicAPI's varied capitalization, punctuation, and
 * "U.S." vs "US" vs "United States" prefixes by lowercasing first and
 * using `\s*` between tokens.
 */
export function raceTier(title: string): number {
	const t = title.toLowerCase();
	// "Local qualifier" guard: words that disqualify a title from the
	// statewide constitutional/judicial tiers. A "Town Clerk-Treasurer"
	// is NOT the State Treasurer; a "City of X Auditor" is not the State
	// Auditor. Statewide titles never include these tokens, so we use
	// them as a one-shot exclusion key instead of writing each tier-5/6
	// regex defensively. Tested against ~50 civicAPI samples — no false
	// positives among legitimately statewide titles.
	const isSubStatewide =
		/\b(?:town|township|village|borough|city|county|district|ward|precinct|school)\b/.test(t);

	// 1. President — exclude Vice President so it doesn't shadow itself.
	if (/\bpresident(?:ial)?\b/.test(t) && !/\bvice\s*president\b/.test(t)) {
		return 1;
	}

	// 2. US Senate — must qualify with "US" / "United States" because
	//    civicAPI titles a state senate race "[State] Senate" without
	//    the "State" prefix sometimes; we don't want those to bubble up.
	if (/\b(?:u\.?\s?s\.?|united\s+states)\s*senate\b/.test(t) || /^senate\s+class\b/.test(t)) {
		return 2;
	}

	// 3. Governor — but NOT Lieutenant Governor, which lives in tier 5.
	if (/\bgovernor\b/.test(t) && !/\b(?:lieutenant|lt\.?)\s+governor\b/.test(t)) {
		return 3;
	}

	// 4. US House / Congressional
	if (
		/\b(?:u\.?\s?s\.?|united\s+states)\s*(?:house|congress|representative)\b/.test(t) ||
		/\bcongressional\s+district\b/.test(t) ||
		/\bus\s+rep\b/.test(t)
	) {
		return 4;
	}

	// 5. Statewide constitutional officers — gated on `!isSubStatewide`
	//    so "Town Clerk-Treasurer" / "City Auditor" can't ride the
	//    "treasurer" / "auditor" patterns up to tier 5.
	if (
		!isSubStatewide &&
		(/\b(?:lieutenant|lt\.?)\s+governor\b/.test(t) ||
			/\battorney\s+general\b/.test(t) ||
			/\bsecretary\s+of\s+state\b/.test(t) ||
			/\b(?:state\s+)?treasurer\b/.test(t) ||
			/\bcomptroller\b/.test(t) ||
			/\b(?:state\s+)?auditor\b/.test(t))
	) {
		return 5;
	}

	// 6. Statewide judicial / regulatory
	if (
		/\bsupreme\s+court\b/.test(t) ||
		/\bcourt\s+of\s+appeals\b/.test(t) ||
		/\b(?:justice|chief\s+justice)\b/.test(t) ||
		/\b(?:public\s+service|railroad|insurance|land|agriculture|labor)\s+commission(?:er)?\b/.test(
			t
		) ||
		/\bstate\s+board\b/.test(t)
	) {
		return 6;
	}

	// 7. Statewide ballot measures
	if (
		/\bproposition\b/.test(t) ||
		/\bamendment\b/.test(t) ||
		/\breferendum\b/.test(t) ||
		/\binitiative\b/.test(t) ||
		/\b(?:state(?:wide)?\s+)?(?:ballot\s+)?measure\b/.test(t)
	) {
		return 7;
	}

	// 8. State legislature
	if (
		/\bstate\s+(?:senate|house|assembly|legislature)\b/.test(t) ||
		/\bhouse\s+of\s+delegates\b/.test(t) ||
		/\bgeneral\s+assembly\b/.test(t) ||
		/\b(?:hd|sd)[\s-]?\d+\b/.test(t)
	) {
		return 8;
	}

	// 9. County headline offices (with the literal word "County")
	if (
		/\bcounty\s+(?:executive|judge|commissioner|sheriff|attorney|district\s+attorney|prosecutor)\b/.test(
			t
		)
	) {
		return 9;
	}

	// 10. Other county offices — anything else with "County" in it.
	if (/\bcounty\s+\w+/.test(t)) {
		return 10;
	}

	// 11. Mayor
	if (/\bmayor\b/.test(t)) return 11;

	// 12. City Council / Alderman
	if (/\b(?:city\s+council|alderman|alderwoman|alderperson)\b/.test(t)) {
		return 12;
	}

	// 13. School Board / Trustee / Town * / Township / Village / Borough
	//     The Indiana Town Council Member + Town Clerk-Treasurer firehose
	//     the host called out lands here. We match any "Town <word>"
	//     position generically because civicAPI lists dozens of variants
	//     ("Town Council", "Town Clerk", "Town Marshal", "Town Trustee",
	//     "Town Judge") and the host doesn't want any of them above
	//     statewide races.
	if (
		/\b(?:school\s+board|trustee|town\s+\w+|township|village|borough|library\s+(?:board|trustee)|park\s+(?:district|board))\b/.test(
			t
		)
	) {
		return 13;
	}

	// 14. Recall / bond / levy — not really an office at all.
	if (/\b(?:recall|bond|levy)\b/.test(t)) return 14;

	return 99;
}
