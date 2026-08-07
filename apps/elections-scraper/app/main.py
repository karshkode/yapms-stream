"""FastAPI sidecar for the YAPms OBS stream overlay.

Deferred past MVP. See ../README.md for the full plan. This file is the HTTP
shell; real scraping logic lives under ../scrapers/.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from scrapers.clarity import fetch_clarity_race

app = FastAPI(title="YAPms Elections Scraper", version="0.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8082", "http://127.0.0.1:8082"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/races/{state}/{election_id}/results")
async def race_results(state: str, election_id: str) -> dict:
    """Return a StreamStatePatch-shaped dict.

    For now we route everything through the Clarity scraper; per-state SoS
    scrapers (MinnPost idiom) slot in here behind a state -> scraper map.
    """
    try:
        return fetch_clarity_race(state=state, election_id=election_id)
    except NotImplementedError as err:
        raise HTTPException(status_code=501, detail=str(err))
    except Exception as err:  # pragma: no cover - defensive; real errors logged upstream
        raise HTTPException(status_code=502, detail=f"scrape failed: {err}") from err
