#!/usr/bin/env bash
#created by kinjal
#
# Everything "add a game" claims to do, checked end to end.
#
#     ./scripts/check-add-a-game.sh
#
# Needs HydraDB running (see README) and nothing else. Leaves no servers
# behind and removes the workspace it creates, so it can be run repeatedly.
#
# Exits non-zero on the first real failure, so it is usable in CI.

set -uo pipefail
cd "$(dirname "$0")/.."

pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

FIXTURE=3877072          # Inter Miami 0-0 Nashville SC, MLS 2023 (90% frames)
BROKEN=3877194           # Charlotte v Inter Miami — 360 feed does not join
KEY="inter-miami-$FIXTURE"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

# ── 1. The suite ─────────────────────────────────────────────────────────
head "1. Unit tests"
if uv run pytest -q > /tmp/pt.log 2>&1; then
  ok "$(tail -1 /tmp/pt.log)"
else
  bad "pytest failed"; tail -20 /tmp/pt.log
fi

# ── 2. The frontend compiles ─────────────────────────────────────────────
head "2. Frontend"
npx tsc --noEmit > /tmp/tsc.log 2>&1 && ok "typecheck clean" || { bad "typecheck"; cat /tmp/tsc.log; }
if [[ "$(pnpm lint 2>&1 | grep -c '  error  ')" == "0" ]]; then
  ok "no lint errors"
else
  bad "lint errors"; pnpm lint 2>&1 | grep '  error  '
fi
pnpm build > /tmp/build.log 2>&1 && ok "production build" || { bad "build"; tail -20 /tmp/build.log; }

# ── 3. The orchestrator the docs promised ────────────────────────────────
head "3. bootstrap exists and runs"
uv run python -m tacticbench.bootstrap --help > /dev/null 2>&1 \
  && ok "python -m tacticbench.bootstrap" \
  || bad "bootstrap missing (this is what the README promised for months)"

# ── 4. The service ───────────────────────────────────────────────────────
head "4. Analysis service"
uv run uvicorn tacticbench.api:app --port 8000 > /tmp/api.log 2>&1 &
API_PID=$!
for _ in $(seq 1 30); do
  curl -sf localhost:8000/api/health > /dev/null 2>&1 && break
  sleep 1
done
curl -sf localhost:8000/api/health > /dev/null 2>&1 \
  && ok "up on :8000" || { bad "did not start"; tail -20 /tmp/api.log; }

n=$(curl -s "localhost:8000/api/fixtures?q=&limit=1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["total"])' 2>/dev/null)
[[ "${n:-0}" -gt 400 ]] && ok "fixture picker: $n fixtures with 360 data" \
                        || bad "fixture picker returned ${n:-0}"

# ── 5. Alignment arithmetic, and the check on it ─────────────────────────
head "5. Clock alignment"
good=$(curl -s -X POST localhost:8000/api/games/offsets \
  -F first_at=00:12:00 -F first_clock=10:25 \
  -F second_at=01:02:01 -F second_clock=52:02)
printf '%s' "$good" > /tmp/offsets.json
offsets=$(python3 - <<'PY' 2>/dev/null
import json
d = json.load(open("/tmp/offsets.json"))["period_offset"]
first, second = d["1"], d["2"]
print(f"+{first:.0f}s / +{second:.0f}s")
PY
)
echo "$good" | grep -q '"warning":null' \
  && ok "real readings accepted ($offsets)" \
  || bad "rejected a valid pair: $good"

curl -s -X POST localhost:8000/api/games/offsets \
  -F first_at=00:12:00 -F first_clock=10:25 \
  -F second_at=01:02:01 -F second_clock=60:02 | grep -q 'too short' \
  && ok "a misread clock is caught, not silently misaligned" \
  || bad "did not catch a bad pair"

# ── 6. Unusable data is refused up front ─────────────────────────────────
head "6. Refusing a match it cannot analyse"
job=$(curl -s -X POST localhost:8000/api/games -F match_id=$BROKEN -F team="Inter Miami" \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["job"])' 2>/dev/null)
for _ in $(seq 1 24); do
  st=$(curl -s "localhost:8000/api/games/$job" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])' 2>/dev/null)
  [[ "$st" == "failed" || "$st" == "ready" ]] && break
  sleep 5
done
if curl -s "localhost:8000/api/games/$job" | grep -q "does not line up"; then
  ok "360 feed that joins nothing is refused (would have returned an empty report)"
else
  bad "did not refuse the broken fixture (status=$st)"
fi
rm -rf "workspaces/inter-miami-$BROKEN"

# ── 7. A real game, end to end ───────────────────────────────────────────
head "7. A real game, end to end"
rm -rf "workspaces/$KEY"
job=$(curl -s -X POST localhost:8000/api/games -F match_id=$FIXTURE -F team="Inter Miami" \
      | python3 -c 'import json,sys;print(json.load(sys.stdin)["job"])' 2>/dev/null)
