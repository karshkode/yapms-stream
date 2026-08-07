# apps/stream — YAPms OBS Stream Overlay

A SvelteKit app that renders a [DDHQ-style](https://votes.decisiondeskhq.com/)
race page as a transparent OBS browser-source overlay, plus a control panel
for the host. Fork of [yapms/yapms](https://github.com/yapms/yapms); reuses the
SVG asset catalog but does not share runtime code with `apps/yapms`.

## Quick start

```bash
# from repo root
npm install
npm run dev -- --filter=stream
```

Two URLs you'll use:

- `http://localhost:8082/overlay` — OBS Browser Source URL (transparent).
- `http://localhost:8082/control` — CNN-style operator desk; run this in a
  normal browser tab on the same machine.

Edits in `/control` push to `/overlay` through `BroadcastChannel`, live, on
every keystroke.

## Operator-desk walkthrough (`/control`)

`/control` is laid out like a CNN election-night console, not a spreadsheet.
You'll spend most of the night interacting with the big stage map; the forms
only come out when you need to edit something.

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopBar: title  [badge]  [Cmd+K Templates]  [Copy URL]  [Edit]  e    │
├──────────────────────────────────────────────────────────────────────┤
│  [Results|Margin|Swing|Remaining]                    ┌── Region ──┐ │
│                                                      │  detail    │ │
│                                                      │  card      │ │
│                                                      └────────────┘ │
│                                                                      │
│                 ████  STAGE: interactive map   ████                  │
│                                                                      │
│                                             ┌─── PiP preview ─────┐ │
│                                             │  /overlay, scaled   │ │
│                                             └─────────────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│ FormsDrawer (slide-up, hidden by default):                           │
│   [Race meta] [Candidates] [Regions] [Visibility] [Data source] ... │
└──────────────────────────────────────────────────────────────────────┘
```

**Core gestures**

| Gesture                        | What happens                                                      |
| ------------------------------ | ----------------------------------------------------------------- |
| Click a county / state         | Map zooms to that region; detail card appears with archival ±%    |
| Click the same region again    | Deselects (toggle)                                                |
| `Esc`                          | Closes picker → clears selection → closes drawer (cascade)        |
| `Cmd/Ctrl + K`                 | Opens the race picker modal (templates / civicAPI / saved)        |
| `e`                            | Toggles the FormsDrawer at the bottom                             |
| Edit button (top bar)          | Same as `e` — for mice                                            |
| PiP corner buttons             | Snap the overlay-preview PiP to any of the 4 corners, or hide it  |

**Archival colors (new)**

Every statewide template and the US President templates ship with a 2020
per-county margin color baked in. Before a single vote is reported, the map
already looks like CNN's "last cycle" layer: deep red for Trump +10%+,
near-tossup pink/pale-blue for close counties, deep blue for Biden +10%+.
When live data starts arriving, the archival layer is replaced by the live
leader's party color on a per-region basis.

The ramp mirrors yapms's candidate `margins` stops:

| Two-party margin | R color     | D color     |
| ---------------- | ----------- | ----------- |
| ≥ 10 pts         | `#BF1D29`   | `#1C408C`   |
| 5 – 10 pts       | `#FF5865`   | `#577CCC`   |
| 1 – 5 pts        | `#FF8B98`   | `#8AAFFF`   |
| < 1 pt           | `#CF8980`   | `#949BB3`   |
| < 0.5 pt         | `#6b7280` (tossup gray)                   |

## OBS Browser Source setup

1. OBS → Add Source → **Browser**.
2. URL: `http://localhost:8082/overlay`
3. Width / Height: match your canvas (1920×1080 is typical).
4. Uncheck **Shutdown source when not visible**.
5. Uncheck **Refresh browser when scene becomes active**.
6. The background is transparent by default — don't set any background color
   in OBS.

Only `/overlay` belongs in OBS. `/control` stays in your normal browser.

## Visibility presets

The race page has five sections: **Header / Candidates / Performance /
Geography map / Regions table**. The host can toggle each on or off from
/control's "Visible sections" panel. Common presets:

- **State-wide primary, live**: header + candidates + geography + regions.
- **Local race (mayor, city council)**: header + candidates only. The
  `local-no-map` template auto-configures this.
- **Chyron / lower third**: candidates only. (Drop into a smaller Browser
  Source sized for the lower third and turn off everything else.)
- **Full DDHQ look for a district**: all five sections.

## Data sources

Adapter priority is **manual > live > seed**. A field set by the host on
/control always wins over anything a live feed provides, which in turn wins
over a template's baked seed.

| Tier | Source                          | Status   | Notes                                                                                                 |
| ---- | ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| 1    | Manual (`data/manual.ts`)       | Shipping | Host typing in /control. Always wins.                                                                 |
| 1    | civicAPI (`data/civicapi.ts`)   | Shipping | Free, no API key. Primary live feed for May 5, 2026. Polls every 30s by default.                      |
| 2    | Clarity (`data/clarity.ts`)     | Deferred | Python sidecar `apps/elections-scraper/` wraps elex-clarity. Covers ~12 SOE states (GA, KY, AR, NM…). |
| 3    | Template seed                   | Shipping | County lists and past-cycle margins baked at build time via `scripts/bake-county-seeds.ts`.           |
| 4    | OpenFEC (`data/openfec.ts`)     | Shipping | Metadata-only. Needs a free API key. Populates candidate editor for federal races.                    |
| —    | DDHQ (`data/ddhq.ts`)           | Deferred | Paid API. Stub in place behind a feature flag for a future host who subscribes.                       |
| —    | Ballotpedia                     | Deferred | Headshots + bios. Stub only.                                                                          |

### civicAPI etiquette

- Default poll interval: 30s. Don't go below 10s.
- The adapter backs off to 60–120s when a request fails.
- No attribution banner is rendered on the overlay itself; acknowledge civicAPI
  in your stream description per their commercial-use terms.

## Python sidecar (`apps/elections-scraper/`)

Deferred past MVP. When you need Clarity coverage:

```bash
cd apps/elections-scraper
pip install -e .[dev]
uvicorn app.main:app --reload --port 8000
```

Then on /control, set **Data source → Sidecar URL** to `http://localhost:8000`
and select the **Clarity** adapter. See
[`apps/elections-scraper/README.md`](../elections-scraper/README.md) for the
scraper architecture.

## Adding a new race template

All templates live under [`src/lib/templates/`](./src/lib/templates/). Each
template is a `RaceTemplate` object (see
[`race-profile.ts`](./src/lib/race-profile.ts) for the schema) and exports
itself from a file the index picks up:

1. Create `src/lib/templates/my-template.ts` and export a `RaceTemplate`.
2. Add the export to the relevant array in `index.ts` (`ALL_TEMPLATES`).
3. The in-memory search index picks it up automatically at app boot.

For parameterized templates (US House, state-leg style), export a factory
function that builds a `RaceTemplate` from a parameter object — see
[`us-house.ts`](./src/lib/templates/us-house.ts) and
[`state-leg.ts`](./src/lib/templates/state-leg.ts) for the pattern.

## Baking seed data

Three one-time scripts under [`scripts/`](./scripts):

- `bake-county-seeds.ts` — pulls the yapms counties SVG and emits one JSON
  seed per state under `src/lib/templates/seed-data/state-<FIPS>.json` with
  county name + regionAttr + registration stubs.
- `bake-historical-margins.mjs` — downloads the 2020 county-level presidential
  CSV (`tonmcg/US_County_Level_Election_Results_08-24`, ~340 KB) and merges
  per-county `{archivalColor, archivalLabel, archivalMargin}` into each
  `state-<FIPS>.json`, plus writes `seed-data/us-presidential-2020-baseline.json`
  with the per-state aggregates that the US President templates consume.
- `bake-historical-margins.ts` — scaffolds per-district Performance-row seeds
  from MEDSL precinct-level data. Scaffold only; full implementation is
  deferred past MVP.

```bash
npx tsx scripts/bake-county-seeds.ts
node scripts/bake-historical-margins.mjs
npx tsx scripts/bake-historical-margins.ts
```

Re-run `bake-historical-margins.mjs` after `bake-county-seeds.ts` if you
re-generate seeds from scratch — it composes cleanly (it only sets the three
archival fields on existing county rows; other fields are preserved).

The CSV downloader caches under `scripts/.cache/` on first run. For air-gapped
environments, drop the CSV there manually and the downloader short-circuits.

## OBS alternatives (when Browser Source isn't an option)

- **Browser Source + obs-websocket**: install
  [obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js),
  add `src/lib/obs/client.ts`, and expose scene-switch buttons on /control.
  Optional v2.
- **Window capture**: point OBS at a Chromium window running /overlay as a
  PWA. Loses transparency; fallback only.
- **Native OBS C++ plugin**: out of scope. Browser Source covers every
  requirement.

## Cross-race-type smoke matrix

Pre-May-5 validation pass must cover at least one race of each shape:

| Shape                               | Example (May 5, 2026)                                | Data source      |
| ----------------------------------- | ---------------------------------------------------- | ---------------- |
| State-wide partisan primary         | Indiana Governor / Ohio US Senate D Primary          | civicAPI live    |
| US House district primary           | any contested `P US House N`                         | civicAPI         |
| State-leg district primary          | any `P State House N` / `P State Senate N`           | Manual           |
| Local no-map                        | Bangor / Mackinac Island City Council                | Manual           |
| Historical replay (regression)      | 2024 Idaho President                                 | Baked seed       |

## Operator-desk smoke test

Three scenarios to run after any change to the stage / picker / drawer code:

1. **Archival baseline renders before live data.** Open `/control`, hit
   `Cmd/Ctrl + K`, type "Alabama", press Enter. All 67 counties should paint
   2020 margin colors (mostly red, Dallas and a few Black Belt counties blue).
   Click any county → map zooms to it, detail card shows e.g. "2020: Trump
   +54.5", and the "No reporting yet — showing 2020 baseline." hint
   is visible. `Esc` clears the selection and zooms back out.
2. **US President state-level baseline.** `Cmd+K` → "2024 US President". All
   51 states (50 + DC) ship colored by their 2020 margin; PA/GA/AZ are pale
   blue, TX is light red, CA/NY are deep blue, etc. Click PA → zooms, card
   shows something like "Biden +1.2".
3. **civicAPI live still works.** `Cmd+K` → civicAPI tab → search "Kansas
   City" → load the KC Bonds race (raceId 1426). Stage map goes empty (local
   bond race has no geography — expected). Press `e` to open the drawer,
   tap **Candidates**, verify live candidate rows. Press `e` to close.
4. **OBS Browser Source unchanged.** Open `/overlay` in a second tab. It
   should mirror whatever race is loaded in `/control` — no layout chrome,
   no PiP, no drawer.
