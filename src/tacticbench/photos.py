"""Player photographs, from Wikimedia Commons, with their licences.

A roster card wants a face. There is no honest way to take one off a general
image search: Getty, AP and Reuters own most football photography, and it would
be strange to be careful about the StatsBomb terms and the SoccerNet NDA and
then commit scraped press photos to a public repository.

Wikimedia Commons is different. Everything on it is freely licensed — CC BY,
CC BY-SA, or public domain — which is why Wikipedia can use it. The licence and
the photographer come back with the file and are written next to it, because
CC BY-SA without attribution is just infringement with extra steps.

**This does not generalise, and the interface must not pretend it does.** Every
player in a World Cup squad has a Commons photo. A fourth-division right back
has none, and that is the coach this product is actually for. So a missing
photo is a first-class outcome here, not an error: the card falls back to the
shirt number, and the path that works for anybody is a crop from their own
footage.

Attribution for whatever this fetches ends up in `players/CREDITS.md`, and the
card carries the photographer's name.
"""

from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
from pathlib import Path

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]

WIKI = "https://en.wikipedia.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"

# Wikimedia asks for a descriptive agent with a contact, and rate-limits
# anything that looks anonymous. Being a good citizen here is also the only way
# this finishes without a 429.
AGENT = "PepTalk/0.1 (hackathon project; https://github.com/SankrityaT/PepTalk)"
PAUSE = 1.2
TRIES = 3

#: Commons serves originals at up to 5MB. Ten of those is 24MB of repository
#: and deploy for images that render at 96px. The long side is capped instead
#: and the browser frames the result, which keeps the crop a styling decision
#: rather than one baked into a file.
LONG_SIDE = 640

#: Licences that may be redistributed with attribution. Anything outside this
#: set is skipped rather than guessed at — a "fair use" file on Wikipedia is
#: exactly the sort of thing that must not end up in a public deploy.
FREE = re.compile(r"\b(cc[ -]?by|cc[ -]?zero|cc0|public domain|pd[ -])", re.I)


def clean(html: str) -> str:
    """Commons returns the photographer as a fragment of HTML."""
    text = re.sub(r"<[^>]+>", "", html or "")
    return unicodedata.normalize("NFKC", text).strip()


def get(client: httpx.Client, url: str, **params) -> dict:
    """A Wikimedia call, retried.

    The first version swallowed every exception into "no free photo", so a
    rate-limited request during a batch was indistinguishable from a player who
    genuinely has no picture. Two of twelve were reported as having none when
    both are CC BY-SA; the difference matters, because one is a fact about
    football data and the other is a bug.
    """
    last: Exception | None = None
    for attempt in range(TRIES):
        try:
            r = client.get(url, params={**params, "format": "json"})
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001 - retried below, re-raised after
            last = exc
            time.sleep(PAUSE * (attempt + 2))
    raise last  # type: ignore[misc]


def shrink(blob: bytes, path: Path) -> int:
    """Cap the long side and re-encode. Returns the bytes written."""
    from io import BytesIO

    img = Image.open(BytesIO(blob))
    img = img.convert("RGB")
    if max(img.size) > LONG_SIDE:
        img.thumbnail((LONG_SIDE, LONG_SIDE), Image.LANCZOS)
    img.save(path, "JPEG", quality=82, optimize=True, progressive=True)
    return path.stat().st_size


def lead_image(client: httpx.Client, title: str) -> str | None:
    """The photo at the top of someone's article, at full resolution."""
    pages = get(
        client, WIKI, action="query", titles=title, prop="pageimages",
        piprop="original", redirects="1",
    )["query"]["pages"]
    page = next(iter(pages.values()))
    original = page.get("original")
    return original["source"] if original else None


def licence_of(client: httpx.Client, filename: str) -> dict | None:
    """Licence, photographer and description page for a Commons file."""
    pages = get(
        client, COMMONS, action="query", titles=f"File:{filename}",
        prop="imageinfo", iiprop="extmetadata|url",
    )["query"]["pages"]
    page = next(iter(pages.values()))
    info = (page.get("imageinfo") or [{}])[0]
    meta = info.get("extmetadata") or {}
    if not meta:
        return None
    return {
        "licence": clean(meta.get("LicenseShortName", {}).get("value", "")),
        "author": clean(meta.get("Artist", {}).get("value", "")),
        "page": info.get("descriptionurl"),
        "file": filename,
    }


def fetch_one(client: httpx.Client, name: str, out_dir: Path, key: str) -> dict | None:
    """One player, or None if they have no article, no photo, or no free licence.

    A network failure raises rather than returning None, so the caller can tell
    "this player has no picture" apart from "Wikimedia would not talk to us".
    """
    url = lead_image(client, name)
    if not url:
        return None

    filename = httpx.URL(url).path.rsplit("/", 1)[-1]
    from urllib.parse import unquote

    time.sleep(PAUSE)
    lic = licence_of(client, unquote(filename))
    if not lic or not FREE.search(lic["licence"]):
        # Better a shirt number than a licence we cannot honour.
        return None

    if Path(filename).suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
        return None

    time.sleep(PAUSE)
    blob = client.get(url).raise_for_status().content

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{key}.jpg"
    return {**lic, "player": name, "key": key, "path": path.name, "bytes": shrink(blob, path)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--roster", type=Path, default=ROOT / "src" / "content" / "snapshots" / "roster.json")
    ap.add_argument("--out", type=Path, default=ROOT / "public" / "players")
    args = ap.parse_args()

    roster = json.loads(args.roster.read_text())
    players = roster["players"]

    found: list[dict] = []
    failed: list[str] = []
    with httpx.Client(timeout=60, headers={"User-Agent": AGENT}, follow_redirects=True) as client:
        for p in players:
            # The nickname is the name an encyclopaedia files them under.
            for title in filter(None, [p.get("nickname"), p["name"]]):
                try:
                    got = fetch_one(client, title, args.out, p["key"])
                except Exception as exc:  # noqa: BLE001 - reported, not hidden
                    print(f"  {p['short']:<16} FAILED  {type(exc).__name__}")
                    failed.append(p["short"])
                    break
                if got:
                    found.append(got)
                    print(
                        f"  {p['short']:<16} {got['licence']:<14} "
                        f"{got['bytes'] // 1024:>4}kB  {got['author'][:30]}"
                    )
                    break
                time.sleep(PAUSE)
            else:
                print(f"  {p['short']:<16} no free photo")

    index = {g["key"]: {k: g[k] for k in ("path", "licence", "author", "page")} for g in found}
    (args.out / "index.json").write_text(json.dumps(index, indent=2) + "\n")

    credits = ["# Player photographs", "", "Every file here is from Wikimedia Commons under a free licence.", ""]
    for g in sorted(found, key=lambda g: g["player"]):
        credits.append(f"- **{g['player']}** — {g['author']}, {g['licence']}. [source]({g['page']})")
    credits.append("")
    credits.append(
        "Players without an entry have no freely licensed photograph, which is "
        "the normal case outside elite football and the reason the card falls "
        "back to a shirt number."
    )
    (args.out / "CREDITS.md").write_text("\n".join(credits) + "\n")

    print(f"\n{len(found)} of {len(players)} players have a free photo")
    if failed:
        print(f"{len(failed)} could not be checked and are not a verdict: {', '.join(failed)}")
    print(f"wrote {args.out}/index.json and CREDITS.md")


if __name__ == "__main__":
    main()
