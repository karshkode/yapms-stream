"""Wraps washingtonpost/elex-clarity for the ~12 SOE Clarity states.

Deferred past MVP: this is a stub with the call shape wired up, so when the
host wants live coverage in GA/KY/AR/NM/... the only remaining work is
mapping elex-clarity's result objects onto our StreamStatePatch shape.
"""

from __future__ import annotations

from typing import Any


def fetch_clarity_race(state: str, election_id: str) -> dict[str, Any]:
    """Return a StreamStatePatch-shaped dict for a given Clarity race.

    Args:
        state: Two-letter state abbreviation (e.g. "GA").
        election_id: The Clarity-side election identifier.

    Raises:
        NotImplementedError: Until wired up to elex-clarity.
    """
    # Target flow once enabled:
    #
    #   from elexclarity import fetch
    #   raw = fetch(
    #       election_id=election_id,
    #       statepostal=state.upper(),
    #       level="county",
    #       outputType="json",
    #   )
    #   return _normalize_clarity(raw)
    raise NotImplementedError(
        "Clarity scraper stub. Enable by installing elex-clarity and "
        "implementing _normalize_clarity() against the StreamStatePatch shape "
        "documented in apps/elections-scraper/README.md."
    )


def _normalize_clarity(raw: Any) -> dict[str, Any]:
    """Map elex-clarity output onto the StreamStatePatch contract.

    Keys expected by the Node side (see apps/stream/src/lib/data/source.ts):
      - race.{title,reportedPct,reportedPctLabel,totalVotes}
      - candidates[].{id,name,partyLabel,partyColor,votes,called,hidden}
      - regions[].{name,regionAttr,leaderId,votes,evr,reportedPct,totalReg}
    """
    raise NotImplementedError(raw)
