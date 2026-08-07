import type { Candidate } from '../race-profile';

/**
 * OpenFEC adapter (https://api.open.fec.gov/developers).
 *
 * Free with an API key; 1000 req/hr. Metadata-only: names, parties, FEC
 * candidate IDs — no vote totals. Used from a "Load federal candidates" button
 * on /control to auto-populate the candidate editor for federal races
 * (US President, Senate, House primaries and generals).
 *
 * The key is stored in `streamState.dataSource.openFecKey` (wired from the
 * DataSourcePanel). If the key is empty, the adapter returns an empty list
 * with a warning rather than throwing.
 */

const BASE = 'https://api.open.fec.gov/v1';

export interface OpenFecCandidate {
	candidate_id: string;
	name: string;
	party: string;
	office: string;
	state: string;
	district?: string;
	incumbent_challenge_full?: string;
}

export class OpenFecSource {
	constructor(private apiKey: string) {}

	async searchCandidates(opts: {
		office: 'P' | 'S' | 'H';
		state?: string;
		district?: string;
		cycle?: number;
	}): Promise<OpenFecCandidate[]> {
		if (!this.apiKey) {
			console.warn('OpenFEC: no API key set');
			return [];
		}
		const params = new URLSearchParams({
			api_key: this.apiKey,
			office: opts.office,
			sort: 'name',
			per_page: '100'
		});
		if (opts.state) params.set('state', opts.state);
		if (opts.district) params.set('district', opts.district);
		if (opts.cycle) params.set('cycle', String(opts.cycle));

		const res = await fetch(`${BASE}/candidates/?${params.toString()}`);
		if (!res.ok) throw new Error(`OpenFEC ${res.status}`);
		const data = (await res.json()) as { results?: OpenFecCandidate[] };
		return data.results ?? [];
	}

	toCandidates(
		rows: OpenFecCandidate[],
		partyColor: (party: string) => string
	): Candidate[] {
		return rows.map((r, i) => ({
			id: r.candidate_id ?? `openfec-${i}`,
			name: r.name,
			partyLabel: r.party,
			partyColor: partyColor(r.party),
			votes: 0,
			called: false,
			hidden: false,
			headshotUrl: null
		}));
	}
}
