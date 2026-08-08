import type { MapCameraState, StreamState } from '../stream-state';
import type { SyncProvider } from './types';

/**
 * State over the network, for the overlays that aren't in the host's browser.
 *
 * Same interface as the BroadcastChannel provider, so /control and /overlay don't
 * know which one they have — the difference is only reach. This one goes through
 * `/api/room/<code>`: POST to publish, EventSource to receive.
 *
 * Two things here are about the size of the payload rather than the plumbing.
 *
 * A full snapshot is a few tens of kilobytes and can be 180KB for a Texas county
 * map, because every region carries its baked presidential baselines. That's
 * nothing once per vote update, and far too much sixty times a second while the
 * host drags the map. So a publish whose *only* difference from the last one is
 * the map camera is sent as a camera message instead — four numbers. Everything
 * else still goes as a whole snapshot, which keeps the receiving side trivial:
 * there is no patch format to get wrong.
 *
 * And the publish is throttled on the trailing edge but never the leading one. A
 * gesture should start moving on the overlay immediately; it's the middle of the
 * burst that can be dropped, because each snapshot supersedes the last.
 */

const MIN_PUBLISH_GAP_MS = 120;

export class RoomSync implements SyncProvider {
	private listeners = new Set<(state: StreamState) => void>();
	private cameraListeners = new Set<(camera: MapCameraState | null) => void>();
	private source: EventSource | null = null;
	private lastPublishedJson: string | null = null;
	private lastPublishAt = 0;
	private pending: StreamState | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	constructor(
		private code: string,
		private role: 'control' | 'overlay'
	) {
		if (role === 'overlay') this.subscribe();
	}

	private get url(): string {
		return `/api/room/${encodeURIComponent(this.code)}`;
	}

	private subscribe() {
		const source = new EventSource(this.url);
		this.source = source;

		source.addEventListener('state', (event) => {
			try {
				const state = JSON.parse((event as MessageEvent).data) as StreamState;
				for (const cb of this.listeners) cb(state);
			} catch {
				// A malformed frame is dropped rather than allowed to take the overlay
				// down; the next publish is a complete snapshot.
			}
		});

		// A camera arrives on its own during a drag. Applying it to the state we
		// already have is what makes the drag look continuous instead of arriving
		// as a series of jumps between full snapshots.
		source.addEventListener('camera', (event) => {
			try {
				const camera = JSON.parse((event as MessageEvent).data) as MapCameraState | null;
				for (const cb of this.cameraListeners) cb(camera);
			} catch {
				/* ignore */
			}
		});

		// EventSource reconnects on its own, and on reconnect the server replays the
		// current snapshot — so a tunnel hiccup costs a second of staleness and
		// needs no handling here beyond not tearing the thing down.
	}

	onState(callback: (state: StreamState) => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	onCamera(callback: (camera: MapCameraState | null) => void): () => void {
		this.cameraListeners.add(callback);
		return () => this.cameraListeners.delete(callback);
	}

	publish(state: StreamState): void {
		if (this.role !== 'control' || this.disposed) return;
		this.pending = state;
		const wait = Math.max(0, MIN_PUBLISH_GAP_MS - (Date.now() - this.lastPublishAt));
		if (wait === 0) {
			this.flush();
			return;
		}
		if (!this.timer) this.timer = setTimeout(() => this.flush(), wait);
	}

	private flush() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const state = this.pending;
		this.pending = null;
		if (!state || this.disposed) return;

		// Svelte 5 proxies aren't serializable as-is, and we need the JSON anyway to
		// tell "nothing changed" from "only the camera changed".
		const json = JSON.stringify(state);
		if (json === this.lastPublishedJson) return;
		this.lastPublishAt = Date.now();

		const body =
			this.cameraOnlyBody(json) ?? JSON.stringify({ type: 'state', state: JSON.parse(json) });
		this.lastPublishedJson = json;

		void fetch(this.url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			// The desk fires these constantly and never reads the answer; letting the
			// browser keep them in flight past a navigation avoids a truncated final
			// publish when the host closes the tab.
			keepalive: body.length < 60_000
		}).catch(() => {
			// Offline, or the server restarted. `lastPublishedJson` is already set, so
			// an identical retry would be skipped — clear it so the next change
			// republishes in full rather than assuming the peer is up to date.
			this.lastPublishedJson = null;
		});
	}

	/**
	 * A camera-only message when that's the sole difference, else null.
	 *
	 * Compared by blanking the camera on both sides: if the rest of the state is
	 * byte-identical, the camera is all that moved.
	 */
	private cameraOnlyBody(json: string): string | null {
		if (!this.lastPublishedJson) return null;
		try {
			const next = JSON.parse(json) as StreamState;
			const prev = JSON.parse(this.lastPublishedJson) as StreamState;
			const camera = next.ui.mapCamera;
			const a = { ...next, ui: { ...next.ui, mapCamera: null } };
			const b = { ...prev, ui: { ...prev.ui, mapCamera: null } };
			if (JSON.stringify(a) !== JSON.stringify(b)) return null;
			return JSON.stringify({ type: 'camera', camera });
		} catch {
			return null;
		}
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.source?.close();
		this.source = null;
		this.listeners.clear();
		this.cameraListeners.clear();
	}
}
