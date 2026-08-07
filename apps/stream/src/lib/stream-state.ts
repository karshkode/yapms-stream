import { z } from 'zod';
import {
	Candidate,
	MapTab,
	PartyBadge,
	PerformanceRow,
	RaceProfile,
	RegionResult,
	SubTab
} from './race-profile';

export const RaceMeta = z.object({
	title: z.string().default(''),
	partyBadge: PartyBadge.default('N'),
	partyBadgeColor: z.string().default('#6b7280'),
	pollsCloseLabel: z.string().default(''),
	dateLabel: z.string().default(''),
	decisionMadeLabel: z.string().nullable().default(null),
	reportedPctLabel: z.string().nullable().default(null),
	reportedPct: z.number().min(0).max(100).nullable().default(null),
	totalVotes: z.number().int().nonnegative().nullable().default(null)
});
export type RaceMeta = z.infer<typeof RaceMeta>;

export const UiVisible = z.object({
	header: z.boolean().default(true),
	candidates: z.boolean().default(true),
	performance: z.boolean().default(true),
	geography: z.boolean().default(true),
	regions: z.boolean().default(true)
});
export type UiVisible = z.infer<typeof UiVisible>;

export const RegionsSort = z.object({
	col: z.string().default('name'),
	dir: z.enum(['asc', 'desc']).default('asc')
});
export type RegionsSort = z.infer<typeof RegionsSort>;

export const PipCorner = z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']);
export type PipCorner = z.infer<typeof PipCorner>;

export const UiState = z.object({
	activeMapTab: MapTab.default('results'),
	activeSubTab: SubTab.default('Results'),
	candidatesExpanded: z.boolean().default(false),
	visible: UiVisible.default(() => UiVisible.parse({})),
	regionsPage: z.number().int().min(1).default(1),
	regionsSearch: z.string().default(''),
	regionsSort: RegionsSort.default(() => RegionsSort.parse({})),
	regionsPageSize: z.number().int().min(1).default(10),
	pickerExpanded: z.record(z.string(), z.boolean()).default({}),
	selectedRegionAttr: z.string().nullable().default(null),
	dirty: z.boolean().default(false),
	// Operator-desk chrome state. These drive the new /control layout and
	// sync over BroadcastChannel to /overlay so its mirror mode can hide the
	// right affordances (drawer/picker never show on the overlay, but
	// archivalYear and selectedRegionAttr do so the mirror stays in sync).
	drawerOpen: z.boolean().default(false),
	pickerOpen: z.boolean().default(false),
	// When set, RacePicker pre-fills its search input with this query and
	// pre-selects `pickerInitialTab`. Used by StateRacesCard's "Browse all
	// races for {state}" button to launch the picker scoped to a single
	// state without making the host re-type the state name. Cleared by the
	// picker's onclose so the next plain Cmd+K open is a clean slate.
	pickerQuery: z.string().default(''),
	// 'all' is the unified search across states, live civicAPI races and
	// templates, and the default the picker opens on. The narrower scopes keep
	// their original names so a persisted value still resolves.
	pickerInitialTab: z.enum(['all', 'templates', 'civicapi', 'saved']).default('all'),
	pipVisible: z.boolean().default(true),
	// Default bottom-left so the PiP doesn't stomp the bottom-right map
	// controls (zoom / reset / cities). Host can still cycle corners via
	// the chrome buttons; this just sets the first-load position.
	pipCorner: PipCorner.default('bottom-left'),
	// `pipMinimized` is distinct from `pipVisible`: minimized keeps the
	// chrome bar visible (so the host can re-expand) but hides the
	// scaled RacePage to free screen space. `pipVisible=false` removes
	// the PiP entirely until re-enabled (currently no UI to do so —
	// reserved for a future "Show PiP" affordance in the top bar).
	pipMinimized: z.boolean().default(false),
	// Stage detail-slot corner. Hosts the StatewideResultsCard /
	// RegionDetailCard / StateRacesCard. Default top-right matches the CNN
	// scoreboard convention; the card carries a "move" button that cycles
	// through corners so the host can clear the map zoom/cities controls
	// (now docked bottom-right) on demand.
	detailCardCorner: PipCorner.default('top-right'),
	activeDrawerTab: z
		.enum(['meta', 'candidates', 'regions', 'visibility', 'dataSource', 'saveLoad'])
		.default('meta'),
	// Archival time-slider position. null = live-only (map paints live data
	// or NEUTRAL). A year string like "2024" paints the map from that year's
	// archivalByYear snapshot when live data is absent for a region.
	archivalYear: z.enum(['2008', '2012', '2016', '2020', '2024']).nullable().default(null),
	// When true, clicking a state on a `regionLabel === 'States'` map opens
	// the StateRacesCard instead of zooming into that state. Toggleable from
	// the stage panel in a future iteration; default on because it matches
	// the CNN-style navigation the host asked for.
	statesCardOpen: z.boolean().default(false),
	// Floating "Regions" panel on the stage left edge. Lists every region
	// (counties / districts / states) in the loaded race so the host can
	// click into one without having to find it on the map. Default open
	// because that's the primary navigation aid the host asked for; the
	// panel includes its own collapse toggle so they can hide it when
	// they want a clean stage shot.
	regionListOpen: z.boolean().default(true),
	// Two-letter postal abbr (e.g. "KY") of the state the host drilled
	// into when launching the current race. Set by StateRacesCard when
	// the host clicks a civicAPI race or downballot template — null
	// otherwise (direct picker load, brand reset, fresh boot).
	//
	// Drives the TopBar "← All <State> races" affordance: clicking it
	// re-opens the browse-us shell with that state pre-selected, so the
	// StateRacesCard rehydrates from civicAPI's in-memory cache without
	// the host having to brand-click → click-state again. The full round
	// trip is meant to feel instant; the increased CACHE_TTL_MS in
	// data/civicapi.ts keeps the previous KY query resolved client-side
	// for ~10 minutes so race-night drilling stays snappy.
	homeStateAbbr: z.string().nullable().default(null),
	// MRU list of state abbrs the host has opened the StateRacesCard for.
	// Powers the TopBar "Recent" dropdown's States section so the host can
	// hop between (KY, TX, IN, OH, …) without re-clicking on the US map.
	// Capped at 8 entries by `pushRecentState` (see picker/recentStates.ts);
	// the cap matches savedRaces.recent so the dropdown's two columns stay
	// roughly the same height. Stored as uppercase abbrs to dedupe with
	// the StateMeta lookup in the dropdown.
	recentStates: z.array(z.string()).default([])
});
export type UiState = z.infer<typeof UiState>;

