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

/**
 * How long a viewer waits for the event stream to prove itself before switching
 * to polling.
 *
 * The server sends something the instant the stream opens, so on any working
 * path this is decided in milliseconds and the timer never fires. It exists for
 * the path that returns a perfectly valid 200 and then delivers nothing:
 * Cloudflare's edge buffers an event stream through a quick tunnel, which is how
 * a host shares their desk with anyone off their network.
 */
const STREAM_PROOF_MS = 2500;

/** Poll cadence once the stream has been given up on. */
const POLL_MS = 700;

export class RoomSync implements SyncProvider {
	private listeners = new Set<(state: StreamState) => void>();
	private cameraListeners = new Set<(camera: MapCameraState | null) => void>();
	private source: EventSource | null = null;
	private lastPublishedJson: string | null = null;
	private lastPublishAt = 0;
	private pending: StreamState | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;
	/** Cleared by the first frame the stream delivers. */
	private proofTimer: ReturnType<typeof setTimeout> | null = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	/** Versions the server has told us about, so a poll asks for the delta. */
	private version = 0;
	private cameraVersion = 0;
	/** Which way this viewer is actually receiving. Read for diagnostics. */
	transport: 'stream' | 'poll' | 'idle' = 'idle';

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

		const alive = () => {
			this.transport = 'stream';
			if (this.proofTimer) {
				clearTimeout(this.proofTimer);
				this.proofTimer = null;
			}
		};

		// One envelope shape for both transports, so the stream and the poll can't
		// disagree about what an update means.
		source.addEventListener('update', (event) => {
			alive();
			this.apply((event as MessageEvent).data);
		});
		source.addEventListener('waiting', alive);

		// EventSource reconnects on its own, and on reconnect the server replays the
		// current snapshot — so a hiccup costs a second of staleness. A hard error
		// before anything has arrived is a path that won't stream at all.
		source.addEventListener('error', () => {
			if (this.transport !== 'stream') this.startPolling();
		});

		this.proofTimer = setTimeout(() => this.startPolling(), STREAM_PROOF_MS);
	}

	/**
	 * Give up on the stream and ask repeatedly instead.
	 *
	 * Deliberately one-way: a path that buffered the stream once will buffer it
	 * again, and flapping between transports would cost a gap in coverage each
	 * time. Polling is a little less immediate and completely reliable, which is
	 * the right trade for the surface that's on air.
	 */
	private startPolling() {
		if (this.disposed || this.pollTimer) return;
		this.transport = 'poll';
		if (this.proofTimer) {
			clearTimeout(this.proofTimer);
			this.proofTimer = null;
		}
		this.source?.close();
		this.source = null;

		const tick = async () => {
			if (this.disposed) return;
			try {
				const res = await fetch(`${this.url}?poll=1&v=${this.version}&cv=${this.cameraVersion}`, {
					cache: 'no-store'
				});
				if (res.ok) this.apply(await res.text());
			} catch {
				// Server down or offline. The next tick tries again; there is nothing
				// here worth surfacing that the stale scene doesn't already say.
			}
		};

		void tick();
		this.pollTimer = setInterval(() => void tick(), POLL_MS);
	}

	/**
	 * Hand an update to the listeners, unless it's older than one already applied.
	 *
	 * The version check is the whole reason updates are versioned: a proxy that
	 * buffered the event stream can release it after this viewer has fallen back
	 * to polling and moved on, and applying that backlog would walk the overlay
	 * backwards — in testing, all the way back to "waiting for the desk".
	 */
	private apply(raw: string) {
		let body: { v?: number; cv?: number; state?: StreamState; camera?: MapCameraState | null };
		try {
			body = JSON.parse(raw);
		} catch {
			// A malformed frame is dropped rather than allowed to take the overlay
			// down; the next publish is a complete snapshot.
			return;
		}
		const v = body.v ?? 0;
		const cv = body.cv ?? 0;

		if (body.state) {
			if (v < this.version) return;
			this.version = v;
			this.cameraVersion = cv;
			for (const cb of this.listeners) cb(body.state);
			return;
		}
		if (body.camera !== undefined) {
			if (cv <= this.cameraVersion && v <= this.version) return;
			this.cameraVersion = cv;
			for (const cb of this.cameraListeners) cb(body.camera ?? null);
			return;
		}
		// An idle poll reply: nothing but the counters, which still move us forward
		// so the next request asks for the right delta.
		this.version = Math.max(this.version, v);
		this.cameraVersion = Math.max(this.cameraVersion, cv);
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
		if (this.proofTimer) clearTimeout(this.proofTimer);
		this.proofTimer = null;
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = null;
		this.source?.close();
		this.source = null;
		this.listeners.clear();
		this.cameraListeners.clear();
		this.transport = 'idle';
	}
}
