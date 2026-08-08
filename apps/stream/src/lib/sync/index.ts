import type { MapCameraState, StreamState } from '../stream-state';
import { BroadcastSync } from './broadcast';
import { RoomSync } from './room';
import type { SyncProvider } from './types';

/**
 * Which transports a surface uses, and why it isn't just one.
 *
 * The desk publishes to both. BroadcastChannel is instant, free and needs no
 * server, so another tab in the same browser — the host's own preview — should
 * keep using it. But it cannot reach OBS, whose Browser Source is a separate
 * embedded browser, and it cannot reach a phone. Those get the room.
 *
 * An overlay listens to exactly one, decided by its URL: a code means the room,
 * no code means the local channel. Listening to both would let two sources of
 * truth race, and the older, narrower one would sometimes win.
 */

class Fanout implements SyncProvider {
	constructor(private providers: SyncProvider[]) {}

	onState(callback: (state: StreamState) => void): () => void {
		const offs = this.providers.map((p) => p.onState(callback));
		return () => offs.forEach((off) => off());
	}

	onCamera(callback: (camera: MapCameraState | null) => void): () => void {
		const offs = this.providers
			.filter((p) => typeof p.onCamera === 'function')
			.map((p) => p.onCamera!(callback));
		return () => offs.forEach((off) => off());
	}

	publish(state: StreamState): void {
		for (const p of this.providers) p.publish(state);
	}

	dispose(): void {
		for (const p of this.providers) p.dispose();
	}
}

/**
 * The desk's publisher: the local channel plus the room, when it has one.
 */
export function createDeskSync(roomCode: string): SyncProvider {
	const providers: SyncProvider[] = [new BroadcastSync('control')];
	if (roomCode) providers.push(new RoomSync(roomCode, 'control'));
	return new Fanout(providers);
}

/**
 * An overlay's subscriber. A room code wins; without one it falls back to the
 * same-browser channel, which is what every existing bookmark relies on.
 */
export function createOverlaySync(roomCode: string): SyncProvider {
	return roomCode ? new RoomSync(roomCode, 'overlay') : new BroadcastSync('overlay');
}
