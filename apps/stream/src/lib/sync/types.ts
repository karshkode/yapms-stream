import type { StreamState } from '../stream-state';

/**
 * A SyncProvider moves StreamState across browser tabs / machines / processes.
 * v1 ships a BroadcastChannel implementation (same machine, zero infra); a
 * future PocketBase provider can implement the same interface to sync across
 * machines for remote hosts.
 */
export interface SyncProvider {
	/** Fires when a peer publishes new state. Return `() => void` to unsubscribe. */
	onState(callback: (state: StreamState) => void): () => void;
	/** Publish the current state to peers. Fire-and-forget; best-effort. */
	publish(state: StreamState): void;
	/** Tear down. Called on page unload. */
	dispose(): void;
}

export type SyncRole = 'control' | 'overlay';
