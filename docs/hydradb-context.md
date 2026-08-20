# HydraDB: build context for Hack Hydra

Source: `github.com/hydra-db/hydradb` (cloned + read Aug 15 2026), `docs.hydradb.com`.

## What it is

Object-store-native distributed graph database in Rust. Durable storage on
SlateDB over S3-compatible object storage. Snapshot-consistent OpenCypher
queries, GraphBLAS traversal, **Neo4j-compatible Bolt 5.x**, plus an HTTPS
JSON/NDJSON API. License **AGPL-3.0**.

Storage and compute are disaggregated: `graph-node` serves queries and
mutations, `graph-indexer` builds immutable traversal indexes in the background.

> Note: `docs.hydradb.com` describes a *managed* product (sign up at
> app.hydradb.com, `"knowledge" | "memory" | "all"` selector). The hackathon says
> build with the **open-source repo**. Ask in Discord whether the managed API
> counts; assume the OSS engine is what's judged.

## Connecting, use the Neo4j driver

Bolt compatibility means no custom client:

```python
from neo4j import GraphDatabase
driver = GraphDatabase.driver("bolt://127.0.0.1:7687", auth=("neo4j", TOKEN))
with driver.session() as s:
    s.run("MATCH (t:Team {id: $id}) RETURN t.name", id=7)
```

The repo's own `scripts/bolt_graphblas_client.py` uses exactly this.

## Running locally (Docker)

Ports: **7687** Bolt, **8443** HTTPS API, **9090** metrics.

```bash
mkdir -p hydradb-data/store
docker run --rm --user "$(id -u):$(id -g)" \
  -p 7687:7687 -p 8443:8443 -p 9090:9090 \
  -v "$PWD/hydradb-data:/data" \
  -e CLOUD_PROVIDER=local -e LOCAL_PATH=/data/store \
  -e GRAPH_NAMESPACE=default -e GRAPH_ID=default \
  -e GRAPH_CELL_ID=cell-0 -e GRAPH_CELLS=cell-0 -e GRAPH_NODE_ID=node-0 \
  -e GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687 \
  -e GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687 \
  -e GRAPH_DATA_CACHE_DIR=/data/cache \
  -e GRAPH_AUTH_TOKEN_FILE=/data/auth-token \
  -e GRAPH_ALLOW_PLAINTEXT=true -e RUST_MIN_STACK=33554432 \
  ghcr.io/hydra-db/hydradb:latest
```

`LOCAL_PATH` must already exist. `--user` is required, the image runs as UID
10001 and cannot write a host-owned bind mount otherwise. Apple Silicon is fine
on releases after 0.1.0.

## Cypher subset, the gotchas that shape the schema

Supported: `MATCH`, `OPTIONAL MATCH` (reads only), `WHERE`, `RETURN`, `CREATE`,
`MERGE`, `SET`, `REMOVE`, `DELETE`, `UNWIND`, `UNION`, `CALL algo.*`.

**Constraints that actually bite:**

| Limitation | Consequence |
|---|---|
| **`IS NULL` unsupported** | Cannot model "still true" as a null `valid_to`. **Use a numeric sentinel.** |
| **`IN` unsupported** | No `WHERE id IN [...]`. Use `UNWIND` over a parameter list. |
| `CONTAINS` / `ENDS WITH` unsupported | Only `STARTS WITH` for strings. |
| `WITH` is pass-through only | No aliases, no filtering. **No multi-stage query pipelines**, do that in app code. |
| Var-length paths need explicit max | `*1..3` fine; `*` and `*1..` rejected. |
| Patterns are directed, one rel type each | Undirected rejected. Model both directions explicitly if needed. |
| `MERGE` matches on `id` only | No `ON CREATE` / `ON MATCH`. |
| One statement per request | No semicolon-chained scripts. |
| `RETURN *`, `count(DISTINCT …)` unsupported | Name every projection. |

Comparison operators available: `=`, `<>`, `<`, `>`, `<=`, `>=`, `STARTS WITH`.
Aggregates: `count`, `sum`, `avg`, `collect`.

**Native path procedures** (the graph-native showpiece):

```cypher
CALL algo.SPpaths({sourceNode: $source, targetNode: $target,
                   relTypes: ['SUPERSEDED_BY'], maxLen: 5,
                   relDirection: 'outgoing', pathCount: 10})
  YIELD path, pathWeight, pathCost RETURN path, pathWeight, pathCost
```

Config keys: `sourceNode`, `targetNode`, `sourceLabel`, `sourceProperty`,
`sourceValues`, `targetLabel`, `targetProperty`, `targetValues`, `relTypes`,
`relDirection`, `maxLen`, `pathCount`, plus weight/cost properties.

**Batch writes** use `UNWIND` over a parameter holding a list of maps (not an
inline list); every row must carry every field the statement reads.

## Proposed schema, temporal tactical memory

```
(:Team   {id, name})
(:Match  {id, date_ord, competition})
(:Fact   {id, dimension, value, valid_from, valid_to, observations})
```

| Edge | Meaning |
|---|---|
| `(Team)-[:PLAYED]->(Match)` | appearance |
| `(Team)-[:HAS_FACT]->(Fact)` | tactical identity claim |
| `(Fact)-[:OBSERVED_IN]->(Match)` | evidence |
| `(Fact)-[:SUPERSEDED_BY]->(Fact)` | **the overwrite chain** |

`SUPERSEDED_BY` is the thing a vector store structurally cannot represent, and
it is traversable with `*1..N` or `algo.SSpaths`. That chain is the "Best Use of
HydraDB" argument in one edge type.

### Sentinel, not null

Because `IS NULL` is rejected, "still true" is `valid_to = 99999999`. All
temporal queries then use only supported operators:

```cypher
MATCH (t:Team {id: $team})-[:HAS_FACT]->(f:Fact)
WHERE f.dimension = $dim AND f.valid_from <= $at AND f.valid_to > $at
RETURN f.value, f.valid_from, f.valid_to, f.observations
```

Point-in-time query, same team, two different `$at` values, two different
scouting reports. That is the demo.

### Abstention as a first-class result

```cypher
MATCH (t:Team {id: $team})-[:HAS_FACT]->(f:Fact)
WHERE f.dimension = $dim
RETURN count(*) AS n
```

Below the evidence threshold the system returns *"insufficient history"* rather
than a guess. Track 03's stated hard part, answered by a graph query rather than
a prompt instruction.

## With / without toggle

The rules require saying what the project loses without HydraDB. Build it as a UI switch:

- **Without**, flat retrieval over the same facts, no validity intervals. Returns
  an average across eras, or the wrong-era answer, confidently.
- **With**, dated, superseded-aware answer, plus the traversal path as citation,
  plus abstention when evidence is thin.

Same question, two answers, side by side. That is the strongest 20 seconds of the
demo video.

## Submission checklist tie-ins

- Repo must be **public with an OSS license**; HydraDB itself is AGPL-3.0, but you
  connect over Bolt rather than linking, so pick your own license deliberately.
- No participant-authored commits before **Aug 12 2026** (this repo's first commit
  is Aug 15, clean).
- AI coding assistants are explicitly allowed; credit them in the README.
- Demo video **3 minutes max**, order: problem → project → demo → HydraDB.
