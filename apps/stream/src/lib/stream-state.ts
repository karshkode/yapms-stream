import { z } from 'zod';
import { InsightsData } from './data/insights';
import {
	Candidate,
	ComparisonBaseline,
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
	totalVotes: z.number().int().nonnegative().nullable().default(null),
	/**
	 * IANA zone the election is being held in, which is the clock the overlay
	 * captions itself with. Null for a national race, or when the race's state
	 * couldn't be identified, in which case the host's own clock is used — the
	 * behaviour everything had before this field existed. See lib/time-zone.ts.
	 */
	timeZone: z.string().nullable().default(null)
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

/**
 * One candidate line in a followed race's ticker entry. Deliberately a flat
 * copy rather than a `Candidate` reference: a followed race is a *different*
 * race from the one loaded on the stage, so it has its own roster and there is
 * nowhere in StreamState to hang it. Keeping the shape minimal also keeps the
 * 250ms BroadcastChannel payload small when the host follows a dozen races.
 */
export const TickerCandidate = z.object({
	name: z.string(),
	partyLabel: z.string().default(''),
	partyColor: z.string().default('#6b7280'),
	votes: z.number().int().nonnegative().default(0),
	called: z.boolean().default(false),
	headshotUrl: z.string().nullable().default(null)
});
export type TickerCandidate = z.infer<typeof TickerCandidate>;

/**
 * A race the host is watching in the ticker without loading it onto the stage.
 *
 * The tallies live here, refreshed by a slow poll loop on /control. /overlay
 * never fetches anything itself — it just renders whatever arrived over the
 * BroadcastChannel, which keeps the OBS tab cheap and means the ticker can't
 * disagree with the control desk.
 */
export const FollowedRace = z.object({
	raceId: z.string(),
	/** Display label, seeded from the civicAPI race name at follow time. */
	label: z.string(),
	/** Postal abbr, shown as the leading chip on the ticker item. */
	state: z.string().nullable().default(null),
	reportedPct: z.number().min(0).max(100).nullable().default(null),
	candidates: z.array(TickerCandidate).default([]),
	updatedAt: z.number().int().nullable().default(null),
	lastError: z.string().nullable().default(null)
});
export type FollowedRace = z.infer<typeof FollowedRace>;

export const BroadcastDock = z.enum(['right', 'left', 'off']);
export type BroadcastDock = z.infer<typeof BroadcastDock>;

/**
 * A race call, frozen at the moment the host pushed it on air.
 *
 * Every number here is a copy rather than a live read, and that's the point. A
 * projection is a claim made at a time — "at 9:41, with 62% counted, we're
 * calling this for El-Sayed" — and a card that keeps updating would drift away
 * from its own timestamp within minutes, until it showed 94% counted next to a
 * time three hours earlier. Worse, if the count later tightened, a live card
 * would quietly rewrite what the desk said. The frozen copy is the record of the
 * call; the results rail next to it is the live number, and the two being
 * different is information rather than a bug.
 *
 * `kind` separates the two things a desk says, which are not the same claim:
 * a projection is the desk's own model getting ahead of the count, while a
 * winner is the count being finished enough that nobody disputes it.
 */
export const RaceCall = z.object({
	candidateId: z.string(),
	/** Copied, so deleting or renaming a candidate can't garble a card on air. */
	name: z.string(),
	party: z.string().default(''),
	partyColor: z.string().default('#6b7280'),
	headshotUrl: z.string().nullable().default(null),
	kind: z.enum(['projected', 'winner']).default('projected'),
	/** ms epoch. Rendered in the race's own time zone, like every other clock. */
	at: z.number().int(),
	votes: z.number().int().nonnegative().default(0),
	/** Share of the counted vote, 0-100. */
	pct: z.number().default(0),
	/** Lead over the runner-up in points at the moment of the call. */
	marginPct: z.number().default(0),
	reportedPct: z.number().nullable().default(null),
	/** Who made the call: the desk, a wire, or the candidate's own concession. */
	source: z.string().default(''),
	/** One optional line of colour, e.g. "first Democrat to hold this seat since 1994". */
	note: z.string().default(''),
	raceTitle: z.string().default('')
});
export type RaceCall = z.infer<typeof RaceCall>;

/**
 * Broadcast presentation config — the news-channel chrome the host asked for.
 *
 * `dock` applies to BOTH /control and /overlay: it moves the results card out
 * of a floating corner overlay and into a real column beside the map, so the
 * map never has a card sitting on top of it. `frame` / `ticker` are /overlay
 * only, since they're the parts that only make sense once the scene is on air.
 */
export const BroadcastConfig = z.object({
	/** Network-style border, top banner and lower third around the overlay. */
	frame: z.boolean().default(true),
	/** Which side the results rail docks to, or 'off' for the legacy
	 *  floating-corner card. */
	dock: BroadcastDock.default('right'),
	ticker: z.boolean().default(true),
	/** Seconds for one full marquee pass. Longer = slower crawl. */
	tickerSpeedSec: z.number().min(15).max(300).default(60),
	/** Branding in the top-left of the frame. */
	networkName: z.string().default('DECISION DESK'),
	/** Optional manual chyron line. Falls back to the race title when blank. */
	headline: z.string().default(''),
	liveBadge: z.boolean().default(true),
	/** Auto-resolve candidate headshots from Wikipedia when a roster loads. */
	autoPhotos: z.boolean().default(true),
	/** Cadence for refreshing followed-race tallies. Much slower than the
	 *  active race's poll because these are background numbers. */
	followIntervalMs: z.number().int().min(15_000).default(60_000),
	followed: z.array(FollowedRace).default([]),
	/**
	 * The call card currently on air, or null for none.
	 *
	 * Under `broadcast` rather than on `race` because it is a graphic the host
	 * pushes and pulls, not a fact about the race — and because everything here
	 * survives `applyTemplate`, so hopping to another race and back doesn't drop
	 * a card mid-broadcast.
	 */
	call: RaceCall.nullable().default(null),
	/** The odds/polling strip across the top of the stage. */
	insightsStrip: z.boolean().default(true)
});
export type BroadcastConfig = z.infer<typeof BroadcastConfig>;

/**
 * Where the market price and polling average come from, and the last ones we got.
 *
 * The query is stored rather than derived on every read because it can't always
 * be derived correctly: Polymarket names its events by hand ("Michigan Senate
 * Election Winner", but "Who will win the Georgia runoff?") and VoteHub keys
 * polls by its own subject strings. The defaults are computed from the race, and
 * the two overrides exist for when the defaults miss — which is a text field the
 * host fixes in ten seconds, rather than a race the feature can't cover.
 *
 * `data` is the fetched result, kept in state so it rides the existing
 * BroadcastChannel publish to /overlay. It is a few candidates' worth of numbers,
 * far smaller than the region array already going over that channel, and it means
 * /overlay never talks to the network — which matters because the machine running
 * OBS is the one that must not stall.
 */
export const InsightsConfig = z.object({
	enabled: z.boolean().default(true),
	/** Overrides the market search; a Polymarket event slug. */
	marketSlug: z.string().default(''),
	/** Overrides the market search text, e.g. "Georgia runoff". */
	marketQuery: z.string().default(''),
	/** Overrides VoteHub's contest name, e.g. "2026 Michigan". */
	pollSubject: z.string().default(''),
	/**
	 * Markets move all night, but not fast enough to justify a tighter loop than
	 * this — and the polling half of the same request changes a few times a week.
	 */
	refreshMs: z.number().int().min(30_000).default(120_000),
	data: InsightsData.nullable().default(null),
	lastError: z.string().nullable().default(null)
});
export type InsightsConfig = z.infer<typeof InsightsConfig>;

/**
 * What the comparison map modes measure against.
 *
 * `baselineRef` is a tagged string rather than parallel fields so there is
 * exactly one answer to "compared to what?":
 *   - `history:senate-2024` — a past race for the same office in this state,
 *     baked by scripts/bake-office-history.mjs. The one a downballot night
 *     actually wants, and auto-selected when the race's title says which office
 *     it is.
 *   - `archival:2024` — the baked presidential county margins that ship with
 *     the state seeds. Available on any county map with no setup, which is why
 *     it's the fallback default: Swing used to paint the whole map neutral grey
 *     until the host discovered the archival slider, and a mode that shows
 *     nothing until you find an unrelated control reads as broken.
 *   - `captured:<id>` — a race the host froze via `captureBaseline`, which is
 *     how a May primary becomes November's comparison.
 */
export const ComparisonConfig = z.object({
	baselineRef: z.string().default('archival:2024'),
	/**
	 * True while the host hasn't chosen a baseline themselves, which lets
	 * loading a race re-point the comparison at that race's own office history.
	 *
	 * Without the flag there's no way to tell an untouched default from a
	 * deliberate choice, and auto-selection would have to either never run —
	 * leaving the feature behind a control the host has to find — or run every
	 * time and silently overwrite a host who picked the presidential margin on
	 * purpose. Cleared by the Compare panel the moment they pick anything.
	 */
	baselineAuto: z.boolean().default(true),
	baselines: z.array(ComparisonBaseline).default([])
});
export type ComparisonConfig = z.infer<typeof ComparisonConfig>;

/**
 * Which part of the map the operator is looking at, so /overlay looks there too.
 *
 * The overlay already followed a *region selection* — click a county on the desk
 * and the OBS scene zoomed to the same county — but a free pan or a wheel-zoom
 * moved only the desk. That's the half of the gesture a host uses most: sliding
 * up the Hudson Valley while talking, pulling back a little to get two counties
 * in frame. On air the map just sat there.
 *
 * Stored as a rectangle in the SVG's own user units rather than as panzoom's
 * `{x, y, scale}`, because the two surfaces are different sizes — the desk's map
 * shares its width with a results rail, the OBS canvas doesn't. See `MapCamera`
 * in map/pan-scene.ts for the arithmetic. `profileId` stamps which map the rect
 * belongs to, so a camera left over from the previous race is ignored rather
 * than applied to a different geography.
 */
export const MapCameraState = z.object({
	profileId: z.string(),
	x: z.number(),
	y: z.number(),
	w: z.number(),
	h: z.number()
});
export type MapCameraState = z.infer<typeof MapCameraState>;

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
		.enum([
			'meta',
			'candidates',
			'regions',
			'compare',
			'markets',
			'call',
			'visibility',
			'broadcast',
			'dataSource',
			'saveLoad'
		])
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
	recentStates: z.array(z.string()).default([]),
	// Broadcast chrome + followed races. Lives under `ui` for two reasons:
	// `applyTemplate` spreads `...state.ui`, so loading a race can't wipe the
	// host's ticker mid-broadcast; and `salvagePersistedState` rescues `ui`
	// wholesale when a newer schema fails to parse, so a followed-race list
	// survives an upgrade that invalidates the rest of the blob.
	broadcast: BroadcastConfig.default(() => BroadcastConfig.parse({})),
	// Under `ui` for the same two reasons as `broadcast`, and one that matters
	// more here: a captured baseline is only useful in a *different* race than
	// the one it came from, so it has to survive `applyTemplate` spreading
	// `...state.ui` when the host loads November's general.
	comparison: ComparisonConfig.default(() => ComparisonConfig.parse({})),
	// Published by /control's map on every pan and zoom; applied by /overlay's.
	// Null until the first gesture, and after a race load — the follower falls
	// back to framing whatever region is selected, which is what it did before.
	mapCamera: MapCameraState.nullable().default(null),
	// Market price + polling average. Under `ui` alongside `broadcast` for the
	// same reasons, and one of its own: the host's corrected market search for a
	// race with an awkward name shouldn't be thrown away by a template reload.
	insights: InsightsConfig.default(() => InsightsConfig.parse({}))
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
