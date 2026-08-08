<script lang="ts">
	import type { StreamState } from '$lib/stream-state';
	import { STATES_BY_ABBR } from '$lib/templates/states';

	interface Props {
		// Named `streamState` (not `state`) because Svelte 5 treats a local
		// `state` binding as ambiguous with the `$state` rune — every
		// `$state(...)` call in this file would otherwise be flagged as a
		// store subscription on the prop. Same workaround used by
		// FormsDrawer / StateRacesCard.
		streamState: StreamState;
		overlayUrl: string;
		/**
		 * Which room this desk publishes to. Shown because it is the one piece of
		 * setup that isn't automatic: a second person watching, or a second host
		 * taking over, needs the code, and reading it off the overlay URL means
		 * parsing a query string in your head.
		 */
		roomCode?: string;
		onRoomChange?: (code: string) => void;
		onToggleDrawer: () => void;
		/** Open the race search (RacePicker). */
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
		roomCode = '',
		onRoomChange,
		onToggleDrawer,
		onOpenPicker,
		onGoHome,
		onBackToState,
		onRefreshRace
	}: Props = $props();

	// Local while the host types, committed on blur or Enter: applying every
	// keystroke would move the desk into rooms "A", "AB", "ABC" on the way to
	// "ABCD", dragging every connected overlay through each one.
	let roomDraft = $state('');
	let editingRoom = $state(false);
	const roomShown = $derived(editingRoom ? roomDraft : roomCode);

	function startRoomEdit(input: HTMLInputElement) {
		roomDraft = roomCode;
		editingRoom = true;
		input.select();
	}
	function commitRoom() {
		editingRoom = false;
		if (roomDraft && roomDraft !== roomCode) onRoomChange?.(roomDraft);
	}

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

	// Only consulted on phone widths, where `.obs-row` is a popover. Wider
	// viewports render the same row inline and ignore this entirely (see the
	// `.obs-row` rules), so there's no need to mirror the breakpoint in JS.
	let obsOpen = $state(false);
	let obsWrap: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (!obsOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (obsWrap && !obsWrap.contains(e.target as Node)) obsOpen = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') obsOpen = false;
		};
		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('keydown', onKey);
		};
	});

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
		{#if streamState.race.title && streamState.profile?.id !== 'browse-us'}
			<span class="race-title">{streamState.race.title}</span>
		{/if}
		{#if streamState.profile && streamState.profile.id !== 'browse-us'}
			<span class="badge">{streamState.profile.label}</span>
		{/if}
	</div>

	<div class="actions">
		<!-- The one way in to race discovery. Styled as a search field rather
		     than a button because that is what it opens: a query box over
		     states, live civicAPI races and templates. It used to read
		     "Templates", with a separate Recent dropdown beside it, which put
		     the rarest corpus in the most prominent slot and split recall
		     across two menus. -->
		<button
			type="button"
			class="search-btn"
			title={`Search races (${modKey}+K)`}
			onclick={onOpenPicker}
		>
			<span class="search-icon" aria-hidden="true">⌕</span>
			<span class="search-text">Search races</span>
			<span class="search-keys"><kbd>{modKey}</kbd><kbd>K</kbd></span>
		</button>

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
		<!-- The archival year scrubber used to sit here: six pills that overlaid a
		     past presidential result as the map baseline. It was the widest thing
		     in the bar and it has been superseded twice over — Compare picks a
		     baseline (including a past race for the same office) and names it in
		     the legend, and the region card shows that race's own numbers. Six
		     buttons for the one baseline they duplicated wasn't worth the row.
		     `ui.archivalYear` stays in the schema and still paints when a saved
		     race carries a year; nothing sets it now. -->
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

		<!-- OBS wiring. Inline on a desktop, where there is room and the host is
		     actually setting up a browser source; folded behind the ⋯ button on a
		     phone, where two bright yellow buttons were dominating the toolbar
		     for a job nobody does from their phone. -->
		<div class="obs" bind:this={obsWrap}>
			<button
				type="button"
				class="obs-toggle"
				aria-expanded={obsOpen}
				aria-label="Overlay URL for OBS"
				title="Overlay URL for OBS"
				onclick={() => (obsOpen = !obsOpen)}
			>
				⋯
			</button>
			<div class="obs-row" class:open={obsOpen}>
				<label class="room" title="Overlays following this code see this desk. One desk per room.">
					<span>Room</span>
					<input
						type="text"
						class="room-input"
						maxlength="8"
						autocomplete="off"
						spellcheck="false"
						aria-label="Room code"
						value={roomShown}
						oninput={(e) => (roomDraft = (e.currentTarget as HTMLInputElement).value.toUpperCase())}
						onfocus={(e) => startRoomEdit(e.currentTarget as HTMLInputElement)}
						onblur={commitRoom}
						onkeydown={(e) => {
							if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
							if (e.key === 'Escape') {
								editingRoom = false;
								(e.currentTarget as HTMLInputElement).blur();
							}
						}}
					/>
				</label>
				<input
					type="text"
					class="url-input"
					readonly
					value={overlayUrl}
					aria-label="Overlay URL"
					onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
				/>
				<button type="button" onclick={copyOverlayUrl} title="Copy overlay URL">Copy</button>
				<a
					class="btn-link"
					href={roomCode ? `/overlay?room=${roomCode}` : '/overlay'}
					target="_blank"
					rel="noreferrer"
					title="Open the overlay in a new tab. Move the mouse there (or press F) for a fullscreen button — handy as a program-out display on a second monitor."
				>
					Open
				</a>
			</div>
		</div>
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
		/* Wrapping instead of overflowing matters below ~700px, where the brand
		   block plus the action buttons no longer fit on one line. */
		flex-wrap: wrap;
	}
	.brand {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
		flex-wrap: wrap;
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
		transition:
			background 120ms ease,
			color 120ms ease;
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
		/* Without a shrinkable basis the ellipsis never engages and a long
		   race title pushes the action buttons off-screen instead. */
		min-width: 0;
		flex: 0 1 auto;
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
		flex-wrap: wrap;
	}
	/* Reads as an input, behaves as a button. Signals "type here to find a
	   race" without duplicating the picker's own query box in the toolbar. */
	.search-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 11rem;
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: rgb(from var(--color-base-content) r g b / 0.7);
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.85rem;
		text-align: left;
	}
	.search-btn:hover {
		border-color: var(--color-primary);
		color: var(--color-base-content);
	}
	.search-icon {
		font-size: 1.05rem;
		line-height: 1;
	}
	.search-text {
		flex: 1 1 auto;
	}
	.search-keys {
		display: inline-flex;
		gap: 0.15rem;
		flex-shrink: 0;
	}
	.obs {
		position: relative;
		display: flex;
		align-items: center;
	}
	.obs-toggle {
		/* Phone-only affordance; wide viewports show `.obs-row` inline. */
		display: none;
		align-items: center;
		justify-content: center;
		min-width: 2.25rem;
		min-height: 2.25rem;
		background: var(--color-secondary);
		border: none;
		border-radius: 0.25rem;
		color: var(--color-base-content);
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
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
	.room {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.obs-row .room-input {
		width: 4.5rem;
		text-align: center;
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.obs-row .room-input:focus {
		border-color: var(--color-primary);
		outline: none;
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
		transition:
			background 120ms ease,
			color 120ms ease,
			border-color 120ms ease;
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
	/* Between a phone and a laptop the URL field is the first thing to go — the
	   Copy button covers the same need in a fraction of the width. Below 640px
	   the row becomes a popover where the field is wanted again, so this is
	   bounded at both ends. */
	@media (max-width: 980px) and (min-width: 641px) {
		/* The URL only — the room code is four characters and is the thing a host
		   reads out to whoever is watching, so it stays at every width. */
		.obs-row .url-input {
			display: none;
		}
	}
	/* Phone layout. Two stacked rows: identity on top, then one action row
	   where search takes all the leftover width and everything else is an
	   icon-sized control. Previously this wrapped into three-plus rows of
	   chrome above an already-cramped map. */
	@media (max-width: 640px) {
		.top-bar {
			padding: 0.4rem 0.5rem;
			gap: 0.4rem;
		}
		.brand,
		.actions {
			flex-basis: 100%;
		}
		.actions {
			gap: 0.35rem;
		}
		.brand h1 {
			font-size: 0.85rem;
		}
		.race-title {
			/* Full-width on its own line rather than competing with the
			   wordmark for the first row. */
			flex-basis: 100%;
		}
		/* Keyboard hints are noise on a touch device that has no ⌘, Ctrl,
		   or `e` key to press. */
		kbd {
			display: none;
		}
		/* Search is the primary action, so it absorbs the spare width instead
		   of leaving gaps between evenly-spread buttons. */
		.search-btn {
			flex: 1 1 auto;
			min-width: 0;
			min-height: 2.25rem;
		}
		.search-text {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		/* Touch targets. 2.25rem is the smallest that still reliably hits
		   with a thumb without making this dense toolbar taller than the
		   map it sits above. */
		.edit-btn,
		.refresh-race-btn,
		.back-state-btn,
		.obs-row button,
		.btn-link {
			min-height: 2.25rem;
			padding-inline: 0.7rem;
		}
		.edit-btn,
		.refresh-race-btn {
			flex-shrink: 0;
		}
		/* The wordmark doubles as the "reset to home map" button, so it needs
		   to be as tappable as the rest even though it reads as a heading. */
		.brand-btn {
			min-height: 2.25rem;
		}
		.obs-toggle {
			display: inline-flex;
			flex-shrink: 0;
		}
		/* Popover, anchored to the ⋯ button. Right-aligned so a wide URL field
		   grows into the viewport instead of off its edge. */
		.obs-row {
			display: none;
			position: absolute;
			top: calc(100% + 0.35rem);
			right: 0;
			z-index: 20;
			flex-wrap: wrap;
			justify-content: flex-end;
			width: max-content;
			max-width: min(88vw, 22rem);
			padding: 0.5rem;
			background: var(--color-base-200);
			border: 1px solid var(--color-secondary);
			border-radius: 0.375rem;
			box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
		}
		.obs-row.open {
			display: flex;
		}
		.obs-row input {
			width: 100%;
			min-height: 2.25rem;
		}
		/* Explicit order so the row reads search → edit → overflow, with the
		   two widest optional controls pushed onto a second line instead of
		   squeezing search down to an icon. Source order can't express this
		   because refresh has to stay adjacent to the race title on desktop. */
		.search-btn {
			order: 1;
		}
		.edit-btn {
			order: 2;
		}
		.obs {
			order: 3;
		}
		.refresh-race-btn {
			order: 4;
		}
	}
</style>
