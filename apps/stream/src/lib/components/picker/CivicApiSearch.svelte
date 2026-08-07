<script lang="ts">
	import type { RaceListEntry } from '../../data/source';
	import { civicApi, type TimeRange } from '../../data/civicapi';
	import { resolveCivicApiRace } from '../../picker/civicapiResolver';
	import { parseRaceQuery } from '../../picker/raceQuery';
	import type { RaceTemplate } from '../../race-profile';

	interface Props {
		query: string;
		onapply: (
			template: RaceTemplate,
			raceId: string,
			title?: string,
			subtitle?: string,
			// County name from civicAPI's `district` field — lets the apply
			// flow auto-select (and thus auto-zoom) that county on the
			// state's county map. Null for statewide/federal races that
			// don't have a single-county focus.
			preselectCountyName?: string | null
		) => void;
	}

	let { query, onapply }: Props = $props();

	let results = $state<RaceListEntry[]>([]);
	let loading = $state(false);
	// `error` is for a request that actually failed; `emptyNote` is for one that
	// succeeded and found nothing. They render differently because "no Kentucky
	// races this week" is a normal answer, and showing it in error red next to a
	// perfectly good State result made the search look broken.
	let error = $state<string | null>(null);
	let emptyNote = $state<string | null>(null);
	let debounceHandle: ReturnType<typeof setTimeout> | null = null;
	// Time-range filter mirrors the StateRacesCard control: lets the host
	// flip between today-forward races (race-night prep) and the past 90
	// days (Wed-morning recap of Tuesday primaries). Caching in the API
	// layer means switching is mostly hits, not refetches.
	//
	// Null until the host picks one, because the right default depends on what
	// they're doing. An empty box is race-night prep, so Upcoming. Typing a
	// race name is a lookup, and defaulting that to Upcoming is why last
	// November's mayoral race appeared not to exist: it was filtered out before
	// it could be matched, and "Recent" only reaches back 90 days.
	let picked: TimeRange | null = $state(null);
	let range = $derived<TimeRange>(picked ?? (query.trim() ? 'all' : 'upcoming'));

	// What the search understood, surfaced so the host can see why they got
	// these rows — and can discover that typing a year or a state does
	// something. See picker/raceQuery.ts.
	let parsed = $derived(parseRaceQuery(query));

	$effect(() => {
		// IMPORTANT: read `query` AND `timeRange` SYNCHRONOUSLY so Svelte 5
		// tracks both as reactive dependencies for this effect. Reading
		// them only inside the setTimeout callback would defer the access
		// past the synchronous-tracking window, and the effect would never
		// re-run on keystrokes or range flips — same class of bug as the
		// "civicAPI search doesn't refresh while I keep typing" one.
		const q = query;
		const activeRange = range;
		if (debounceHandle) clearTimeout(debounceHandle);
		// Empty query -> `civicApi.searchRaces('')` fans out across election
		// types + offsets to surface races for the requested range. civicAPI
		// has no native date sort so we do the discovery work client-side
		// (see data/civicapi.ts `fetchFirehose`).
		debounceHandle = setTimeout(async () => {
			loading = true;
			error = null;
			emptyNote = null;
			try {
				const fetched = await civicApi.searchRaces(q, activeRange);
				// Race-condition guard: a newer keystroke / range flip may
				// have fired another effect run while this fetch was in
				// flight. Only commit results when we're still the latest
				// (q, range) tuple; the newer effect will publish its own
				// results when it resolves. Without this, "tex" → "texas"
				// can flicker back to the longer "tex" results if the
				// network favors them.
				if (q !== query || activeRange !== range) return;
				results = fetched;
				if (results.length === 0) {
					emptyNote = q
						? `civicAPI has no ${yearLabel ? `${yearLabel} ` : ''}race matching '${q}'${stateLabel ? ` in ${stateLabel}` : ''}. Its local coverage is patchy — try fewer words, or build the race from a template below.`
						: activeRange === 'upcoming'
							? 'No upcoming races right now. Try Recent for past results.'
							: activeRange === 'recent'
								? 'No results in the past 90 days.'
								: 'No races available.';
				}
			} catch (err) {
				if (q !== query || activeRange !== range) return;
				error = 'civicAPI unreachable. Templates and Saved still work.';
				results = [];
				console.warn(err);
			} finally {
				if (q === query && activeRange === range) loading = false;
			}
		}, 250);
	});

	let stateLabel = $derived(parsed.state?.name ?? null);
	let yearLabel = $derived(parsed.year !== null ? String(parsed.year) : null);

	// Group results by their ISO election_date so the picker renders a
	// "Today"/"Tue May 5"/"Tue Nov 3" style header above each cluster. Most
	// civic cycles share a date (e.g. 300 Texas May 2nd municipals all land
	// together), and the divider makes the long list scannable.
	type Group = { date: string; label: string; entries: RaceListEntry[] };
	let grouped = $derived.by<Group[]>(() => {
		// Scratch bucket, rebuilt from `results` on every recompute and never read
		// after this function returns, so it needs no reactivity of its own.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const byDate = new Map<string, RaceListEntry[]>();
		for (const r of results) {
			const key = r.date || '';
			if (!byDate.has(key)) byDate.set(key, []);
			byDate.get(key)!.push(r);
		}
		return Array.from(byDate.entries()).map(([date, entries]) => ({
			date,
			label: formatGroupLabel(date),
			entries
		}));
	});

	function formatGroupLabel(iso: string): string {
		if (!iso) return 'Unscheduled';
		// Local-timezone YYYY-MM-DD, NOT toISOString (which is UTC and
		// flips the calendar one day west of GMT after ~6 PM, mis-tagging
		// today's elections as "yesterday"). Mirrors `localTodayIso` in
		// civicapi.ts.
		const now = new Date();
		const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		if (iso === todayIso) return 'Today';
		// Local to this formatting call — nothing renders it directly.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
		if (iso === tomorrowIso) return 'Tomorrow';
		try {
			const d = new Date(iso + 'T00:00:00');
			return d.toLocaleDateString('en-US', {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
		} catch {
			return iso;
		}
	}

	function load(entry: RaceListEntry) {
		const resolved = resolveCivicApiRace(entry);
		if (resolved) {
			// Subtitle packs date + state + (for local races) city/county so
			// the Recent entry can distinguish "Yorktown Town Council"
			// (Delaware IN) from the dozens of other township races on the
			// same day.
			const subtitle = [entry.date, entry.state, entry.municipality ?? entry.district]
				.filter(Boolean)
				.join(' · ');
			onapply(
				resolved.template,
				entry.id,
				entry.title,
				subtitle || undefined,
				resolved.preselectCountyName
			);
		}
	}
</script>

<div class="civic">
	<!-- Time-range toggle: Upcoming / Recent / All. Sticks at the top of
	     the picker so the host can flip between race-night prep and post-
	     election recap without losing scroll position. -->
	<div class="range-toggle" role="tablist" aria-label="Time range">
		{#each [{ id: 'upcoming', label: 'Upcoming' }, { id: 'recent', label: 'Recent' }, { id: 'all', label: 'All' }] as opt (opt.id)}
			<button
				type="button"
				role="tab"
				class="range-btn"
				class:active={range === opt.id}
				aria-selected={range === opt.id}
				disabled={yearLabel !== null}
				title={yearLabel !== null ? `Showing ${yearLabel} only` : undefined}
				onclick={() => (picked = opt.id as TimeRange)}
			>
				{opt.label}
			</button>
		{/each}
	</div>

	<!-- What the query was read as. Only when there's something to say, so the
	     common case stays quiet — but a year or a state changes which races can
	     come back at all, and that shouldn't be invisible. -->
	{#if yearLabel || stateLabel}
		<p class="parsed">
			{#if yearLabel}<span class="chip">{yearLabel}</span>{/if}
			{#if stateLabel}<span class="chip">{stateLabel}</span>{/if}
			<span class="parsed-note">
				{#if yearLabel && stateLabel}
					Searching {stateLabel} races held in {yearLabel}.
				{:else if yearLabel}
					Searching races held in {yearLabel}, whatever the date toggle says.
				{:else}
					Searching every {stateLabel} race, not just ones with it in the title.
				{/if}
			</span>
		</p>
	{/if}

	{#if loading}
		<p class="hint">Searching civicAPI…</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if emptyNote}
		<p class="hint muted">{emptyNote}</p>
	{:else}
		{#if !query}
			<p class="hint muted">
				{range === 'upcoming'
					? 'Upcoming races across the US, soonest first.'
					: range === 'recent'
						? 'Recent races (past 90 days), most recent first.'
						: 'All available races, upcoming then recent past.'}
				Type to narrow — a state, a city, an office, or a year ("nyc mayoral 2025").
			</p>
		{/if}
		{#each grouped as g (g.date || 'none')}
			<div class="group">
				<h4 class="group-head">
					<span>{g.label}</span>
					<span class="count">{g.entries.length} race{g.entries.length === 1 ? '' : 's'}</span>
				</h4>
				<ul class="results">
					{#each g.entries as r (r.id)}
						<li>
							<div class="info">
								<strong>{r.title}</strong>
								<span class="sub">
									{r.state ?? '—'}{#if r.district}
										· {r.district}{#if r.municipality && r.municipality !== r.district}
											/ {r.municipality}{/if} Co.{:else if r.municipality}
										· {r.municipality}{/if} · {r.candidateCount ?? 0} candidates · {r.reportingStatus ??
										'Pre'}
								</span>
							</div>
							<button type="button" onclick={() => load(r)}>Load + start polling</button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	{/if}
</div>

<style>
	.civic {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.range-toggle {
		display: flex;
		gap: 0;
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
		border-radius: 0.3rem;
		overflow: hidden;
		background: rgb(from var(--color-base-200) r g b / 0.6);
	}
	.range-btn {
		flex: 1;
		padding: 0.35rem 0.75rem;
		background: transparent;
		border: none;
		color: rgb(from var(--color-base-content) r g b / 0.7);
		font-size: 0.78rem;
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
	.range-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.parsed {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		font-size: 0.75rem;
	}
	.chip {
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: var(--color-primary);
		color: var(--color-primary-content);
		font-weight: 700;
		font-size: 0.7rem;
	}
	.parsed-note {
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.hint,
	.error {
		margin: 0;
		font-size: 0.8rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.hint.muted {
		font-style: italic;
		padding: 0 0.25rem 0.25rem;
	}
	.error {
		color: var(--color-error);
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.group + .group {
		margin-top: 0.5rem;
	}
	.group-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin: 0 0 0.25rem;
		padding: 0.25rem 0.1rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgb(from var(--color-base-content) r g b / 0.75);
		font-weight: 700;
		border-bottom: 1px solid rgb(from var(--color-secondary) r g b / 0.4);
	}
	.group-head .count {
		font-size: 0.65rem;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: rgb(from var(--color-base-content) r g b / 0.5);
	}
	.results {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.625rem;
		background: var(--color-base-300);
		border-radius: 0.375rem;
		font-size: 0.85rem;
	}
	.info {
		display: flex;
		flex-direction: column;
	}
	.sub {
		font-size: 0.7rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	button {
		padding: 0.25rem 0.625rem;
		background: var(--color-primary);
		color: var(--color-primary-content);
		border: none;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	@media (max-width: 640px) {
		/* A race title and a "Load + start polling" button don't fit on one
		   390px line, so the button drops under the title at full width — which
		   also makes it a proper thumb target instead of a 20px sliver. */
		li {
			flex-direction: column;
			align-items: stretch;
			gap: 0.4rem;
		}
		li button {
			width: 100%;
			min-height: 2.25rem;
			font-size: 0.8rem;
		}
		.range-btn {
			min-height: 2.25rem;
		}
	}
</style>
