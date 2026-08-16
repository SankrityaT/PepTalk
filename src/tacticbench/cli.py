"""Run the backtest.

    uv run python -m tacticbench.cli prepare --min-deficit 2
    uv run python -m tacticbench.cli trial --limit 4          # needs ANTHROPIC_API_KEY
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import httpx

from . import data
from .actual import actual_intervention
from .anonymize import TEAM_LABELS, anonymize, assert_clean, forbidden_terms
from .runner import DEFAULT_MODEL, MissingKeyError, canary, recommend
from .score import aggregate, score_trial
from .state import first_half_state

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
SCAN = RESULTS / "ht_deficits.json"


def _load_scan() -> dict:
    if not SCAN.exists():
        raise SystemExit("run `python -m tacticbench.scan` first")
    return json.loads(SCAN.read_text())


def select(min_deficit: int, per_group: int | None, seed: int = 11) -> list[dict]:
    """Treatment cases plus controls matched on deficit size.

    Matching on deficit matters: recovery rates fall steeply with deficit (29%
    at one goal, 7.9% at two, 1.2% at three), so unmatched controls would differ
    from treatments on difficulty rather than on tactics.
    """
    rows = [r for r in _load_scan()["matches"] if r["ht_deficit"] >= min_deficit]
    treatment = [r for r in rows if r["group"] == "treatment"]
    controls = [r for r in rows if r["group"] == "control"]

    rng = random.Random(seed)
    if per_group:
        treatment = rng.sample(treatment, min(per_group, len(treatment)))

    by_deficit: dict[int, list[dict]] = {}
    for c in controls:
        by_deficit.setdefault(c["ht_deficit"], []).append(c)

    matched: list[dict] = []
    for t in treatment:
        pool = by_deficit.get(t["ht_deficit"], [])
        if pool:
            matched.append(pool.pop(rng.randrange(len(pool))))

    # Interleaved deterministically so that a truncated run (--limit) still holds
    # roughly equal treatment and control, rather than taking all treatment first.
    combined = treatment + matched
    rng.shuffle(combined)
    return combined


def build_case(client: httpx.Client, row: dict) -> dict:
    """Anonymized payload plus ground-truth intervention for one match."""
    events = data.events(client, row["match_id"])
    home, away = row["home"], row["away"]

    state = first_half_state(events, home, away)
    payload = anonymize(state, tuple(row["ht"]))

    terms = forbidden_terms(events, home, away, row["competition"], row["season"])
    assert_clean(payload, terms)  # raises LeakError on any leak

    trailing_team = home if row["trailing_side"] == "home" else away
    return {
        "match_id": row["match_id"],
        "group": row["group"],
        "ht_deficit": row["ht_deficit"],
        "trailing_label": TEAM_LABELS[row["trailing_side"]],
        "payload": payload,
        "actual": actual_intervention(events, trailing_team),
        "forbidden_terms": sorted(terms),
        # Identity kept out of band, for analysis only. Never sent to the model.
        "_identity": f"{home} {row['ht'][0]}-{row['ht'][1]} {away} -> {row['ft'][0]}-{row['ft'][1]}",
    }


def cmd_prepare(args) -> None:
    rows = select(args.min_deficit, args.per_group)
    print(f"selected {len(rows)} matches (min deficit {args.min_deficit})")
    cases, failures = [], []
    with httpx.Client(timeout=60.0) as client:
        for i, row in enumerate(rows, 1):
            try:
                cases.append(build_case(client, row))
            except Exception as exc:  # noqa: BLE001
                failures.append({"match_id": row["match_id"], "error": str(exc)})
            if i % 10 == 0:
                print(f"  {i}/{len(rows)}")

    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "cases.json").write_text(json.dumps(cases, indent=2))
    print(f"\nprepared {len(cases)} cases, {len(failures)} failures")
    if failures:
        print("failures:", failures[:5])
    print(
        f"  treatment={sum(1 for c in cases if c['group']=='treatment')} "
        f"control={sum(1 for c in cases if c['group']=='control')}"
    )


def cmd_trial(args) -> None:
    cases = json.loads((RESULTS / "cases.json").read_text())
    if args.limit:
        cases = cases[: args.limit]

    trials = []
    for i, case in enumerate(cases, 1):
        terms = set(case["forbidden_terms"])
        row = {"match_id": case["match_id"], "group": case["group"]}
        try:
            can = canary(case["payload"], terms, model=args.model)
            row["canary"] = can
            if not can["passed"]:
                row["status"] = "discarded_canary_failed"
                print(f"[{i}/{len(cases)}] {case['match_id']} CANARY FAILED {can['identified_terms']}")
                trials.append(row)
                continue

            rec = recommend(case["payload"], case["trailing_label"], model=args.model)
            row["recommendation"] = rec
            row.update(score_trial(rec, case["actual"]))
            row["status"] = "scored"
            print(
                f"[{i}/{len(cases)}] {case['match_id']} {case['group']:<9} "
                f"alignment={row['alignment']} ({row['matches']}/{row['scorable_dimensions']})"
            )
        except MissingKeyError:
            raise
        except Exception as exc:  # noqa: BLE001
            row["status"] = f"error: {exc}"
            print(f"[{i}/{len(cases)}] {case['match_id']} ERROR {exc}")
        trials.append(row)

    summary = aggregate([t for t in trials if t.get("status") == "scored"])
    out = {
        "model": args.model,
        "n_trials": len(trials),
        "canary_failures": sum(1 for t in trials if t.get("status") == "discarded_canary_failed"),
        "summary": summary,
        "trials": trials,
    }
    (RESULTS / "trials.json").write_text(json.dumps(out, indent=2))
    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2))
    print(f"canary failures: {out['canary_failures']}/{len(trials)}")


def main() -> None:
    p = argparse.ArgumentParser(prog="tacticbench")
    sub = p.add_subparsers(dest="cmd", required=True)

    pr = sub.add_parser("prepare", help="build anonymized cases (no API needed)")
    pr.add_argument("--min-deficit", type=int, default=2)
    pr.add_argument("--per-group", type=int, default=None)
    pr.set_defaults(func=cmd_prepare)

    tr = sub.add_parser("trial", help="run canary + recommendation + scoring")
    tr.add_argument("--limit", type=int, default=None)
    tr.add_argument("--model", default=DEFAULT_MODEL)
    tr.set_defaults(func=cmd_trial)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