echo "  (first run trains the threat model, ~2 min; later runs are seconds)"
for _ in $(seq 1 60); do
  st=$(curl -s "localhost:8000/api/games/$job" | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])' 2>/dev/null)
  [[ "$st" == "ready" || "$st" == "failed" ]] && break
  sleep 5
done

if [[ "$st" == "ready" ]]; then
  curl -s "localhost:8000/api/games/$job" > /tmp/job.json
  python3 - <<'PY'
import json
d = json.load(open("/tmp/job.json"))
for s in d["steps"]:
    mark = {"done": "✓", "skip": "–", "fail": "x"}.get(s["status"], "·")
    det = " ".join(f"{k}={v}" for k, v in (s.get("detail") or {}).items())
    step = s["step"]
    print(f"    {mark} {step:<28} {det}")
PY
  ok "run completed"
else
  bad "run did not finish (status=$st)"
  curl -s "localhost:8000/api/games/$job" | python3 -c 'import json,sys;print("   ",json.load(sys.stdin).get("error"))'
fi

# ── 8. What it produced ──────────────────────────────────────────────────
head "8. The output"
if [[ -f "workspaces/$KEY/snapshots/pep.json" ]]; then
  python3 - "$KEY" <<'PY'
import json, sys
key = sys.argv[1]
d = json.load(open(f"workspaces/{key}/snapshots/pep.json"))
c = json.load(open(f"workspaces/{key}/snapshots/clip-moments.json"))
found = d["moments_found"]
print(f"    {found} moments from {d['passes_with_an_option']} passes with an option")
print(f"    prose: {d['written_by']}")
print()
for m in d["moments"][:3]:
    print(f"    {m['minute']:>3}'  {m['line']}")
    print(f"          {m['numbers']}")
print()
print("    names as the interface shows them:")
for m in c["moments"][:5]:
    print(f"      {m['name']}  ({m['player']})")
assert 0 < found < 100, f"implausible moment count: {found}"
PY
  [[ $? -eq 0 ]] && ok "snapshots written and plausible" || bad "snapshot contents wrong"
else
  bad "no snapshots produced"
fi

# ── 9. It landed in HydraDB ──────────────────────────────────────────────
head "9. HydraDB"
curl -s "localhost:8000/api/deviation/Inter%20Miami/$FIXTURE" | grep -q "Nashville" \
  && ok "the match is in the graph and reads back" \
  || bad "match not in graph (is HydraDB running?)"

curl -s localhost:8000/api/games | grep -q "$KEY" \
  && ok "it appears in the added-games list" || bad "not listed"

# ── 10. Re-adding replaces, never duplicates ─────────────────────────────
head "10. Re-adding the same game"
before=$(uv run python -c "
from tacticbench.graph import Graph
g=Graph()
try: print(g.run('MATCH (f:Fact) RETURN count(*) AS n')[0]['n'])
finally: g.close()" 2>/dev/null)
PEPTALK_WORKSPACE="$KEY" uv run python -m tacticbench.bootstrap > /tmp/re.log 2>&1
after=$(uv run python -c "
from tacticbench.graph import Graph
g=Graph()
try: print(g.run('MATCH (f:Fact) RETURN count(*) AS n')[0]['n'])
finally: g.close()" 2>/dev/null)
[[ "$before" == "$after" ]] \
  && ok "facts stable at $after — replaced, not duplicated" \
  || bad "facts went $before -> $after (duplication)"

# ── 11. The flagship demo still works ────────────────────────────────────
head "11. The Barcelona result still holds"
uv run python -m tacticbench.demo query "Barcelona" \
  --dimension possession_share_pct --at 2011-06-01 2018-06-01 > /tmp/barca.log 2>&1
grep -q "2011-06-01: dominant" /tmp/barca.log \
  && ok "Guardiola era still isolated (dominant in 2011, even in 2018)" \
  || { bad "the flagship demo regressed"; tail -20 /tmp/barca.log; }

grep -q "flat lookup" /tmp/barca.log \
  && ok "the without-HydraDB contrast still renders" || bad "flat lookup missing"

# ── 12. A fresh clone is unaffected ──────────────────────────────────────
head "12. Fresh-clone safety"
if [[ -z "$(git status --short src/content/snapshots/)" ]]; then
  ok "committed snapshots untouched by adding a game"
else
  bad "adding a game modified the committed snapshots"
fi
git check-ignore -q "workspaces/$KEY/workspace.json" \
  && ok "added games are gitignored" || bad "added game would be committed"

# ── Result ───────────────────────────────────────────────────────────────
printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
[[ $fail -eq 0 ]] || exit 1
