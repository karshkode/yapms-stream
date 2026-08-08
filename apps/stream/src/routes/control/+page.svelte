<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import FormsDrawer from '$lib/components/stage/FormsDrawer.svelte';
	import StagePanel from '$lib/components/stage/StagePanel.svelte';
	import TopBar from '$lib/components/stage/TopBar.svelte';
	import RacePicker from '$lib/components/picker/RacePicker.svelte';
	import { fillMissingHeadshots } from '$lib/broadcast/candidatePhotoFill';
	import { civicApi } from '$lib/data/civicapi';
	import { loadPersistedState, persistState } from '$lib/data/manual';
	import { autoBaselineRef } from '$lib/map/metrics';
	import { preserveHeadshots, remapLiveRegionsToSeed } from '$lib/data/source';
	import { applyTemplate } from '$lib/picker/applyTemplate';
	import type { FollowedRace } from '$lib/stream-state';
	import { streamStore } from '$lib/stream-store.svelte';
	import { createBroadcastSync } from '$lib/sync/broadcast';
	import { BROWSE_US_TEMPLATE } from '$lib/templates';

	let overlayUrl = $state('');

	// Phone viewports don't get the PiP preview: its frame is a hard 520px,
	// wider than the screen, and the host can just open /overlay in another
	// tab. Gating the mount (rather than hiding it in CSS) also stops the
	// phone loading and rendering a second full copy of the SVG map.
	//
	// This lives here rather than in StagePanel because that component binds
	// a local `state`, which makes svelte-check read every `$state(...)` in
	// the file as a store subscription — the same reason TopBar/FormsDrawer
	// take a `streamState` prop instead.
	let pipTooNarrow = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 640px)');
		const sync = () => (pipTooNarrow = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	// Apply the Browse US shell — the blank map / state-click navigator that
	// the host lands on when no race is loaded. Called on first boot and when
	// the host clicks the TopBar brand to "go home". Keeps Recent + Saved
	// lists and the archival slider position intact so the host doesn't lose
	// context. Stops any in-flight civicAPI polling so the landing map isn't
	// clobbered by the previously-loaded race on the next tick.
	function resetToBrowseHome() {
		streamStore.state = applyTemplate(streamStore.state, BROWSE_US_TEMPLATE);
		streamStore.state.dataSource = {
			...streamStore.state.dataSource,
			adapter: 'manual',
			raceId: null,
			running: false
		};
		streamStore.state.ui.selectedRegionAttr = null;
		streamStore.state.ui.statesCardOpen = false;
		// Brand-click is the universal "I'm starting fresh" gesture, so
		// drop the back-to-state breadcrumb too. Without this the back
		// button would reappear after the host went home → loaded a new
		// (non-state-scoped) race, pointing to the previous state which
		// is no longer the user's mental "home".
		streamStore.state.ui.homeStateAbbr = null;
	}

	/**
	 * Re-open the browse-us shell with the previously-drilled state
	 * pre-selected. The StateRacesCard's `$effect` then refetches civicAPI
	 * for that state, but with the bumped CACHE_TTL_MS (10 min for upcoming)
	 * the previous probe responses are reused immediately — no spinner,
	 * no network round-trip. Lets the host hop between races in the same
	 * state at click-speed.
	 */
	function backToState() {
		const abbr = streamStore.state.ui.homeStateAbbr;
		if (!abbr) return;
		openStateRacesFor(abbr);
	}

	/**
	 * Shared core for "open the StateRacesCard for <abbr>". Used by:
	 *  - `backToState` (TopBar back-button) — replays the exact state the
	 *    host drilled into.
	 *  - The race picker's State results and browse-by-state grid — lets them
	 *    hop to any state, not just the most recent drill source.
	 *
	 * Hop strategy: stamp the browse-us template, halt any in-flight
	 * polling, then re-pin `selectedRegionAttr` AFTER the stamp (since
	 * applyTemplate clears ui state). The cached civicAPI search results
	 * (CACHE_TTL_MS = 10min) make the StateRacesCard re-render with no
	 * loading spinner, so this whole transition feels instant.
	 */
	function openStateRacesFor(abbr: string) {
		if (!abbr) return;
		if (streamStore.state.ui.dirty) {
			const ok = confirm('Unsaved edits on the current race will be lost. Continue?');
			if (!ok) return;
		}
		streamStore.state = applyTemplate(streamStore.state, BROWSE_US_TEMPLATE);
		streamStore.state.dataSource = {
			...streamStore.state.dataSource,
			adapter: 'manual',
			raceId: null,
			running: false
		};
		streamStore.state.ui.selectedRegionAttr = abbr.toLowerCase();
		streamStore.state.ui.statesCardOpen = true;
	}

	/**
	 * One-shot "refresh now" for the active civicAPI race. Bypasses the
	 * regular poll cadence (so the host doesn't have to wait the full
	 * `intervalMs` for the next tick) and the drilled-region pause (so
	 * they can pull updated counts while still zoomed into a county).
	 *
	 * Mirrors the merge logic from the polling effect — same `Object.assign`
	 * for the race header, same dirty-edit guard for candidates/regions,
	 * same `remapLiveRegionsToSeed` to keep manual region overrides intact.
	 * Stamps `lastPolledAt` on success so the TopBar's "Xs ago" hint
	 * resets to "just now". Surfacing errors to `dataSource.lastError`
	 * means the existing error pipeline (badge in the bottom-right of the
	 * status bar) lights up just like a failed poll tick.
	 */
	async function refreshActiveRace(): Promise<void> {
		const ds = streamStore.state.dataSource;
		if (ds.adapter !== 'civicapi' || !ds.raceId) return;
		try {
			const patch = await civicApi.fetchRace(ds.raceId);
			if (patch.race) {
				Object.assign(streamStore.state.race, patch.race);
			}
			if (!streamStore.state.ui.dirty) {
				if (patch.candidates && patch.candidates.length > 0) {
					streamStore.state.candidates = preserveHeadshots(
						streamStore.state.candidates,
						patch.candidates
					);
				}
				if (patch.regions && patch.regions.length > 0) {
					const remapped = remapLiveRegionsToSeed(streamStore.state.regions, patch.regions);
					// Merge scratch: discarded on the next line in favour of the array
					// assigned to the reactive `regions`, so it needs no reactivity.
					// eslint-disable-next-line svelte/prefer-svelte-reactivity
					const byAttr = new Map(streamStore.state.regions.map((r) => [r.regionAttr, r]));
					for (const row of remapped) byAttr.set(row.regionAttr, row);
					streamStore.state.regions = Array.from(byAttr.values());
				}
			}
			streamStore.state.dataSource.lastPolledAt = Date.now();
			if (streamStore.state.dataSource.lastError !== null) {
				streamStore.state.dataSource.lastError = null;
			}
		} catch (err) {
			streamStore.state.dataSource.lastError = err instanceof Error ? err.message : String(err);
		}
	}

	onMount(() => {
		// Rehydrate from localStorage on boot so the host doesn't lose state
		// across refreshes / accidental tab closes. If we come up with no
		// profile (fresh install, cleared storage), land on the Browse US
		// homepage so the host sees a clickable map instead of a blank stage.
		const persisted = loadPersistedState();
		if (persisted) streamStore.replace(persisted);
		if (!streamStore.state.profile) {
			resetToBrowseHome();
		}

		overlayUrl = `${location.origin}/overlay`;

		// Every mutation re-publishes the whole state to /overlay + to
		// localStorage. Cheap because the state payload is small.
		const sync = createBroadcastSync('control');
		const interval = setInterval(() => {
			sync.publish(streamStore.state);
			persistState(streamStore.state);
		}, 250);

		// Global keyboard shortcuts:
		//   Cmd/Ctrl+K -> open race picker
		//   e          -> toggle FormsDrawer (only when not typing in a field)
		//   Esc        -> cascade: clear region selection, else close drawer,
		//                 else close picker. Matches CNN remote-style "back out"
		//                 ergonomics so a host can recover from any selected
		//                 state with one key.
		function onKey(e: KeyboardEvent) {
			const target = e.target as HTMLElement | null;
			const inEditable =
				!!target &&
				(target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.tagName === 'SELECT' ||
					target.isContentEditable);

			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				streamStore.state.ui.pickerOpen = !streamStore.state.ui.pickerOpen;
				return;
			}

			// Naked `e` toggles drawer, but only outside input fields so typing
			// the letter 'e' in a candidate name doesn't yank the drawer open.
			if (e.key === 'e' && !inEditable && !e.metaKey && !e.ctrlKey && !e.altKey) {
				e.preventDefault();
				streamStore.state.ui.drawerOpen = !streamStore.state.ui.drawerOpen;
				return;
			}

			if (e.key === 'Escape') {
				if (streamStore.state.ui.pickerOpen) {
					// Picker owns its own Escape handler for query-clear; we only
					// get here when it wasn't intercepted, so force-close.
					streamStore.state.ui.pickerOpen = false;
				} else if (streamStore.state.ui.selectedRegionAttr) {
					streamStore.state.ui.selectedRegionAttr = null;
				} else if (streamStore.state.ui.drawerOpen) {
					streamStore.state.ui.drawerOpen = false;
				}
			}
		}
		window.addEventListener('keydown', onKey);

		return () => {
			clearInterval(interval);
			sync.dispose();
			window.removeEventListener('keydown', onKey);
		};
	});

	// civicAPI live polling. Runs while dataSource.running is true with the
	// civicapi adapter selected and a raceId set. Each tick fetches a patch and
	// mutates StreamState (manual edits always win per source.ts).
	//
	// Critical implementation notes (preserved from pre-reorient version):
	//   1. We *mutate* streamStore.state fields in place rather than assigning
	//      a new `streamStore.state = applyPatch(...)`. Re-assigning the whole
	//      state would re-run this effect on every poll tick (the effect reads
	//      dataSource.*), cancel the in-flight generator, and start a new one —
	//      an infinite "effect_update_depth_exceeded" loop that freezes the UI.
	//   2. The subscription counter is a *plain* closure variable, not $state.
	//      `++pollToken` on a $state would read and write the same signal inside
	//      one effect, looping infinitely.
	//   3. We skip writing `dataSource.lastError` when there's nothing to clear,
	//      so a healthy poll doesn't re-trigger subscribers on every tick.
	let pollToken = 0;
	$effect(() => {
		const ds = streamStore.state.dataSource;
		if (!ds.running || ds.adapter !== 'civicapi' || !ds.raceId) return;
		// Pause polling while the host is zoomed into a specific region. Each
		// poll tick repaints the map and currently also re-runs the zoom
		// effect, which can fight with the host's "I'm looking at Fort Bend
		// right now" context (the map re-centers on the newly-reported region,
		// or panzoom jitters). Resume automatically when the region is
		// cleared (Esc, X button, or re-click). This mirrors CNN's touchscreen
		// where the anchor manually drills in/out rather than being auto-
		// refreshed mid-drilldown.
		if (streamStore.state.ui.selectedRegionAttr) return;
		const myToken = ++pollToken;
		let stop = false;
		const raceId = ds.raceId;
		const intervalMs = ds.intervalMs;
		(async () => {
			try {
				for await (const patch of civicApi.pollRace(raceId, intervalMs)) {
					if (stop || pollToken !== myToken) break;
					if (patch.race) {
						Object.assign(streamStore.state.race, patch.race);
					}
					if (!streamStore.state.ui.dirty) {
						// Empty `patch.candidates` / `patch.regions` means "civicAPI
						// returned the race but with nothing populated yet" — common
						// on pre-election races. Keep the template seed in that case
						// instead of clobbering 67 counties with [].
						if (patch.candidates && patch.candidates.length > 0) {
							streamStore.state.candidates = preserveHeadshots(
								streamStore.state.candidates,
								patch.candidates
							);
						}
						if (patch.regions && patch.regions.length > 0) {
							const remapped = remapLiveRegionsToSeed(streamStore.state.regions, patch.regions);
							// Same merge scratch as the manual refresh above.
							// eslint-disable-next-line svelte/prefer-svelte-reactivity
							const byAttr = new Map(streamStore.state.regions.map((r) => [r.regionAttr, r]));
							for (const row of remapped) byAttr.set(row.regionAttr, row);
							streamStore.state.regions = Array.from(byAttr.values());
						}
					}
					streamStore.state.dataSource.lastPolledAt = Date.now();
					if (streamStore.state.dataSource.lastError !== null) {
						streamStore.state.dataSource.lastError = null;
					}
				}
			} catch (err) {
				streamStore.state.dataSource.lastError = err instanceof Error ? err.message : String(err);
			}
		})();
		return () => {
			stop = true;
		};
	});

	// Point Swing and Turnout at the last race for this same office.
	//
	// This is what makes the baked history worth baking. Left to a control the
	// host has to find, the comparison spends election night on the presidential
	// margin — which measures ticket-splitting rather than how the state moved,
	// and is the wrong number to read out over a Senate map. The pick can only
	// happen here and not at load time: which office this is comes from the race
	// title, which civicAPI fills in a tick later and the host then edits, and
	// the state's history file is fetched on demand so the candidates to choose
	// from arrive later still. An effect covers all three, whenever they land.
	//
	// `baselineAuto` is what keeps this from being obnoxious: the Compare panel
	// clears it the moment the host picks anything, so this never argues with a
	// deliberate choice. Reading the current ref untracked keeps the write from
	// re-running the effect it came from.
	$effect(() => {
		if (!streamStore.state.ui.comparison.baselineAuto) return;
		const ref = autoBaselineRef(streamStore.state);
		if (!ref) return;
		if (untrack(() => streamStore.state.ui.comparison.baselineRef) === ref) return;
		streamStore.state.ui.comparison.baselineRef = ref;
	});

	// Automatic candidate-photo pass.
	//
	// The dependency list is deliberately narrow: candidate *ids*, the race
	// title and the drilled state (which together decide what we'd search for),
	// plus the toggle. The roster read inside is untracked because the fill
	// writes `headshotUrl` back onto those same candidate objects — tracking
	// them would re-run this effect on every resolved photo, and the cleanup
	// below would abort the batch that was still resolving the rest.
	let photoPass = 0;
	const rosterKey = $derived(
		[
			streamStore.state.candidates.map((c) => c.id).join('|'),
			streamStore.state.race.title,
			streamStore.state.ui.homeStateAbbr ?? ''
		].join('~')
	);
	$effect(() => {
		if (!streamStore.state.ui.broadcast.autoPhotos) return;
		// Read for the dependency; the value itself is only a change signal.
		void rosterKey;
		const anyMissing = untrack(() =>
			streamStore.state.candidates.some((c) => !c.hidden && !c.headshotUrl)
		);
		if (!anyMissing) return;
		const myPass = ++photoPass;
		const ctl = new AbortController();
		void fillMissingHeadshots({ signal: ctl.signal }).catch((err) => {
			if (myPass === photoPass) console.warn('candidate photo pass failed', err);
		});
		return () => ctl.abort();
	});

	// Followed-race ticker poll.
	//
	// Separate from the active-race loop above and much slower: these are
	// background numbers for the marquee, not the race the host is narrating.
	// One pass fetches every followed race in series (civicAPI is a free,
	// donated service and a dozen parallel race fetches on election night is
	// rude), writes each summary back as it lands, then sleeps.
	//
	// Only the followed race *ids* and the interval are tracked — writing the
	// tallies back must not restart the loop.
	let followPass = 0;
	const followedKey = $derived(
		streamStore.state.ui.broadcast.followed.map((f) => f.raceId).join('|')
	);
	$effect(() => {
		const intervalMs = streamStore.state.ui.broadcast.followIntervalMs;
		void followedKey;
		const ids = untrack(() => streamStore.state.ui.broadcast.followed.map((f) => f.raceId));
		if (ids.length === 0) return;
		const myPass = ++followPass;
		let stop = false;

		const write = (raceId: string, patch: Partial<FollowedRace>) => {
			const list = streamStore.state.ui.broadcast.followed;
			const idx = list.findIndex((f) => f.raceId === raceId);
			if (idx === -1) return;
			Object.assign(list[idx], patch);
		};

		(async () => {
			while (!stop && myPass === followPass) {
				for (const raceId of ids) {
					if (stop || myPass !== followPass) return;
					try {
						const summary = await civicApi.fetchRaceSummary(raceId);
						write(raceId, {
							// Keep the host's label if they renamed it, otherwise track
							// civicAPI's name so a placeholder label fills itself in.
							label:
								streamStore.state.ui.broadcast.followed.find((f) => f.raceId === raceId)?.label ||
								summary.title,
							state: summary.state,
							reportedPct: summary.reportedPct,
							candidates: summary.candidates,
							updatedAt: Date.now(),
							lastError: null
						});
					} catch (err) {
						write(raceId, {
							lastError: err instanceof Error ? err.message : String(err)
						});
					}
				}
				// Sleep in short slices so removing the last followed race stops the
				// loop promptly instead of after a full interval.
				const until = Date.now() + intervalMs;
				while (!stop && myPass === followPass && Date.now() < until) {
					await new Promise((r) => setTimeout(r, 1000));
				}
			}
		})();

		return () => {
			stop = true;
		};
	});
