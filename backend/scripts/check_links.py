"""Checks every real listing URL once. Run from backend/: .venv/bin/python -m scripts.check_links

Prints the status per URL and flags anything that is not a 200 or that redirects to another domain.
It only reads response headers and status; it never stores page content.
"""

import sys
from urllib.parse import urlparse

import httpx

from app.catalog import load_products
from app.config import get_settings

HEADERS = {"User-Agent": "ProofPick-link-check/1.0 (hackathon demo; one request per listing)"}


def check(client: httpx.Client, url: str) -> tuple[str, bool]:
    try:
        response = client.head(url)
        if response.status_code in (403, 405, 501):
            response = client.get(url)
    except httpx.HTTPError as exc:
        return f"ERROR {type(exc).__name__}", True
    final = response.url
    moved = urlparse(url).netloc.lower().removeprefix("www.") != final.host.lower().removeprefix("www.")
    note = f"{response.status_code}" + (f" -> {final}" if str(final) != url else "")
    flag = response.status_code != 200 or moved
    if moved:
        note += "  [redirects to a different domain]"
    return note, flag


def main() -> int:
    settings = get_settings()
    listings = [p for p in load_products(settings.real_listings_path) if p.product_url]
    if not listings:
        print("No real listings with a product_url yet (TODO placeholders are skipped).")
        return 0
    flagged = 0
    with httpx.Client(timeout=10, follow_redirects=True, headers=HEADERS) as client:
        for p in listings:
            note, flag = check(client, p.product_url)
            flagged += flag
            print(f"{'FLAG' if flag else ' ok '} {p.id}: {p.product_url}  {note}")
    print(f"{len(listings)} checked, {flagged} flagged")
    return 1 if flagged else 0


if __name__ == "__main__":
    sys.exit(main())
