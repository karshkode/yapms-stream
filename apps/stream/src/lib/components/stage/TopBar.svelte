<script lang="ts">
	import type { RaceTemplate } from '$lib/race-profile';
	import type { RecentRaceRef, StreamState } from '$lib/stream-state';
	import { STATES_BY_ABBR } from '$lib/templates/states';
	import ArchivalSlider from './ArchivalSlider.svelte';
	import RecentDropdown from './RecentDropdown.svelte';

	interface Props {
		// Named `streamState` (not `state`) because Svelte 5 treats a local
		// `state` binding as ambiguous with the `$state` rune — every
		// `$state(...)` call in this file would otherwise be flagged as a
		// store subscription on the prop. Same workaround used by
		// FormsDrawer / StateRacesCard / RecentDropdown.
		streamState: StreamState;
		overlayUrl: string;
		onToggleDrawer: () => void;
		onOpenPicker: () => void;
		/** Return to the blank US map homepage. Host-triggered by clicking the
		 * "YAPms Stream" brand wordmark — mirrors every webapp nav pattern
		 * where clicking the logo resets to the root view. */
		onGoHome?: () => void;
		/** Re-open the StateRacesCard for the state the host originally
		 * drilled into. Lets them hop between races in the same state
		 * without losing context. Bound to `ui.homeStateAbbr`; the parent
		 * (`/control/+page.svelte`) implements the actual reset + replay
		 * because it owns the browse-us template + dataSource lifecycle. */
		onBackToState?: () => void;
		/** Open the StateRacesCard for an arbitrary state abbr. Powers the
		 * Recent dropdown's States section. Same flow as `onBackToState`
		 * but parameterized — same parent owns the implementation. */
		onPickRecentState?: (abbr: string) => void;
		/** Re-apply a recent race entry. Drives the Recent dropdown's
		 * Races section. Parent re-uses RacePicker's `handleApply`
		 * pipeline so polling resumes against the original civicAPI id. */
		onPickRecentRace?: (ref: RecentRaceRef, template: RaceTemplate) => void;
		/** One-shot pull of the latest civicAPI data for the active race.
		 * Visible only when a civicAPI race is loaded. Useful when the
		 * regular poll is paused (host drilled into a region) or just
		 * impatient — beats waiting for the next interval tick. The parent
		 * (`/control/+page.svelte`) owns the actual fetch + state-merge
		 * because it already has the `civicApi` instance and the patch-
		 * application pipeline wired. */
		onRefreshRace?: () => void | Promise<void>;
	}

	let {
		streamState,
		overlayUrl,
		onToggleDrawer,
		onOpenPicker,
		onGoHome,
		onBackToState,
		onPickRecentState,
		onPickRecentRace,
		onRefreshRace
	}: Props = $props();

	// Local "currently refreshing" flag. We don't lift this into the parent
	// because the visual feedback is purely local — the parent doesn't need
	// to gate other behavior on it. Resets after the parent's promise settles.
	let refreshingRace = $state(false);
	async function handleRefreshClick() {
		if (!onRefreshRace || refreshingRace) return;
		refreshingRace = true;
		try {
			await onRefreshRace();
		} finally {
			refreshingRace = false;
		}
	}

	// Show the refresh button only when there's an active civicAPI race to
	// refresh — manual / archival templates don't have a remote source so
	// the button would be a no-op (the data IS the local state).
	let canRefreshRace = $derived(
		!!onRefreshRace &&
			streamState.dataSource.adapter === 'civicapi' &&
			!!streamState.dataSource.raceId
	);

	// 5s tick counter so the "Xs ago" label refreshes without depending on
	// new poll data — without this, a label of "just now" would stick at
	// "just now" until the next civicAPI tick mutated `lastPolledAt`.
	let lastUpdateTick = $state(0);
	$effect(() => {
		const id = setInterval(() => {
			lastUpdateTick++;
		}, 5_000);
		return () => clearInterval(id);
	});

	// "Last updated" hint. civicAPI's poll loop stamps `lastPolledAt` on
	// every successful tick; we render the relative gap so the host can
	// gauge data freshness at a glance ("just now", "12s ago", "2m ago").
	// Reads `lastUpdateTick` so it re-derives every 5s.
	let lastUpdatedLabel = $derived.by(() => {
		void lastUpdateTick;
		const at = streamState.dataSource.lastPolledAt;
		if (!at) return null;
		const diffMs = Date.now() - at;
		if (diffMs < 5_000) return 'just now';
		if (diffMs < 60_000) return `${Math.round(diffMs / 1000)}s ago`;
		if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
		return `${Math.round(diffMs / 3_600_000)}h ago`;
	});

	// Resolve the homeStateAbbr to a friendly display name ("KY" -> "Kentucky")
	// so the back button reads naturally. Returns null when:
	//   - no state was drilled from (homeStateAbbr=null)
	//   - we're already on the browse-us shell (no point showing "← All KY"
	//     when the host can already see the state on the map)
	let homeStateName = $derived.by(() => {
		const abbr = streamState.ui.homeStateAbbr;
		if (!abbr) return null;
		if (streamState.profile?.id === 'browse-us') return null;
		return STATES_BY_ABBR[abbr.toUpperCase()]?.name ?? abbr;
	});

	function copyOverlayUrl() {
		navigator.clipboard.writeText(overlayUrl);
	}

	// macOS / Windows key hint. Navigator.platform is deprecated but still the
	// most widely-shipped way to detect macOS in a pure-client context without
	// pulling in UA parsing. Falls back to Ctrl on unknown platforms.
	let modKey = $derived(
		typeof navigator !== 'undefined' && /Mac|iP(ad|od|hone)/.test(navigator.platform) ? '⌘' : 'Ctrl'
	);