</script>

<svelte:head>
	<title>YAPms Stream Control</title>
</svelte:head>

<div class="control-root">
	<TopBar
		streamState={streamStore.state}
		{overlayUrl}
		onToggleDrawer={() => (streamStore.state.ui.drawerOpen = !streamStore.state.ui.drawerOpen)}
		onOpenPicker={() => (streamStore.state.ui.pickerOpen = true)}
		onGoHome={() => {
			if (streamStore.state.ui.dirty) {
				const ok = confirm(
					'Unsaved edits on the current race will be lost. Return to the home map?'
				);
				if (!ok) return;
			}
			resetToBrowseHome();
		}}
		onBackToState={backToState}
		onRefreshRace={refreshActiveRace}
	/>

	<div class="stage-shell">
		<StagePanel showPip={!pipTooNarrow} />
	</div>

	<FormsDrawer />

	<RacePicker
		open={streamStore.state.ui.pickerOpen}
		onclose={() => (streamStore.state.ui.pickerOpen = false)}
		onbrowsestate={openStateRacesFor}
	/>
</div>

<style>
	/* Full-viewport operator desk. `overflow: hidden` on html/body is set at the
	   layout level; here we just claim the whole viewport with flex-column so
	   the stage fills whatever's left between TopBar and FormsDrawer. */
	.control-root {
		display: flex;
		flex-direction: column;
		height: 100vh;
		/* Mobile browsers count the collapsible address bar in 100vh, so the
		   drawer and stage bottom sit below the fold until the bar hides.
		   dvh tracks the visible viewport; the vh above stays as the fallback
		   for engines without dvh. */
		height: 100dvh;
		min-height: 0;
		overflow: hidden;
	}
	.stage-shell {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
	}
</style>
