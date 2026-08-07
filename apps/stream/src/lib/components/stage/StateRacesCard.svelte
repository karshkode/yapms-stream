<script lang="ts">
	import { civicApi, type TimeRange } from '$lib/data/civicapi';
	import type { RaceListEntry } from '$lib/data/source';
	import { findRegionAttrByName, resolveCivicApiRace } from '$lib/picker/civicapiResolver';
	import type { RaceTemplate } from '$lib/race-profile';
	import type { StreamState } from '$lib/stream-state';
	import { applyTemplate } from '$lib/picker/applyTemplate';
	import { pushRecent } from '$lib/picker/recent';
	import { pushRecentState } from '$lib/picker/recentStates';
	import { streamStore } from '$lib/stream-store.svelte';
	import { ALL_TEMPLATES } from '$lib/templates';
	import { STATES_BY_ABBR, STATES_BY_FIPS } from '$lib/templates/states';
	import { makeUsHouseTemplate } from '$lib/templates/us-house';

	/**
	 * StateRacesCard — when the host clicks a state on any `regionLabel=States`
	 * map, this card pops with three tiered sections:
	 *   1. Upcoming / in-progress civicAPI races for that state (live).
	 *   2. Archival-ready templates tagged for that state (e.g. state-
	 *      statewide-48 for TX, or US House 48-01, 48-02, ... if we had them).
	 *   3. Manual fallback: launch a generic statewide template.
	 *
	 * The card is explicitly NOT a nested RegionDetailCard — states on the US
	 * map don't ship per-region vote data, so showing a vote-count breakdown
	 * would be meaningless. The card's job is race navigation.
	 */

	interface Props {
		// Named `streamState` instead of `state` because Svelte 5 treats a
		// local `state` binding as a store subscription and conflicts with
		// the `$state` rune. See FormsDrawer.svelte for the same workaround.
		streamState: StreamState;
		onclose: () => void;
		interactive?: boolean;
	}

	let { streamState, onclose, interactive = true }: Props = $props();

	// Resolve the clicked state-region to a StateMeta. Regions on the US maps
	// are keyed by 2-letter lowercase postal code (e.g. "tx", "ca") — see
	// `usa-presidential-2024-blank.svg` and `us-president.ts`.
	let stateMeta = $derived.by(() => {
		const attr = streamState.ui.selectedRegionAttr;
		if (!attr) return null;
		const upper = attr.toUpperCase();
		return STATES_BY_ABBR[upper] ?? null;
	});

	// Also accept FIPS-based region attributes for future maps that key by
	// FIPS instead of postal code. Defensive fallback; today's SVGs use po.
	let stateMetaFallback = $derived.by(() => {
		if (stateMeta) return stateMeta;
		const attr = streamState.ui.selectedRegionAttr;
		if (!attr) return null;
		return STATES_BY_FIPS[attr] ?? null;
	});

	let meta = $derived(stateMeta ?? stateMetaFallback);

	// Push the state to the MRU list as soon as the card opens for it.
	// Powers the TopBar Recent dropdown's States section. Tracking on
	// open (rather than on race-load) means a host who clicks Texas just
	// to scan races but loads nothing still sees Texas in their recents
	// — matches the host's mental model of "where I've been looking".
	$effect(() => {
		if (!meta) return;
		const current = streamStore.state.ui.recentStates;
		const next = pushRecentState(current, meta.abbr);
		if (next[0] !== current[0] || next.length !== current.length) {
			streamStore.state.ui.recentStates = next;
		}
	});

	let civicResults: RaceListEntry[] = $state([]);
	let civicLoading = $state(false);
	let civicError: string | null = $state(null);
	// `civicRefreshing` is the "host clicked Refresh" sub-state. It piggybacks
	// on the same fetch path as the initial load but lets the UI show a
	// distinct spinning ↻ on the button (the bulk loading hint is suppressed
	// when partial results are already on screen so the host's read isn't
	// disrupted by the list flickering between "Searching…" and the data).
	let civicRefreshing = $state(false);
	// Time-range filter: 'upcoming' (default) shows today-forward races,
	// 'recent' surfaces the past 90 days (so the host can pull up
	// Tuesday's results on Wednesday morning), 'all' merges both.
	// `searchRacesByState` honors the parameter — caching means switching
	// modes typically refetches just the deeper offsets, not the whole
	// probe set.
	let timeRange: TimeRange = $state('upcoming');

	// Generation token for in-flight requests. Each `loadRaces` call
	// increments this and captures the new value; `onPartial` and the
	// final resolution check it against the live token before mutating
	// `civicResults`. Without this, a slow upcoming probe could land
	// after the host already flipped to "recent" and overwrite the new
	// results with stale upcoming data. The pattern matches the
	// debounce-guard used in CivicApiSearch.
	let fetchToken = 0;

	function loadRaces(force = false) {
		if (!meta) {
			civicResults = [];
			return;
		}
		const stateAbbr = meta.abbr;
		const stateName = meta.name;
		const range = timeRange;
		const myToken = ++fetchToken;
		civicLoading = true;
		civicError = null;
		// On force-refresh, drop the cached probes for this state so the
		// re-issue actually hits the network. We match the URL substring
		// rather than building exact keys: `province=KY` catches every
		// offset (0, 100, 200, ...) for Kentucky in one call. Other states
		// stay cached so the host's MRU list is still snappy.
		if (force) {
			civicRefreshing = true;
			civicApi.invalidateCacheByMatch(`province=${stateAbbr}`);
		}
		// Don't blank out existing results on a force-refresh — let the
		// host keep reading the previous list while the new one streams
		// in. On a normal range-change we DO want to clear so an empty
		// list doesn't bleed across ranges.
		if (!force) civicResults = [];

		civicApi
			.searchRacesByState(stateAbbr, stateName, range, {
				force,
				onPartial: (partial) => {
					if (myToken !== fetchToken) return;
					civicResults = partial;
				}
			})
			.then((rows) => {
				if (myToken !== fetchToken) return;
				civicResults = rows;
				if (rows.length === 0) {
					civicError =
						range === 'upcoming'
							? `No upcoming civicAPI races for ${stateName} right now.`
							: range === 'recent'
								? `No recent civicAPI results for ${stateName} in the past 90 days.`
								: `No civicAPI races for ${stateName}.`;
				}
			})
			.catch((err) => {
				if (myToken !== fetchToken) return;
				civicError = 'civicAPI unreachable — showing archival templates only.';
				civicResults = [];
				console.warn(err);
			})
			.finally(() => {
				if (myToken !== fetchToken) return;
				civicLoading = false;
				civicRefreshing = false;
			});
	}

	// Re-fetch civicAPI when the state OR time range changes. Both `meta`
	// and `timeRange` are read inside the effect body so Svelte 5 tracks
	// them as reactive dependencies.
	$effect(() => {
		// Touch reactive deps explicitly so Svelte 5 tracks them; the
		// non-reactive `loadRaces` body reads them via closure.
		void meta;
		void timeRange;
		loadRaces(false);
	});

	// Archival/template options for this state. Every statewide template is
	// tagged with both state name and FIPS, so filtering is a substring match.
	let archivalTemplates = $derived<RaceTemplate[]>(
		meta
			? ALL_TEMPLATES.filter((t) => t.tags.includes(meta!.fips) || t.tags.includes(meta!.abbrLower))
			: []
	);

	function handleCivicApply(entry: RaceListEntry) {
		if (!interactive) return;
		// Defense in depth: if a race somehow slipped through with a state
		// other than the one the host clicked (e.g. "Colorado County, TX"
		// before the strict filter shipped, or a future civicAPI shape
		// change), warn rather than silently load the wrong-state map.
		// Pulled separately from the filter because we'd rather an explicit
		// confirm than a quiet swap of the visible state.
		if (meta && entry.state && entry.state.toUpperCase() !== meta.abbr) {
			const ok = confirm(
				`This race is in ${entry.state}, not ${meta.name}. Load the ${entry.state} map instead?`
			);
			if (!ok) return;
		}
		const resolved = resolveCivicApiRace(entry);
		if (!resolved) return;
		const subtitle = [entry.date, entry.state, entry.municipality ?? entry.district]
			.filter(Boolean)
			.join(' · ');
		applyAndStartPolling(
			resolved.template,
			entry.id,
			entry.title,
			subtitle || null,
			resolved.preselectCountyName
		);
	}

	function handleTemplateApply(template: RaceTemplate) {
		if (!interactive) return;
		applyAndStartPolling(template, null, null, null, null);
	}

	/** Launch a generic state-leg or US House template for this state without
	 * going through the picker — helpful when the host wants to drill into
	 * downballot races while already zoomed in on a state. */
	function handleDownballot(kind: 'us-house' | 'state-leg') {
		if (!meta) return;
		if (kind === 'us-house') {
			const template = makeUsHouseTemplate({
				congress: 119,
				stateAbbr: meta.abbr,
				districtNumber: '1'
			});
			applyAndStartPolling(template, null, null, null, null);
		}
		// state-leg needs a chamber + district — we defer to the picker for
		// that since prompting inline would crowd the card.
	}

	/**
	 * "Browse all races for {state}" — opens the global RacePicker modal with
	 * the search input pre-seeded with the state name and the civicAPI tab
	 * active. Lets the host scroll through every upcoming civicAPI race for
	 * that state (the inline list here caps at ~25 to keep the card a
	 * manageable size); the picker shows up to 100 results per query and
	 * supports refinement (e.g. typing "texas senate" after the seed).
	 */
	function browseAllInPicker() {
		if (!meta) return;
		streamStore.state.ui.pickerQuery = meta.name;
		streamStore.state.ui.pickerInitialTab = 'civicapi';
		streamStore.state.ui.pickerOpen = true;
		// Close this card so the modal lands on a clean stage backdrop.
		onclose();
	}

	/**
	 * Render a civicAPI ISO date (YYYY-MM-DD) as the host-friendly format
	 * the rest of the app uses ("Tue, May 5, 2026"). Returns the raw input
	 * if it's malformed so we never silently drop a date.
	 *
	 * Building a `Date` from the YYYY-MM-DD string directly would interpret
	 * it as UTC midnight and shift one calendar day backwards in any US
	 * timezone — explicitly splitting the parts and using the local-date
	 * constructor avoids that.
	 */
	function formatRaceDate(iso: string): string {
		if (!iso) return 'Date TBD';
		const parts = iso.split('-');
		if (parts.length !== 3) return iso;
		const [y, m, d] = parts.map((n) => Number(n));
		if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
		const dt = new Date(y, m - 1, d);
		return dt.toLocaleDateString('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	/**
	 * Days-from-today shorthand for the most-imminent races.
	 * "Today", "Tomorrow", "in 3 days", or null for anything ≥ 14 days out
	 * (at which point the formatted date alone is sufficient context).
	 */
	function relativeDayLabel(iso: string): string | null {
		if (!iso) return null;
		const parts = iso.split('-');
		if (parts.length !== 3) return null;
		const [y, m, d] = parts.map((n) => Number(n));
		const target = new Date(y, m - 1, d);
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const dayMs = 86_400_000;
		const diff = Math.round((target.getTime() - today.getTime()) / dayMs);
		if (diff === 0) return 'Today';
		if (diff === 1) return 'Tomorrow';
		if (diff > 1 && diff < 14) return `in ${diff} days`;
		return null;
	}

	function applyAndStartPolling(
		template: RaceTemplate,
		civicApiRaceId: string | null,
		civicApiTitle: string | null,
		subtitle: string | null,
		preselectCountyName: string | null
	) {
		if (streamStore.state.ui.dirty) {
			const ok = confirm(
				`Loading '${template.name}' will replace your candidates and region results. Replace?`
			);
			if (!ok) return;
		}
		// Capture the state we're drilling out of BEFORE we stamp the
		// template (which wipes `ui.selectedRegionAttr` etc.). The TopBar
		// reads this to render the "← All <State> races" back button so
		// the host can hop between races in the same state without going
		// through brand-click → click-state again.
		const drillingFromAbbr = meta?.abbr ?? null;
		streamStore.state = applyTemplate(streamStore.state, template);
		streamStore.state.ui.homeStateAbbr = drillingFromAbbr;

		// Auto-focus the county mentioned in civicAPI's `district` field
		// (e.g. "Yorktown Town Council" → district="Delaware" → zoom Delaware,
		// Indiana). Same flow the picker uses — centralized helper.
		if (preselectCountyName) {
			const regionAttr = findRegionAttrByName(streamStore.state.regions, preselectCountyName);
			if (regionAttr) streamStore.state.ui.selectedRegionAttr = regionAttr;
		}

		streamStore.state = {
			...streamStore.state,
			savedRaces: pushRecent(streamStore.state.savedRaces, {
				templateId: template.id,
				label: civicApiTitle ?? template.name,
				parameters: {},
				civicApiRaceId,
				civicApiTitle,
				subtitle,
				preselectCountyName
			})
		};
		if (civicApiRaceId) {
			streamStore.state.dataSource = {
				...streamStore.state.dataSource,
				adapter: 'civicapi',
				raceId: civicApiRaceId,
				running: true
			};
		} else {
			streamStore.state.dataSource = {
				...streamStore.state.dataSource,
				adapter: 'manual',
				raceId: null,
				running: false
			};
		}
		onclose();
	}
</script>

{#if meta}
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
	<aside class="state-card" role="dialog" aria-label={`${meta.name} races`}>
		<header>
			<div>
				<h3>{meta.name}</h3>
				<p class="sub">Races available for this state</p>
			</div>
			{#if interactive}
				<button type="button" class="close" aria-label="Close" onclick={onclose}>&times;</button>
			{/if}
		</header>

		<section>
			<div class="section-head">
				<span>
					Live via civicAPI
					{#if civicResults.length > 0}
						<span class="state-note">({civicResults.length} found)</span>
					{/if}
				</span>
				<div class="head-actions">
					{#if civicLoading && civicResults.length > 0}
						<!-- Partial results already on screen, more probes still
						     landing — quieter "loading more" so the host's read
						     isn't disrupted by a big spinner. -->
						<span class="state-note">loading more…</span>
					{:else if civicLoading}
						<span class="state-note">loading…</span>
					{/if}
					{#if interactive}
						<button
							type="button"
							class="refresh-btn"
							class:spinning={civicRefreshing}
							onclick={() => loadRaces(true)}
							disabled={civicLoading}
							title="Refresh civicAPI results (bypasses cache)"
							aria-label="Refresh civicAPI results"
						>
							<span class="refresh-icon" aria-hidden="true">↻</span>
						</button>
					{/if}
				</div>
			</div>

			<!-- Time-range filter: lets the host pivot between "what's coming
			     up" (default for race-night prep) and "what just happened"
			     (Wed-morning recap of Tuesday's results). Cached probes
			     mean switching is usually instant after the first use. -->
			{#if interactive}
				<div class="range-toggle" role="tablist" aria-label="Time range">
					{#each [{ id: 'upcoming', label: 'Upcoming' }, { id: 'recent', label: 'Recent' }, { id: 'all', label: 'All' }] as opt (opt.id)}
						<button
							type="button"
							role="tab"
							class="range-btn"
							class:active={timeRange === opt.id}
							aria-selected={timeRange === opt.id}
							onclick={() => (timeRange = opt.id as TimeRange)}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			{/if}
			<!-- Render priority: streaming partial results first (so the host
			     sees the first page within ~2-3s instead of staring at a
			     spinner for the full ~9s probe budget), then the explicit
			     error, then the still-loading hint, then the empty-state.
			     The streaming `onPartial` callback in `loadRaces` keeps
			     `civicResults` populated as each probe lands. -->
			{#if civicResults.length === 0}
				{#if civicError}
					<p class="hint muted">{civicError}</p>
				{:else if civicLoading}
					<p class="hint">Searching civicAPI…</p>
				{:else}
					<p class="hint muted">No upcoming civicAPI races for {meta.name}.</p>
				{/if}
			{:else}
				<!-- We surface up to 25 inline; anything more would crowd the
				     card. Hosts wanting the long tail click "Browse all in
				     picker" below, which opens the RacePicker pre-seeded with
				     the state name on the civicAPI tab. -->
				<ul class="races">
					{#each civicResults.slice(0, 25) as r (r.id)}
						{@const rel = relativeDayLabel(r.date)}
						<li>
							<button
								type="button"
								class="race-btn"
								disabled={!interactive}
								onclick={() => handleCivicApply(r)}
							>
								<div class="info">
									<div class="title-row">
										<strong>{r.title}</strong>
										{#if rel}
											<span class="badge soon">{rel}</span>
										{/if}
									</div>
									<span class="meta">
										<span class="date">{formatRaceDate(r.date)}</span>
										·
										<span class="badge live">{r.reportingStatus ?? 'Pre'}</span>
										{#if r.district}· {r.district}{/if}
										{#if r.municipality && r.municipality !== r.district}· {r.municipality}{/if}
									</span>
								</div>
								<span class="load-cue">Load →</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<!-- Always show the "Browse all" affordance when interactive: it's
			     useful even on the empty/error path because the picker will
			     fan out across election types via the firehose query and may
			     find races that the simple state-name search missed. -->
			{#if interactive}
				<button
					type="button"
					class="browse-all"
					onclick={browseAllInPicker}
					title="Open the picker scoped to {meta.name}"
				>
					{civicResults.length > 25
						? `Browse all ${civicResults.length}+ ${meta.name} races…`
						: `Browse all ${meta.name} races in picker…`}
				</button>
			{/if}
		</section>

		{#if archivalTemplates.length > 0}
			<section>
				<div class="section-head">Templates</div>
				<ul class="races">
					{#each archivalTemplates as t (t.id)}
						<li>
							<button
								type="button"
								class="race-btn"
								disabled={!interactive}
								onclick={() => handleTemplateApply(t)}
							>
								<div class="info">
									<strong>{t.name}</strong>
									<span class="meta">
										<span class="badge archival">Archival</span>
										{t.category}
									</span>
								</div>
								<span class="load-cue">Load →</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section>
			<div class="section-head">Downballot</div>
			<div class="downballot">
				<button
					type="button"
					class="secondary"
					disabled={!interactive}
					onclick={() => handleDownballot('us-house')}
				>
					US House (district 1)
				</button>
				<p class="hint muted">For other districts or state legislature, use Ctrl+K.</p>
			</div>
		</section>
	</aside>
{/if}

<style>
	.state-card {
		background: rgb(from var(--color-base-100) r g b / 0.96);
		backdrop-filter: blur(8px);
		border: 1px solid var(--color-secondary);
		border-radius: 0.5rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
		padding: 1rem;
		min-width: 22rem;
		max-width: 26rem;
		color: var(--color-base-content);
		font-size: 0.875rem;
	}
	/* See RegionDetailCard: 22rem is wider than a phone viewport, so the
	   card fills the bottom sheet rather than overflowing it. */
	@media (max-width: 640px) {
		.state-card {
			min-width: 0;
			max-width: none;
			width: 100%;
			border: none;
			border-radius: 0;
			padding: 0.75rem;
		}
		/* This card is now a primary mobile surface — it's what a tap on the map
		   opens, and where a state result in the race search lands — so its
		   controls need to be thumb-sized rather than the ~22px they inherit
		   from the desktop layout. */
		.close,
		.refresh-btn {
			min-width: 2.25rem;
			min-height: 2.25rem;
			width: auto;
			height: auto;
		}
		.range-btn {
			min-height: 2.25rem;
			font-size: 0.8rem;
		}
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	header h3 {
		margin: 0;
		font-size: 1.125rem;
	}
	.sub {
		margin: 0.125rem 0 0;
		font-size: 0.75rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.close {
		background: transparent;
		border: none;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.25rem;
	}
	.close:hover {
		color: var(--color-base-content);
	}
	section {
		margin-bottom: 0.75rem;
	}
	section:last-child {
		margin-bottom: 0;
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgb(from var(--color-base-content) r g b / 0.65);
		margin-bottom: 0.5rem;
		font-weight: 600;
	}
	.state-note {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		text-transform: none;
		letter-spacing: 0;
		font-style: italic;
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.refresh-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		padding: 0;
		background: transparent;
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
		border-radius: 0.25rem;
		color: rgb(from var(--color-base-content) r g b / 0.7);
		cursor: pointer;
		transition:
			background 120ms ease,
			color 120ms ease,
			border-color 120ms ease;
	}
	.refresh-btn:hover:not(:disabled) {
		background: rgb(from var(--color-primary) r g b / 0.15);
		border-color: var(--color-primary);
		color: var(--color-base-content);
	}
	.refresh-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.refresh-icon {
		font-size: 0.95rem;
		line-height: 1;
		display: inline-block;
	}
	/* Spin the ↻ glyph during a forced refresh so the host gets visible
	   feedback that they triggered a network call (subtle but distinct
	   from the "loading…" text label which only fires on the very first
	   load). 1s rotation matches the typical first-probe latency. */
	.refresh-btn.spinning .refresh-icon {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.range-toggle {
		display: flex;
		gap: 0;
		margin-bottom: 0.4rem;
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
		border-radius: 0.3rem;
		overflow: hidden;
		background: rgb(from var(--color-base-200) r g b / 0.6);
	}
	.range-btn {
		flex: 1;
		padding: 0.3rem 0.5rem;
		background: transparent;
		border: none;
		color: rgb(from var(--color-base-content) r g b / 0.65);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	.range-btn + .range-btn {
		border-left: 1px solid rgb(from var(--color-secondary) r g b / 0.4);
	}
	.range-btn:hover:not(.active) {
		background: rgb(from var(--color-base-100) r g b / 0.5);
		color: var(--color-base-content);
	}
	.range-btn.active {
		background: var(--color-primary);
		color: var(--color-primary-content);
	}
	.races {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 16rem;
		overflow-y: auto;
	}
	.race-btn {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		background: rgb(from var(--color-base-200) r g b / 0.7);
		border: 1px solid transparent;
		border-radius: 0.375rem;
		color: inherit;
		text-align: left;
		cursor: pointer;
		font: inherit;
	}
	.race-btn:hover:not(:disabled) {
		border-color: var(--color-primary);
		background: rgb(from var(--color-primary) r g b / 0.15);
	}
	.race-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.info strong {
		font-size: 0.85rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}
	.meta {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.125rem;
	}
	.meta .date {
		color: var(--color-base-content);
		font-weight: 600;
	}
	.badge {
		padding: 0.05rem 0.3rem;
		border-radius: 0.2rem;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.badge.live {
		background: #16a34a;
		color: #fff;
	}
	.badge.archival {
		background: var(--color-secondary);
		color: var(--color-base-content);
	}
	/* "Today" / "Tomorrow" / "in 3 days" — orange so it pops next to the
	   neutral title without competing with the green Live/Pre status badge. */
	.badge.soon {
		background: #f97316;
		color: #fff;
		flex-shrink: 0;
	}
	.load-cue {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.5);
		flex-shrink: 0;
	}
	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.hint.muted {
		color: rgb(from var(--color-base-content) r g b / 0.45);
		font-style: italic;
	}
	.downballot {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.secondary {
		padding: 0.375rem 0.625rem;
		background: var(--color-secondary);
		border: none;
		color: var(--color-base-content);
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.secondary:hover:not(:disabled) {
		background: var(--color-primary);
		color: var(--color-primary-content);
	}
	.browse-all {
		display: block;
		width: 100%;
		margin-top: 0.5rem;
		padding: 0.45rem 0.625rem;
		background: rgb(from var(--color-primary) r g b / 0.12);
		border: 1px dashed rgb(from var(--color-primary) r g b / 0.6);
		color: var(--color-base-content);
		border-radius: 0.375rem;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
	}
	.browse-all:hover {
		background: rgb(from var(--color-primary) r g b / 0.25);
		border-style: solid;
	}
</style>
