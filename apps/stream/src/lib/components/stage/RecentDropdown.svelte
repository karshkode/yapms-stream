<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { RecentRaceRef, StreamState } from '$lib/stream-state';
	import { STATES_BY_ABBR } from '$lib/templates/states';
	import { hydrateTemplateById } from '$lib/templates';
	import type { RaceTemplate } from '$lib/race-profile';

	interface Props {
		// Named `streamState` (not `state`) because Svelte 5 treats a
		// local `state` binding as a store subscription and conflicts with
		// the `$state` rune used below for `open` / `buttonEl` / `menuEl`.
		// Same workaround as FormsDrawer.svelte / StateRacesCard.svelte.
		streamState: StreamState;
		/** Reload the StateRacesCard for the given state abbr. Routed to
		 * /control/+page.svelte's `pickRecentState` so it can replay the same
		 * "browse-us shell + selectedRegionAttr" trick the back button uses. */
		onPickState: (abbr: string) => void;
		/** Re-apply a recent civicAPI/template race entry. The parent owns
		 * the actual `applyTemplate` + polling restart pipeline (it's the
		 * same one RacePicker uses) so the dropdown stays a thin view. */
		onPickRace: (ref: RecentRaceRef, template: RaceTemplate) => void;
	}

	let { streamState, onPickState, onPickRace }: Props = $props();

	let open = $state(false);
	let buttonEl: HTMLButtonElement | null = $state(null);
	let menuEl: HTMLDivElement | null = $state(null);

	// Resolve abbr → "Kentucky" for the chip label. Filter out unknown
	// abbrs (defensive: stale state from a localStorage written before a
	// future schema change). Limited to 8 by `pushRecentState` so we
	// don't need to slice further here.
	const stateRows = $derived.by(() => {
		return streamState.ui.recentStates
			.map((a) => {
				const meta = STATES_BY_ABBR[a.toUpperCase()];
				return meta ? { abbr: meta.abbr, name: meta.name } : null;
			})
			.filter((r): r is { abbr: string; name: string } => r !== null);
	});

	// Hydrate each Recent race entry's template up-front. Mirrors the
	// pattern in TemplateList.svelte so parameterized templates (e.g.
	// us-house-119-KY-02) round-trip correctly even if the host hard-
	// refreshed in between.
	const raceRows = $derived.by(() => {
		return streamState.savedRaces.recent
			.map((ref) => {
				const template = hydrateTemplateById(ref.templateId);
				return template ? { ref, template } : null;
			})
			.filter(
				(r): r is { ref: RecentRaceRef; template: RaceTemplate } => r !== null
			);
	});

	const hasRecents = $derived(stateRows.length > 0 || raceRows.length > 0);

	function toggle() {
		open = !open;
	}

	function pickState(abbr: string) {
		open = false;
		onPickState(abbr);
	}

	function pickRace(row: { ref: RecentRaceRef; template: RaceTemplate }) {
		open = false;
		onPickRace(row.ref, row.template);
	}

	// Close on outside click. Use mousedown so the close fires before any
	// nested onclick handlers — keeps "click another button outside the
	// menu" feeling instant rather than a two-step (close, then re-click).
	function handleDocumentMouseDown(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node | null;
		if (!target) return;
		if (menuEl?.contains(target) || buttonEl?.contains(target)) return;
		open = false;
	}

	function handleKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			open = false;
			buttonEl?.focus();
		}
	}

	if (typeof window !== 'undefined') {
		window.addEventListener('mousedown', handleDocumentMouseDown);
		window.addEventListener('keydown', handleKey);
	}
	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousedown', handleDocumentMouseDown);
			window.removeEventListener('keydown', handleKey);
		}
	});
</script>

<div class="recent-wrap">
	<button
		type="button"
		class="recent-btn"
		class:open
		bind:this={buttonEl}
		onclick={toggle}
		aria-haspopup="true"
		aria-expanded={open}
		title="Recent states and races"
		disabled={!hasRecents}
	>
		<span>Recent</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>

	{#if open && hasRecents}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="menu"
			bind:this={menuEl}
			role="menu"
			aria-label="Recent states and races"
		>
			{#if stateRows.length > 0}
				<div class="section">
					<div class="section-head">States</div>
					<div class="chips">
						{#each stateRows as row (row.abbr)}
							<button
								type="button"
								role="menuitem"
								class="chip"
								onclick={() => pickState(row.abbr)}
								title={`Open ${row.name} race list`}
							>
								<span class="chip-abbr">{row.abbr}</span>
								<span class="chip-name">{row.name}</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#if raceRows.length > 0}
				<div class="section">
					<div class="section-head">Races</div>
					<ul class="races">
						{#each raceRows as row (row.ref.templateId + (row.ref.civicApiRaceId ?? ''))}
							<li>
								<button
									type="button"
									role="menuitem"
									class="race-row"
									class:live={!!row.ref.civicApiRaceId}
									onclick={() => pickRace(row)}
								>
									<div class="race-info">
										<strong class="race-title">{row.ref.label}</strong>
										{#if row.ref.subtitle}
											<span class="race-sub">{row.ref.subtitle}</span>
										{/if}
									</div>
									{#if row.ref.civicApiRaceId}
										<span class="badge live-badge">Live</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.recent-wrap {
		position: relative;
		display: inline-flex;
	}
	.recent-btn {
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
		transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
	}
	.recent-btn:hover:not(:disabled),
	.recent-btn.open {
		background: var(--color-primary);
		color: var(--color-primary-content);
		border-color: var(--color-primary);
	}
	.recent-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.caret {
		font-size: 0.6rem;
		opacity: 0.85;
	}
	.menu {
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 0;
		min-width: 22rem;
		max-width: 28rem;
		max-height: 28rem;
		overflow: auto;
		background: rgb(from var(--color-base-100) r g b / 0.97);
		backdrop-filter: blur(10px);
		border: 1px solid var(--color-secondary);
		border-radius: 0.5rem;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		padding: 0.5rem;
		z-index: 50;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.section {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.section-head {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgb(from var(--color-base-content) r g b / 0.65);
		padding: 0 0.25rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.55rem;
		background: var(--color-base-200);
		color: var(--color-base-content);
		border: 1px solid rgb(from var(--color-base-content) r g b / 0.18);
		border-radius: 0.4rem;
		font-size: 0.78rem;
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.chip:hover {
		background: var(--color-primary);
		color: var(--color-primary-content);
		border-color: var(--color-primary);
	}
	.chip-abbr {
		font-weight: 700;
		font-family: ui-monospace, monospace;
		font-size: 0.72rem;
		opacity: 0.85;
	}
	.chip-name {
		font-weight: 600;
	}
	.races {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.race-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		background: transparent;
		color: var(--color-base-content);
		border: 1px solid transparent;
		border-radius: 0.35rem;
		cursor: pointer;
		text-align: left;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.race-row:hover {
		background: var(--color-base-200);
		border-color: rgb(from var(--color-base-content) r g b / 0.18);
	}
	.race-info {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1 1 auto;
	}
	.race-title {
		font-size: 0.82rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.race-sub {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.65);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge.live-badge {
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.35rem;
		border-radius: 0.25rem;
		background: #16a34a;
		color: #fff;
		flex-shrink: 0;
	}
</style>
