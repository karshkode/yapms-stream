import type { DataSource, DataSourceKind, StreamStatePatch } from './source';

/**
 * DDHQ paid adapter (stub, deferred behind feature flag).
 *
 * Decision Desk HQ offers a commercial API at ~$15K/yr that's effectively the
 * ground truth for US election-night results (they run a full decision desk).
 * Leaving this as a stub lets a future host who subscribes drop their API key
 * into `streamState.dataSource.ddhqKey` and flip on the adapter without
 * touching the rest of the pipeline.
 *
 * For MVP: civicAPI covers the free path. This file exists so the merge layer
 * and DataSourcePanel know the adapter is first-class, not a retrofit.
 */
export class DdhqSource implements DataSource {
	kind: DataSourceKind = 'ddhq';

	constructor(private apiKey: string) {}

	async fetchRace(_raceId: string): Promise<StreamStatePatch> {
		if (!this.apiKey) throw new Error('DDHQ: no API key');
		// TODO: hit https://api.decisiondeskhq.com/... once the host subscribes.
		// Response shape is almost a direct map to StreamStatePatch.
		throw new Error('DDHQ adapter not implemented (paid API, deferred)');
	}
}