export const DataSourceConfig = z.object({
	adapter: z.enum(['manual', 'civicapi', 'clarity', 'ddhq']).default('manual'),
	raceId: z.string().nullable().default(null),
	intervalMs: z.number().int().min(1000).default(30_000),
	running: z.boolean().default(false),
	sidecarUrl: z.string().default('http://localhost:8000'),
	lastPolledAt: z.number().int().nullable().default(null),
	lastError: z.string().nullable().default(null)
});
export type DataSourceConfig = z.infer<typeof DataSourceConfig>;

export const SavedRaceRef = z.object({
	id: z.string(),
	label: z.string(),
	templateId: z.string().nullable(),
	parameters: z.record(z.string(), z.string()).default({}),
	savedAt: z.number().int(),
	state: z.lazy(() => StreamState).optional()
});
export type SavedRaceRef = z.infer<typeof SavedRaceRef>;

export const RecentRaceRef = z.object({
	templateId: z.string(),
	label: z.string(),
	parameters: z.record(z.string(), z.string()).default({}),
	loadedAt: z.number().int(),
	// When present, re-applying this recent entry should also point the data
	// source at civicAPI for this race id and resume polling. Lets "Recent"
	// carry live races, not just archival templates. Null/undefined means
	// the entry is a pure template load (manual data source).
	civicApiRaceId: z.string().nullable().default(null),
	// civicAPI race name at the moment the host loaded it. We prefer this
	// over the underlying template's generic label ("US House TX-15") so
	// Recent surfaces the human-friendly name the host actually saw.
	civicApiTitle: z.string().nullable().default(null),
	// Freeform note like "2026 general" or the election date — shown as the
	// subtitle in the Recent list so the host can distinguish repeated
	// template loads across different cycles.
	subtitle: z.string().nullable().default(null),
	// County name the host should zoom into on re-load. Populated from
	// civicAPI's `district` field for municipal races ("Yorktown Town
	// Council" → "Delaware"). The apply flow fuzzy-matches this against
	// the template's seeded regions and stamps `ui.selectedRegionAttr`
	// so the stage re-focuses on that county on every recent reload.
	preselectCountyName: z.string().nullable().default(null)
});
export type RecentRaceRef = z.infer<typeof RecentRaceRef>;

export const SavedRacesState = z.object({
	recent: z.array(RecentRaceRef).default([]),
	bookmarked: z.array(SavedRaceRef).default([])
});
export type SavedRacesState = z.infer<typeof SavedRacesState>;

export const StreamState: z.ZodType<StreamStateShape> = z.lazy(() =>
	z.object({
		race: RaceMeta.default(() => RaceMeta.parse({})),
		profile: RaceProfile.nullable().default(null),
		candidates: z.array(Candidate).default([]),
		performance: z.array(PerformanceRow).default([]),
		regions: z.array(RegionResult).default([]),
		ui: UiState.default(() => UiState.parse({})),
		dataSource: DataSourceConfig.default(() => DataSourceConfig.parse({})),
		savedRaces: SavedRacesState.default(() => SavedRacesState.parse({}))
	})
);

export type StreamStateShape = {
	race: RaceMeta;
	profile: RaceProfile | null;
	candidates: Candidate[];
	performance: PerformanceRow[];
	regions: RegionResult[];
	ui: UiState;
	dataSource: DataSourceConfig;
	savedRaces: SavedRacesState;
};

export type StreamState = StreamStateShape;

export const DEFAULT_STREAM_STATE: StreamState = {
	race: RaceMeta.parse({}),
	profile: null,
	candidates: [],
	performance: [],
	regions: [],
	ui: UiState.parse({}),
	dataSource: DataSourceConfig.parse({}),
	savedRaces: SavedRacesState.parse({})
};
