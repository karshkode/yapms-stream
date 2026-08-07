<script lang="ts">
	import type { StreamState } from '$lib/stream-state';
	import BroadcastPanel from '$lib/components/BroadcastPanel.svelte';
	import CandidateEditor from '$lib/components/CandidateEditor.svelte';
	import DataSourcePanel from '$lib/components/DataSourcePanel.svelte';
	import RaceMetaForm from '$lib/components/RaceMetaForm.svelte';
	import RegionEditor from '$lib/components/RegionEditor.svelte';
	import VisibilityPanel from '$lib/components/VisibilityPanel.svelte';
	import { saveRace } from '$lib/picker/saved';
	import { streamStore } from '$lib/stream-store.svelte';

	// Mutations on drawer tabs / visibility / dirty flag go through the shared
	// streamStore singleton rather than through a prop. Svelte 5's
	// cross-component ownership check otherwise spams the console every time
	// the host opens the drawer or saves a bookmark.
	const streamState = $derived(streamStore.state);

	type DrawerTab = StreamState['ui']['activeDrawerTab'];

	const tabs: { id: DrawerTab; label: string }[] = [
		{ id: 'meta', label: 'Race meta' },
		{ id: 'candidates', label: 'Candidates' },
		{ id: 'regions', label: 'Regions' },
		{ id: 'visibility', label: 'Visibility' },
		{ id: 'broadcast', label: 'Broadcast' },
		{ id: 'dataSource', label: 'Data source' },
		{ id: 'saveLoad', label: 'Save / Load' }
	];

	let newRaceName = $state('');

	function bookmark() {
		if (!newRaceName.trim()) return;
		const next = saveRace(streamState.savedRaces, {
			label: newRaceName.trim(),
			templateId: streamState.profile?.id ?? null,
			parameters: {},
			state: streamState
		});
		streamStore.state.savedRaces = next;
		streamStore.state.ui.dirty = false;
		newRaceName = '';
	}

	function exportJson() {
		const blob = new Blob([JSON.stringify(streamState, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `stream-state-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function importJson(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		file.text().then((text) => {
			try {
				streamStore.replace(JSON.parse(text));
			} catch (err) {
				alert('Invalid JSON: ' + err);
			}
		});
	}
</script>

<div class="drawer" class:open={streamState.ui.drawerOpen} aria-hidden={!streamState.ui.drawerOpen}>
	<div class="drawer-handle">
		<div class="tabs" role="tablist">
			{#each tabs as t (t.id)}
				<button
					type="button"
					class="tab"
					class:active={streamState.ui.activeDrawerTab === t.id}
					role="tab"
					aria-selected={streamState.ui.activeDrawerTab === t.id}
					onclick={() => (streamStore.state.ui.activeDrawerTab = t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>
		<button
			type="button"
			class="collapse"
			aria-label="Close drawer"
			title="Close (press e)"
			onclick={() => (streamStore.state.ui.drawerOpen = false)}
		>
			▾
		</button>
	</div>

	<div class="drawer-body">
		{#if streamState.ui.activeDrawerTab === 'meta'}
			<RaceMetaForm state={streamState} />
		{:else if streamState.ui.activeDrawerTab === 'candidates'}
			<CandidateEditor {streamState} />
		{:else if streamState.ui.activeDrawerTab === 'regions'}
			<RegionEditor state={streamState} />
		{:else if streamState.ui.activeDrawerTab === 'visibility'}
			<VisibilityPanel state={streamState} />
		{:else if streamState.ui.activeDrawerTab === 'broadcast'}
			<BroadcastPanel {streamState} />
		{:else if streamState.ui.activeDrawerTab === 'dataSource'}
			<DataSourcePanel state={streamState} />
		{:else if streamState.ui.activeDrawerTab === 'saveLoad'}
			<section class="race-card p-4">
				<h3 class="heading">Save / Load</h3>
				<div class="row">
					<input
						type="text"
						placeholder="Name this race (e.g. 'OH US Senate D Primary')"
						bind:value={newRaceName}
					/>
					<button type="button" onclick={bookmark}>Save current race</button>
					<button type="button" onclick={exportJson}>Export JSON</button>
					<label class="file">
						Import JSON
						<input type="file" accept=".json" onchange={importJson} />
					</label>
				</div>
				{#if streamState.ui.dirty}
					<p class="dirty">Unsaved changes — click Save to bookmark.</p>
				{/if}
			</section>
		{/if}
	</div>
</div>

<style>
	.drawer {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 10;
		background: var(--color-base-100);
		border-top: 1px solid var(--color-secondary);
		box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.4);
		max-height: 60vh;
		display: flex;
		flex-direction: column;
		/* Closed state is fully tucked away — the tab strip used to peek up 2.5rem
		   but the host rarely needs it and it was stealing stage space. The
		   "Edit" button in TopBar + the `e` keyboard shortcut are the only
		   entry points; pointer-events: none prevents stray hovers from
		   triggering focus rings on the hidden tabs. */
		transform: translateY(100%);
		transition: transform 200ms ease-out;
		pointer-events: none;
	}
	.drawer.open {
		transform: translateY(0);
		pointer-events: auto;
	}
	.drawer-handle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.375rem 0.75rem;
		background: var(--color-base-200);
		border-bottom: 1px solid var(--color-secondary);
		flex-shrink: 0;
		height: 2.5rem;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		overflow-x: auto;
	}
	.tab {
		background: transparent;
		border: 1px solid transparent;
		color: rgb(from var(--color-base-content) r g b / 0.6);
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		font-size: 0.8rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.tab:hover {
		color: var(--color-base-content);
	}
	.tab.active {
		color: var(--color-primary-content);
		background: var(--color-primary);
	}
	.collapse {
		background: transparent;
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		width: 1.75rem;
		height: 1.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.drawer-body {
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 1rem;
	}
	.heading {
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.row input[type='text'] {
		flex-grow: 1;
		background: var(--color-base-300);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.375rem 0.5rem;
		border-radius: 0.25rem;
		min-width: 12rem;
		/* min-width alone overflows a 390px screen once the row's buttons and
		   padding are counted; cap it at the space actually available. */
		max-width: 100%;
	}
	.row button {
		padding: 0.375rem 0.625rem;
		background: var(--color-secondary);
		color: var(--color-base-content);
		border: none;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.row .file {
		display: inline-flex;
		align-items: center;
		padding: 0.375rem 0.625rem;
		background: var(--color-secondary);
		border-radius: 0.25rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.row .file input {
		display: none;
	}
	.dirty {
		font-size: 0.75rem;
		color: var(--color-warning);
		margin: 0.5rem 0 0;
	}
	@media (max-width: 640px) {
		.drawer {
			/* The forms are the whole point of opening the drawer on a phone,
			   and 60vh of a short viewport leaves almost nothing usable once
			   the handle and tab strip are subtracted. */
			max-height: 85vh;
			max-height: 85dvh;
		}
		.drawer-body {
			padding: 0.75rem;
			/* Momentum scrolling inside the drawer rather than the page. */
			-webkit-overflow-scrolling: touch;
		}
		.tab {
			padding: 0.45rem 0.75rem;
			font-size: 0.85rem;
		}
		.drawer-handle {
			height: auto;
			min-height: 2.75rem;
		}
		.collapse {
			width: 2.25rem;
			height: 2.25rem;
		}
		.row button,
		.row .file {
			min-height: 2.25rem;
		}
	}
</style>
