"""Fails when a real catalog entry is missing provenance or has an unusable image.

Run from backend/: .venv/bin/python -m scripts.validate_catalog [path ...]
With no paths it checks data/catalog_real.json (real listings) and data/real_garments.json (owned garments).
Entries marked TODO are reported and skipped, never loaded.
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

from PIL import Image
from pydantic import ValidationError

from app.catalog import is_placeholder
from app.config import get_settings
from app.schemas import Product

MAX_BYTES = 10 * 1024 * 1024
MIN_LONG, MIN_SHORT = 512, 384
URL = re.compile(r"^https?://[^\s/]+\.[^\s/]+")
NEEDS_URL = {"listing_text", "seller_title", "size_chart"}


def _iso(value: str) -> bool:
    try:
        date.fromisoformat(value)
        return True
    except (TypeError, ValueError):
        return False


def validate_entry(raw: dict, images_dir: Path) -> list[str]:
    """Problems with one catalog entry; an empty list means it is usable."""
    pid = raw.get("id", "<no id>")
    problems = []
    for key in ("image_rights", "collected_at"):
        if not raw.get(key):
            problems.append(f"{pid}: {key} is missing")
    try:
        product = Product.model_validate(raw)
    except ValidationError as exc:
        return problems + [f"{pid}: {e['loc']} {e['msg']}" for e in exc.errors()]
    if product.is_demo:
        return problems + [f"{pid}: demo products belong in catalog.json, not the real catalog"]
    if not product.is_owned and not URL.match(product.product_url or ""):
        problems.append(f"{pid}: product_url is missing or not an http(s) URL")
    if not _iso(product.collected_at):
        problems.append(f"{pid}: collected_at is not an ISO date")
    for e in product.evidence:
        if not _iso(e.collected_at):
            problems.append(f"{pid}: evidence {e.id} collected_at is not an ISO date")
        if e.source_type == "demo":
            problems.append(f"{pid}: evidence {e.id} has source_type demo in the real catalog")
        if e.source_type in NEEDS_URL and not URL.match(e.source_url or ""):
            problems.append(f"{pid}: evidence {e.id} ({e.source_type}) needs a source_url")
    path = images_dir / product.image
    if not path.exists():
        problems.append(f"{pid}: image {path.name} not found in {images_dir}")
    else:
        if path.stat().st_size > MAX_BYTES:
            problems.append(f"{pid}: image is larger than 10 MB")
        with Image.open(path) as im:
            if max(im.size) < MIN_LONG or min(im.size) < MIN_SHORT:
                problems.append(f"{pid}: image is {im.width}x{im.height}, smaller than {MIN_LONG}x{MIN_SHORT}")
    return problems


def validate_file(path: Path, images_dir: Path) -> tuple[int, int, list[str]]:
    """Returns (checked, placeholders skipped, problems)."""
    if not path.exists():
        return 0, 0, []
    entries = json.loads(path.read_text())
    real = [e for e in entries if not is_placeholder(e)]
    problems = [p for e in real for p in validate_entry(e, images_dir)]
    return len(real), len(entries) - len(real), problems


def main(argv: list[str]) -> int:
    settings = get_settings()
    paths = [Path(a) for a in argv] or [settings.real_listings_path, settings.real_catalog_path]
    failed = False
    for path in paths:
        checked, skipped, problems = validate_file(path, settings.real_images_dir)
        status = "FAIL" if problems else "ok"
        print(f"{path.name}: {checked} checked, {skipped} TODO placeholder(s) skipped -> {status}")
        for p in problems:
            print(f"  - {p}")
        failed |= bool(problems)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
