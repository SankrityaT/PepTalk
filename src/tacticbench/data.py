"""Fetching and caching StatsBomb open data.

Events files average ~3MB and there are ~4000 matches, so we never keep raw
events for the whole dataset. The scan pass streams each file, extracts the few
fields it needs, and discards the body. Full events are cached only for matches
that survive selection.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

RAW = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"

CACHE = Path(__file__).resolve().parents[2] / ".cache" / "statsbomb"


def _cache_path(kind: str, name: str) -> Path:
    return CACHE / kind / f"{name}.json"


def _read_cache(kind: str, name: str):
    p = _cache_path(kind, name)
    if p.exists():
        try:
            return json.loads(p.read_text())
        except json.JSONDecodeError:
            p.unlink()  # corrupt partial write
    return None


def _write_cache(kind: str, name: str, payload) -> None:
    p = _cache_path(kind, name)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload))
    tmp.replace(p)


def competitions(client: httpx.Client) -> list[dict]:
    cached = _read_cache("meta", "competitions")
    if cached is not None:
        return cached
    payload = client.get(f"{RAW}/competitions.json").raise_for_status().json()
    _write_cache("meta", "competitions", payload)
    return payload


def matches(client: httpx.Client, competition_id: int, season_id: int) -> list[dict]:
    key = f"{competition_id}_{season_id}"
    cached = _read_cache("matches", key)
    if cached is not None:
        return cached
    r = client.get(f"{RAW}/matches/{competition_id}/{season_id}.json")
    if r.status_code == 404:
        return []
    payload = r.raise_for_status().json()
    _write_cache("matches", key, payload)
    return payload


def all_matches(client: httpx.Client) -> list[dict]:
    """Every match in the open dataset, with competition metadata attached."""
    out: list[dict] = []
    for comp in competitions(client):
        for m in matches(client, comp["competition_id"], comp["season_id"]):
            m["competition_name"] = comp["competition_name"]
            m["season_name"] = comp["season_name"]
            out.append(m)
    return out


def events(client: httpx.Client, match_id: int, cache: bool = True) -> list[dict]:
    """Full event feed for one match.

    ``cache=False`` is used by the scan pass, which touches every match once and
    would otherwise write ~12GB to disk.
    """
    if cache:
        cached = _read_cache("events", str(match_id))
        if cached is not None:
            return cached
    payload = client.get(f"{RAW}/events/{match_id}.json").raise_for_status().json()
    if cache:
        _write_cache("events", str(match_id), payload)
    return payload
