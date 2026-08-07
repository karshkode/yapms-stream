/**
 * Ballotpedia adapter (deferred) — candidate headshots + short bios for the
 * candidate editor autocomplete.
 *
 * Not a DataSource in the StreamState sense (no vote totals). Used from a
 * "Enrich with Ballotpedia" button on /control that fills in headshot URLs
 * for the current candidate list. Requires an API key.
 *
 * Stubbed for MVP; manual headshot URLs work today via the Candidate editor.
 */

export interface BallotpediaEnrichment {
	name: string;
	headshotUrl: string | null;
	partyLabel: string | null;
	bioUrl: string | null;
}

export class BallotpediaSource {
	constructor(private _apiKey: string) {}

	async lookupCandidates(_names: string[]): Promise<BallotpediaEnrichment[]> {
		throw new Error('Ballotpedia adapter not implemented (deferred)');
	}
}
