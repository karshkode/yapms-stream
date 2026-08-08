import type { MapCameraState, StreamState } from '../stream-state';

/**
 * A SyncProvider moves StreamState from the desk to every overlay watching it.
 *
 * Two implementations: `BroadcastSync` reaches other tabs in the same browser
 * with no infrastructure at all, and `RoomSync` reaches anything that can load
 * the page, via the server. The desk publishes to both; an overlay listens to
 * whichever its URL implies.
 */
export interface SyncProvider {
	/** Fires when a peer publishes new state. Return `() => void` to unsubscribe. */
	onState(callback: (state: StreamState) => void): () => void;
	/**
	 * Fires when only the map camera moved — a pan or a zoom, which happens at
	 * gesture rates and would otherwise mean resending every region sixty times a
	 * second. Optional: a provider that always sends whole snapshots never calls
	 * it, and a consumer that doesn't implement it still sees the movement on the
	 * next full publish.
	 */
	onCamera?(callback: (camera: MapCameraState | null) => void): () => void;
	/** Publish the current state to peers. Fire-and-forget; best-effort. */
	publish(state: StreamState): void;
	/** Tear down. Called on page unload. */
	dispose(): void;
}

export type SyncRole = 'control' | 'overlay';
