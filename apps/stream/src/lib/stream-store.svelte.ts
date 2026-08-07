import { DEFAULT_STREAM_STATE, type StreamState } from './stream-state';

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
