<script lang="ts">
	import {
		autoBaselineRef,
		baselineOptions,
		captureBaseline,
		geographyKey,
		projectedRaceTotal,
		projectedVotes
	} from '$lib/map/metrics';
	import type { StreamState } from '$lib/stream-state';
	import { streamStore } from '$lib/stream-store.svelte';

	/**
	 * Chooses what the Swing and Turnout map modes measure against, and freezes
	 * the loaded race so a later one can be measured against it.
	 *
	 * Three kinds of baseline show up in the list, in the order a host reaches
	 * for them: the past Senate and Governor results baked in per state, the
	 * races the host has frozen themselves, and the baked presidential margins.
	 * The first is picked automatically when the race title says which office
	 * this is, so a Senate night is already measured against the last Senate
	 * race before the host opens this panel.
	 *
	 * Capture still matters for everything the bake can't cover — primaries,
	 * municipal races, anything downballot of Governor. The host watches those
	 * in this app, so the numbers pass through here, and freezing them at the
	 * end of the night is what turns "how did the primary break down" into a
	 * layer on November's map.
	 */

	interface Props {
		streamState: StreamState;
	}

	let { streamState }: Props = $props();

	const KIND_LABEL = {
		history: 'Past result, this state',
		archival: 'Baked county margins',
		captured: 'Captured'
	} as const;

	let label = $state('');

	let options = $derived(baselineOptions(streamState));
	let activeRef = $derived(streamState.ui.comparison.baselineRef);
	let regionCount = $derived(streamState.regions.length);

	// What a capture would actually contain, shown before the host commits.
	// Capturing at 30% reporting produces a baseline that misrepresents every
	// slow-counting county, and the honest place to say so is here.
	let capturable = $derived.by(() => {
		const withVotes = streamState.regions.filter((r) => r.votes > 0);
		const projected = projectedRaceTotal(streamState.regions);
		const counted = withVotes.reduce((sum, r) => sum + r.votes, 0);
		const withSplits = withVotes.filter((r) =>
			Object.values(r.candidateVotes ?? {}).some((v) => v > 0)
		).length;
		return {
			regions: withVotes.length,
			counted,
			// Race-level reporting is the honest gauge of whether a capture is
			// premature; region reporting varies wildly within a night.
			reportedPct:
				projected > 0
					? Math.min(100, (counted / projected) * 100)
					: (streamState.race.reportedPct ?? 0),
			withSplits
		};
	});

	let geoKey = $derived(geographyKey(streamState));

	function capture() {
		const baseline = captureBaseline(streamState, label);
		streamStore.state.ui.comparison.baselines = [baseline, ...streamState.ui.comparison.baselines];
		select(`captured:${baseline.id}`);
		label = '';
	}

	function remove(id: string) {
		streamStore.state.ui.comparison.baselines = streamState.ui.comparison.baselines.filter(
			(b) => b.id !== id
		);
		if (activeRef === `captured:${id}`) {
			// Deleting the selected baseline isn't a choice about what to compare
			// against, so this hands the decision back to the automatic pick rather
			// than leaving `baselineAuto` cleared and the map on the presidential
			// margin for the rest of the night.
			streamStore.state.ui.comparison.baselineAuto = true;
			streamStore.state.ui.comparison.baselineRef = autoBaselineRef(streamState) ?? 'archival:2024';
		}
	}

	/**
	 * Picking anything here is a deliberate choice, so it stops the automatic
	 * same-office pick from overwriting it when the next poll tick lands.
	 */
	function select(ref: string) {
		streamStore.state.ui.comparison.baselineAuto = false;
		streamStore.state.ui.comparison.baselineRef = ref;
	}

	function fmt(n: number): string {
		return Math.round(n).toLocaleString();
	}

	/** Roughly how complete a region's count is, for the capture warning. */
	function projectedLabel(): string {
		const projected = projectedRaceTotal(streamState.regions);
		return projected > 0 ? fmt(projected) : '—';
	}

	let unprojectable = $derived(
		streamState.regions.filter((r) => r.votes > 0 && projectedVotes(r) === null).length
	);
</script>

