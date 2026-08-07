# elections-scraper (deferred)

Python sidecar for the YAPms OBS stream overlay. Runs alongside the Node dev
server and exposes a tiny FastAPI surface that the SvelteKit adapter
(`apps/stream/src/lib/data/clarity.ts`) talks to.

**Status: scaffold only.** MVP ships without this — `civicapi.ts` plus manual
entry on `/control` is enough for May 5, 2026. This sidecar fills in the ~12
states on SOE Software's Clarity platform (GA, KY, AR, NM, parts of CA, etc.)
once civicAPI coverage gaps show up.

## Run

```bash
cd apps/elections-scraper
pip install -e .[dev]
uvicorn app.main:app --reload --port 8000
```

## Endpoints

- `GET /health` — liveness check.
- `GET /races/{state}/{election_id}/results` — scrape and return normalized
  JSON matching `StreamStatePatch` from
  [`apps/stream/src/lib/data/source.ts`](../stream/src/lib/data/source.ts).

## Architecture

- `app/main.py` — FastAPI app, routes.
- `scrapers/clarity.py` — wraps [`washingtonpost/elex-clarity`](https://github.com/washingtonpost/elex-clarity).
  Inputs: state abbr, Clarity election ID. Output: dict in `StreamStatePatch`
  shape.
- `scrapers/minnpost_template.py` — skeleton for per-state SoS scrapers in the
  [MinnPost election-night-api](https://github.com/MinnPost/election-night-api)
  idiom. One Python class per state, all returning the same shape.

## Normalization contract

All scrapers return a JSON dict with:

```json
{
  "race": {
    "title": "string",
    "reportedPct": 47.3,
    "reportedPctLabel": ">95%",
    "totalVotes": 123456
  },
  "candidates": [
    { "id": "string", "name": "string", "partyLabel": "D", "partyColor": "#1b6cb0", "votes": 0, "called": false }
  ],
  "regions": [
    { "name": "Cuyahoga", "regionAttr": "Cuyahoga39", "leaderId": null, "votes": 0, "evr": 0, "reportedPct": 0, "totalReg": 0 }
  ]
}
```

Matches the `StreamStatePatch` shape on the Node side so the merge layer can
consume scraper output without any extra transformation.
