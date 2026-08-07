"""Template for per-state SoS scrapers in the MinnPost election-night-api
idiom (https://github.com/MinnPost/election-night-api).

Copy this file, rename to the state (`minnesota.py`, `maine.py`, ...), fill in
`fetch()` to scrape the state's SoS results page / download, and register in
`app/main.py` routes.
"""

from __future__ import annotations

from typing import Any

STATE_POSTAL = "XX"


def fetch(election_id: str) -> dict[str, Any]:
    """Return StreamStatePatch-shaped dict for one race in this state.

    Args:
        election_id: State-specific race identifier (URL fragment or ID).

    Returns:
        {
            "race": {...},
            "candidates": [...],
            "regions": [...],
        }
    """
    raise NotImplementedError(
        f"Template scraper for {STATE_POSTAL}. Copy this file to a new "
        "per-state module, implement fetch() against the state's SoS feed, "
        "and register the route in app/main.py."
    )
