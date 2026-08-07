<script lang="ts">
	import type { StreamState } from '../stream-state';

	interface Props {
		state: StreamState;
	}

	let { state }: Props = $props();

	function updateLeader(regionAttr: string, leaderId: string) {
		state.regions = state.regions.map((r) =>
			r.regionAttr === regionAttr ? { ...r, leaderId: leaderId || null } : r
		);
		state.ui.dirty = true;
	}

	function resetAll() {
		state.regions = state.regions.map((r) => ({
			...r,
			leaderId: null,
			votes: 0,
			reportedPct: 0
		}));
		state.ui.dirty = true;
	}

	function importCsv(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		file.text().then((text) => {
			const lines = text.trim().split(/\r?\n/);
			const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
			const nameIdx = header.indexOf('name');
			const leaderIdx = header.indexOf('leader');
			const votesIdx = header.indexOf('votes');
			const pctIdx = header.indexOf('reportedpct');
			const regByName = new Map(state.regions.map((r) => [r.name.toLowerCase(), r]));
			for (let i = 1; i < lines.length; i++) {
				const cols = lines[i].split(',');
				const name = cols[nameIdx]?.trim().toLowerCase();
				const target = regByName.get(name);
				if (!target) continue;
				if (votesIdx >= 0) target.votes = Number(cols[votesIdx]) || 0;
				if (pctIdx >= 0) target.reportedPct = Number(cols[pctIdx]) || 0;
				if (leaderIdx >= 0) {
					const leaderName = cols[leaderIdx]?.trim().toLowerCase();
					const match = state.candidates.find((c) => c.name.toLowerCase() === leaderName);
					target.leaderId = match?.id ?? null;
				}
			}
			state.regions = [...state.regions];
			state.ui.dirty = true;
		});
	}
</script>

<section class="race-card p-4">
	<header class="bar">
		<h3 class="heading">Region results ({state.regions.length})</h3>
		<div class="actions">
			<label class="file">
				Import CSV
				<input type="file" accept=".csv" onchange={importCsv} />
			</label>
			<button type="button" onclick={resetAll}>Reset votes</button>
		</div>
	</header>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th>Region</th>
					<th>Leader</th>
					<th>Votes</th>
					<th>Reported %</th>
					<th>Total Reg</th>
				</tr>
			</thead>
			<tbody>
				{#each state.regions as r (r.regionAttr)}
					<tr>
						<td>{r.name}</td>
						<td>
							<select
								value={r.leaderId ?? ''}
								onchange={(e) =>
									updateLeader(r.regionAttr, (e.currentTarget as HTMLSelectElement).value)}
							>
								<option value="">—</option>
								{#each state.candidates as c (c.id)}
									<option value={c.id}>{c.name}</option>
								{/each}
							</select>
						</td>
						<td>
							<input
								type="number"
								min="0"
								bind:value={r.votes}
								oninput={() => (state.ui.dirty = true)}
							/>
						</td>
						<td>
							<input
								type="number"
								min="0"
								max="100"
								step="0.1"
								bind:value={r.reportedPct}
								oninput={() => (state.ui.dirty = true)}
							/>
						</td>
						<td>
							<input
								type="number"
								min="0"
								bind:value={r.totalReg}
								oninput={() => (state.ui.dirty = true)}
							/>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<style>
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.heading {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: rgb(from var(--color-base-content) r g b / 0.7);
	}
	.actions {
		display: flex;
		gap: 0.375rem;
	}
	.file {
		background: var(--color-secondary);
		color: var(--color-base-content);
		border-radius: 0.25rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.file input {
		display: none;
	}
	button {
		background: var(--color-secondary);
		border: none;
		color: var(--color-base-content);
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.scroll {
		max-height: 22rem;
		overflow-y: auto;
		border: 1px solid var(--color-secondary);
		border-radius: 0.25rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}
	th,
	td {
		padding: 0.25rem 0.5rem;
		text-align: left;
		border-bottom: 1px solid var(--color-secondary);
	}
	th {
		position: sticky;
		top: 0;
		background: var(--color-base-300);
		font-weight: 600;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	input,
	select {
		width: 100%;
		background: var(--color-base-200);
		border: 1px solid var(--color-secondary);
		color: var(--color-base-content);
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
	}
</style>
