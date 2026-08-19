# Notice: data and third-party terms

`LICENSE` is plain MIT and covers **the source code in this repository only**.
It is kept free of additions so that automated licence detection reads it as
MIT rather than as a custom licence, which is what pulled this note out into
its own file.

The data the code operates on is not ours to relicense, and the terms below are
stricter than MIT in ways that matter.

## NOTE ON DATA

This licence covers the source code in this repository only. It does not cover
the football data the code operates on.

Match data is StatsBomb Open Data, governed by the StatsBomb Public Data User
Agreement (https://github.com/statsbomb/open-data), not by an OSI licence. That
agreement permits analysis and research and permits conclusions to be shared
publicly, but prohibits redistributing the data and prohibits commercial
exploitation of the data or of any analysis derived from it.

No StatsBomb data is committed to this repository. The code downloads it at
runtime and caches it locally under paths that are gitignored.

## Broadcast footage

Match video is not ours to redistribute. `public/clips/`, `public/tape/`,
`public/calib/` and `.cache/clips` are gitignored, and no frame of broadcast
footage is committed. The clips are cut locally from a source the operator
supplies.

## Player photographs

12 photographs from Wikimedia Commons, each CC BY-SA or CC BY, with the
photographer and licence recorded per file in `public/players/CREDITS.md`.

## Third-party code and models

| Used | For | Licence |
|---|---|---|
| HydraDB | the memory graph | open source, per its own repository |
| Ultralytics YOLO11m | finding players in a frame | AGPL-3.0 |
| Roboflow `football-field-detection-f07vi/15` | pitch keypoints | per Roboflow Universe terms |
| Next.js, React, Tailwind, Motion | the interface | MIT |
| neo4j Python driver | Bolt transport to HydraDB | Apache-2.0 |
| scikit-learn, NumPy, OpenCV | the models and vision | BSD-3-Clause / Apache-2.0 |

YOLO11m is AGPL-3.0. It is invoked as a separate process over files rather
than linked into this code, and no modified version of it is distributed here.
Anyone shipping this commercially should read Ultralytics' terms rather than
take that as advice.
