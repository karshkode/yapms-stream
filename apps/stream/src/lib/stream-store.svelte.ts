import { DEFAULT_STREAM_STATE, StreamState as StreamStateSchema } from './stream-state';
import type { StreamState } from './stream-state';

/**
 * Single source of truth for the entire overlay app. Wrapped in a Svelte 5
 * $state rune so any component that imports `streamStore` and reads
 * `streamStore.state` re-renders on mutation.
 *
 * `/control` mutates this directly; `/overlay` mutates it indirectly via
 * BroadcastChannel messages applied by `sync/broadcast.ts`.
 */

class StreamStore {
	state = $state<StreamState>(structuredClone(DEFAULT_STREAM_STATE));

	replace(next: StreamState) {
		this.state = next;
	}

	/**
	 * Replace with state that came from somewhere we don't control, running it
	 * through the schema first. Returns false when it couldn't be used.
	 *
	 * State used to arrive only over a BroadcastChannel, where both ends are the
	 * same page of the same build and the payload is whatever this app just
	 * serialized. Through a room it can also come from a desk running an older
	 * build, or from anything that can POST — and an overlay that renders a
	 * partial snapshot doesn't degrade, it throws: a missing `ui.broadcast` is a
	 * TypeError inside the render, which on air means a blank scene that no longer
	 * recovers.
	 *
	 * Parsing rather than rejecting, because the schema's defaults are exactly the
	 * right answer for a field a different build didn't send.
	 */
	adopt(next: unknown): boolean {
		const parsed = StreamStateSchema.safeParse(next);
		if (!parsed.success) {
			console.warn('Ignoring unusable state from sync', parsed.error.issues.slice(0, 5));
			return false;
		}
		this.state = parsed.data;
		return true;
	}

	patch(partial: Partial<StreamState>) {
		this.state = { ...this.state, ...partial };
	}

	markDirty() {
		this.state.ui.dirty = true;
	}

	markClean() {
		this.state.ui.dirty = false;
	}
}

export const streamStore = new StreamStore();