<section class="race-card p-4">
	<h3 class="heading">Compare against</h3>
	<p class="blurb">
		Swing and Turnout on the map are measured against whichever of these is selected. Everything
		else on the map ignores it. The last race for this same office is picked for you; choosing
		anything here keeps it.
	</p>

	{#if options.length === 0}
		<p class="empty">
			Nothing to compare against yet. This map has no baked results, so capture a race below once
			one has reported.
		</p>
	{:else}
		<ul class="options">
			{#each options as opt (opt.ref)}
				<li>
					<button
						type="button"
						class="opt"
						class:active={activeRef === opt.ref}
						aria-pressed={activeRef === opt.ref}
						onclick={() => select(opt.ref)}
					>
						<span class="opt-main">
							<span class="opt-title">
								<strong>{opt.label}</strong>
								{#if opt.sameOffice}
									<!-- The reason this one is at the top of the list, and the
									     reason it's already selected. -->
									<span class="chip">Same office</span>
								{/if}
							</span>
							<span class="opt-sub">
								{KIND_LABEL[opt.kind]} ·
								{opt.coverage}/{regionCount} regions
								{#if !opt.partisan}
									· turnout only
								{/if}
							</span>
						</span>
						{#if opt.geographyMismatch}
							<!-- Comparing Ohio counties to Texas ones would produce numbers
							     rather than an error, so the mismatch has to be visible. -->
							<span class="warn-chip" title="Captured on a different map">Other map</span>
						{/if}
					</button>
					{#if opt.kind === 'captured'}
						<button
							type="button"
							class="del"
							aria-label={`Delete ${opt.label}`}
							onclick={() => remove(opt.ref.slice('captured:'.length))}>&times;</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="race-card p-4">
	<h3 class="heading">Capture this race as a baseline</h3>
	<p class="blurb">
		Freezes each region's margin and its vote. Past Senate and Governor races are already baked in,
		so this is for everything else — a primary, a municipal race, anything downballot. Capture at
		the end of the night, then load the next race over the same map.
	</p>

	{#if capturable.regions === 0}
		<p class="empty">No region has reported yet, so there's nothing to freeze.</p>
	{:else}
		<dl class="stats">
			<div>
				<dt>Regions with votes</dt>
				<dd>{capturable.regions} of {regionCount}</dd>
			</div>
			<div>
				<dt>Votes counted</dt>
				<dd>{fmt(capturable.counted)}</dd>
			</div>
			<div>
				<dt>Projected total</dt>
				<dd>{projectedLabel()}</dd>
			</div>
			<div>
				<dt>With candidate splits</dt>
				<dd>{capturable.withSplits} of {capturable.regions}</dd>
			</div>
		</dl>

		{#if capturable.reportedPct < 95}
			<p class="warn">
				Only about {capturable.reportedPct.toFixed(0)}% of the projected vote is in. A baseline
				captured now will understate whichever areas are still counting — wait for the count to
				finish if you can.
			</p>
		{/if}
		{#if capturable.withSplits === 0}
			<p class="warn">
				No region carries per-candidate votes, so this baseline will have margins of zero and be
				useful for Turnout only.
			</p>
		{:else if unprojectable > 0}
			<p class="warn">
				{unprojectable}
				{unprojectable === 1 ? 'region has' : 'regions have'} too little reporting to project, and will
				be left out of turnout shares.
			</p>
		{/if}

		<div class="capture-row">
			<input
				type="text"
				placeholder={streamState.race.title || 'Baseline name'}
				bind:value={label}
				aria-label="Baseline name"
			/>
			<button type="button" class="primary" onclick={capture}>Capture</button>
		</div>
		{#if geoKey === null}
			<p class="hint">
				This race has no map, so the baseline won't be tied to one and can be selected anywhere.
			</p>
		{/if}
	{/if}
</section>

<style>
	.heading {
		margin: 0 0 0.35rem;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.blurb,
	.empty,
	.hint {
		margin: 0 0 0.5rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: rgb(from var(--color-base-content) r g b / 0.65);
	}
	.empty,
	.hint {
		font-style: italic;
	}
	.warn {
		margin: 0 0 0.5rem;
		padding: 0.35rem 0.45rem;
		border-left: 2px solid var(--color-warning, #eab308);
		background: rgb(from var(--color-warning, #eab308) r g b / 0.1);
		font-size: 0.72rem;
		line-height: 1.4;
	}
	.options {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.options li {
		display: flex;
		align-items: stretch;
		gap: 0.25rem;
	}
	.opt {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		padding: 0.4rem 0.5rem;
		background: var(--color-base-300);
		border: 1px solid transparent;
		border-radius: 0.3rem;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.opt:hover {
		border-color: var(--color-primary);
	}
	.opt.active {
		border-color: var(--color-primary);
		background: rgb(from var(--color-primary) r g b / 0.16);
	}
	.opt-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.opt-title {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}
	.opt-main strong {
		font-size: 0.8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip {
		flex-shrink: 0;
		padding: 0.05rem 0.25rem;
		border-radius: 0.2rem;
		background: rgb(from var(--color-primary) r g b / 0.25);
		border: 1px solid rgb(from var(--color-primary) r g b / 0.5);
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.opt-sub {
		font-size: 0.66rem;
		color: rgb(from var(--color-base-content) r g b / 0.6);
	}
	.warn-chip {
		flex-shrink: 0;
		padding: 0.1rem 0.3rem;
		border-radius: 0.2rem;
		background: var(--color-warning, #eab308);
		color: #1a1a1a;
		font-size: 0.6rem;
		font-weight: 700;
	}
	.del {
		flex-shrink: 0;
		width: 1.75rem;
		background: var(--color-base-300);
		border: 1px solid transparent;
		border-radius: 0.3rem;
		color: rgb(from var(--color-base-content) r g b / 0.7);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	.del:hover {
		border-color: var(--color-error);
		color: var(--color-error);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: 0.4rem;
		margin: 0 0 0.6rem;
	}
	.stats dt {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: rgb(from var(--color-base-content) r g b / 0.55);
	}
	.stats dd {
		margin: 0.1rem 0 0;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.capture-row {
		display: flex;
		gap: 0.3rem;
	}
	.capture-row input {
		flex: 1;
		min-width: 0;
		padding: 0.35rem 0.45rem;
		background: var(--color-base-200);
		border: 1px solid rgb(from var(--color-secondary) r g b / 0.5);
		border-radius: 0.25rem;
		color: inherit;
		font: inherit;
		font-size: 0.8rem;
	}
	.primary {
		padding: 0.35rem 0.8rem;
		background: var(--color-primary);
		color: var(--color-primary-content);
		border: none;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}
	@media (max-width: 640px) {
		.opt {
			min-height: 2.75rem;
		}
		.del {
			min-height: 2.75rem;
		}
		.capture-row input,
		.primary {
			min-height: 2.25rem;
		}
	}
</style>
