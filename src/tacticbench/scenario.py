"""Assemble a coherent halftime scenario for one real match.

Exists because the coach accepts any state dict, which means it is possible to
hand it one match's first half alongside a different team's memory. That
produces fluent, cited, completely meaningless advice — and it is exactly the
mistake made the first time the pipeline was run end to end.

A Scenario binds the four things that must agree: the match, the side that is
trailing, the opponent whose memory we recall, and the date at which that memory
is valid.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from . import data
from .demo import team_id
from .state import first_half_state
from .scan import extract_goals, score_at_halftime


@dataclass
class Scenario:
    match_id: int
    label: str
    date: str
    competition: str
    home: str
    away: str
    ht_home: int
    ht_away: int
    ft_home: int
    ft_away: int
    trailing_team: str
    opponent: str
    state: dict

    @property
    def deficit(self) -> int:
        return abs(self.ht_home - self.ht_away)

    @property
    def opponent_id(self) -> int:
        return team_id(self.opponent)

    @property
    def trailing_id(self) -> int:
        return team_id(self.trailing_team)

    @property
    def recovered(self) -> bool:
        if self.trailing_team == self.home:
            return self.ft_home >= self.ft_away
        return self.ft_away >= self.ft_home

    def summary(self) -> str:
        return (
            f"{self.label} [{self.date}, {self.competition}] — "
            f"HT {self.ht_home}-{self.ht_away}, {self.trailing_team} trail by "
            f"{self.deficit}; advising against {self.opponent}"
        )


class NoDeficit(ValueError):
    """Raised when neither side was behind at the break."""


def build(match_id: int, client: httpx.Client | None = None) -> Scenario:
    owns_client = client is None
    client = client or httpx.Client(timeout=90.0)
    try:
        meta = {m["match_id"]: m for m in data.all_matches(client)}.get(match_id)
        if not meta:
            raise ValueError(f"match {match_id} not in StatsBomb open data")

        events = data.events(client, match_id)
        home = meta["home_team"]["home_team_name"]
        away = meta["away_team"]["away_team_name"]

        ht_home, ht_away = score_at_halftime(extract_goals(events), home, away)
        if ht_home == ht_away:
            raise NoDeficit(f"{home} {ht_home}-{ht_away} {away} — level at halftime")

        trailing = home if ht_home < ht_away else away
        opponent = away if trailing == home else home

        return Scenario(
            match_id=match_id,
            label=f"{home} {meta['home_score']}-{meta['away_score']} {away}",
            date=meta["match_date"][:10],
            competition=meta["competition"]["competition_name"],
            home=home,
            away=away,
            ht_home=ht_home,
            ht_away=ht_away,
            ft_home=int(meta["home_score"]),
            ft_away=int(meta["away_score"]),
            trailing_team=trailing,
            opponent=opponent,
            state=first_half_state(events, home, away),
        )
    finally:
        if owns_client:
            client.close()
