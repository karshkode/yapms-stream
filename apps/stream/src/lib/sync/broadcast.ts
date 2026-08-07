import type { StreamState } from '../stream-state';
import type { SyncProvider } from './types';

const CHANNEL_NAME = 'yapms-stream';

/**
 * BroadcastChannel-backed sync provider.
 *
 * /control publishes the full state on every mutation; /overlay subscribes and
 * replaces its local copy. This is deliberately not diff-based — the state is
 * small (<100KB even for a 50-state race) and structuredClone is fast enough
 * that the simplicity wins over diff complexity.
 *
 * On page boot, /overlay also sends a 'request-state' ping so it picks up
 * whatever /control already has without waiting for the next mutation.
 */
export class BroadcastSync implements SyncProvider {
	private channel: BroadcastChannel;
	private listeners = new Set<(state: StreamState) => void>();
	private lastPublished: StreamState | null = null;
	private lastPublishedJson: string | null = null;

	constructor(private role: 'control' | 'overlay') {
		this.channel = new BroadcastChannel(CHANNEL_NAME);
		this.channel.addEventListener('message', this.onMessage);

		// Overlay tabs ask for current state on boot; the control tab responds
		// with whatever it has. This closes the race where /overlay loads in
		// OBS *before* /control pushes its first message.
		if (role === 'overlay') {
			this.channel.postMessage({ type: 'request-state' });
		}
	}

	private onMessage = (event: MessageEvent) => {
		const msg = event.data;
		if (!msg || typeof msg !== 'object') return;

		if (msg.type === 'state' && msg.state) {
			for (const cb of this.listeners) cb(msg.state as StreamState);
		} else if (msg.type === 'request-state' && this.role === 'control' && this.lastPublished) {
			this.channel.postMessage({ type: 'state', state: this.lastPublished });
		}
	};

	onState(callback: (state: StreamState) => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	publish(state: StreamState): void {
		// Only control tabs should publish; overlay tabs are read-only receivers.
		if (this.role !== 'control') return;
		// Svelte 5 $state proxies aren't structured-cloneable; JSON round-trip
		// strips them to plain objects before postMessage. We also skip publishing
		// when the payload hasn't changed to avoid flooding the channel (the
		// control tab calls publish() on a 250ms tick regardless of mutations).
		const snapshot = JSON.parse(JSON.stringify(state)) as StreamState;
		const serialized = JSON.stringify(snapshot);
		if (this.lastPublishedJson === serialized) return;
		this.lastPublished = snapshot;
		this.lastPublishedJson = serialized;
		this.channel.postMessage({ type: 'state', state: snapshot });
	}

	dispose(): void {
		this.channel.removeEventListener('message', this.onMessage);
		this.channel.close();
		this.listeners.clear();
	}
}

export function createBroadcastSync(role: 'control' | 'overlay'): SyncProvider {
	return new BroadcastSync(role);
}