</script>

<header class="top-bar">
	<div class="brand">
		<button
			type="button"
			class="brand-btn"
			onclick={() => onGoHome?.()}
			title="Return to the US map home"
			aria-label="Return to home map"
		>
			<h1>YAPms Stream</h1>
		</button>
		{#if homeStateName && onBackToState}
			<button
				type="button"
				class="back-state-btn"
				title={`Back to ${homeStateName} race list`}
				onclick={() => onBackToState?.()}
			>
				← All {homeStateName} races
			</button>
		{/if}
		{#if onPickRecentState && onPickRecentRace}
			<RecentDropdown
				{streamState}
				onPickState={(abbr) => onPickRecentState?.(abbr)}
				onPickRace={(ref, template) => onPickRecentRace?.(ref, template)}
			/>
		{/if}
		{#if streamState.race.title && streamState.profile?.id !== 'browse-us'}
			<span class="race-title">{streamState.race.title}</span>
		{/if}
		{#if streamState.profile && streamState.profile.id !== 'browse-us'}
			<span class="badge">{streamState.profile.label}</span>
		{/if}
	</div>

	<div class="actions">
		{#if canRefreshRace}
			<button
				type="button"
				class="refresh-race-btn"
				class:spinning={refreshingRace}
				disabled={refreshingRace}
				onclick={handleRefreshClick}
				title={lastUpdatedLabel
					? `Refresh live data (last updated ${lastUpdatedLabel})`
					: 'Refresh live data now'}
				aria-label="Refresh live race data"
			>
				<span class="refresh-icon" aria-hidden="true">↻</span>
				<span class="refresh-label">
					{#if refreshingRace}
						Refreshing…
					{:else if lastUpdatedLabel}
						{lastUpdatedLabel}
					{:else}
						Refresh
					{/if}
				</span>
			</button>
		{/if}
		<ArchivalSlider state={streamState} />

		<button type="button" class="picker-btn" title={`${modKey}+K`} onclick={onOpenPicker}>
			<span>Templates</span>
			<kbd>{modKey}</kbd><kbd>K</kbd>
		</button>

		<div class="obs-row">
			<input
				type="text"
				readonly
				value={overlayUrl}
				onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
			/>
			<button type="button" onclick={copyOverlayUrl} title="Copy overlay URL">Copy</button>
			<a class="btn-link" href="/overlay" target="_blank" rel="noreferrer">Open</a>
		</div>

		<button
			type="button"
			class="edit-btn"
			class:active={streamState.ui.drawerOpen}
			title="Toggle edit drawer (e)"
			onclick={onToggleDrawer}
		>
			{streamState.ui.drawerOpen ? 'Close edit' : 'Edit'}
			<kbd>e</kbd>
		</button>
	</div>
</header>

<style>
	.top-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.75rem;
		background: var(--color-base-200);
		border-bottom: 1px solid var(--color-secondary);
		gap: 0.75rem;
		flex-shrink: 0;
	}
	.brand {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}
	.brand-btn {
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		color: inherit;
		display: inline-flex;
		align-items: center;
	}
	.brand-btn:hover h1 {
		color: var(--color-primary);
	}
	.back-state-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--color-secondary);
		color: var(--color-base-content);
		border: 1px solid rgb(from var(--color-base-content) r g b / 0.2);
		border-radius: 0.3rem;
		cursor: pointer;
		white-space: nowrap;
		transition: background 120ms ease, color 120ms ease;
	}
	.back-state-btn:hover {
		background: var(--color-primary);
		color: var(--color-primary-content);
		border-color: var(--color-primary);
	}
	.brand h1 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
		white-space: nowrap;
		transition: color 120ms ease;
	}
	.race-title {
		font-size: 0.85rem;
		color: rgb(from var(--color-base-content) r g b / 0.85);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.375rem;
		border-radius: 0.25rem;
		background: var(--color-primary);
		color: var(--color-primary-content);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.picker-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		background: var(--color-secondary);
		border: none;
		color: var(--color-base-content);
		padding: 0.375rem 0.625rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.picker-btn:hover {
		background: var(--color-primary);
		color: var(--color-primary-content);
	}
	.obs-row {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}
	.obs-row input {
		width: 16rem;
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
	}
	.obs-row button,
	.btn-link {
		padding: 0.25rem 0.5rem;
		background: var(--color-primary);
		color: var(--color-primary-content);
		border: none;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		cursor: pointer;
		text-decoration: none;
		font-weight: 600;
	}
	.edit-btn {
		background: var(--color-secondary);
		border: none;
		color: var(--color-base-content);
		padding: 0.375rem 0.625rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.85rem;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.edit-btn.active {
		background: var(--color-primary);
		color: var(--color-primary-content);
	}
	.refresh-race-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.55rem;
		background: var(--color-secondary);
		border: 1px solid rgb(from var(--color-base-content) r g b / 0.2);
		color: var(--color-base-content);
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.78rem;
		font-weight: 600;
		transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
	}
	.refresh-race-btn:hover:not(:disabled) {
		background: var(--color-primary);
		color: var(--color-primary-content);
		border-color: var(--color-primary);
	}
	.refresh-race-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.refresh-race-btn .refresh-icon {
		font-size: 0.95rem;
		line-height: 1;
		display: inline-block;
	}
	.refresh-race-btn.spinning .refresh-icon {
		animation: top-bar-spin 1s linear infinite;
	}
	.refresh-race-btn .refresh-label {
		font-size: 0.7rem;
		font-style: italic;
		color: rgb(from var(--color-base-content) r g b / 0.75);
	}
	.refresh-race-btn:hover:not(:disabled) .refresh-label {
		color: var(--color-primary-content);
	}
	@keyframes top-bar-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	kbd {
		background: rgb(from var(--color-base-content) r g b / 0.1);
		padding: 0.05rem 0.25rem;
		border-radius: 0.15rem;
		font-family: ui-monospace, monospace;
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.8);
	}
	@media (max-width: 980px) {
		.obs-row input {
			display: none;
		}
	}
</style>
