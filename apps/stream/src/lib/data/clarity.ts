import type { DataSource, DataSourceKind, StreamStatePatch } from './source';

/**
 * Clarity (deferred) — wraps the Python `apps/elections-scraper/` sidecar,
 * which in turn wraps https://github.com/washingtonpost/elex-clarity to
 * scrape SOE Software's Clarity election-night feeds.
 *
 * Clarity covers ~12+ states that run on the SOE platform (GA, KY, AR, NM,
 * parts of CA, etc.). The Node adapter here just hits the sidecar's JSON
 * surface; all scraping / zip unpacking happens in Python.
 *
 * TODO: wire up once the sidecar is running. MVP ships without this — manual
 * entry plus civicAPI is enough for May 5.
 */
export class ClaritySource implements DataSource {
	kind: DataSourceKind = 'clarity';

	constructor(private sidecarUrl: string) {}

	async fetchRace(raceId: string): Promise<StreamStatePatch> {
		const [state, electionId] = raceId.split(':');
		const url = `${this.sidecarUrl}/races/${state}/${electionId}/results`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Clarity sidecar ${res.status}`);
		const data = (await res.json()) as StreamStatePatch;
		return data;
	}

	async *pollRace(raceId: string, intervalMs: number): AsyncIterable<StreamStatePatch> {
		while (true) {
			try {
				yield await this.fetchRace(raceId);
			} catch (err) {
				console.warn('Clarity poll error:', err);
			}
			await new Promise((r) => setTimeout(r, intervalMs));
		}
	}
}
