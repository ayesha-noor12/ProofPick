"""Scores product checks against hand-labeled outcomes and an ordinary catalog filter.

Run from backend/: .venv/bin/python -m eval.run_eval
M = meets, C = conflict, I = insufficient evidence.
"""

import json
from pathlib import Path

from app.catalog import Catalog
from app.config import get_settings
from app.product_verifier import _NECK_PATTERNS, _SLEEVE_PATTERNS, extract_attribute, verify_product
from app.requirements_parser import parse_with_rules
from app.schemas import Product, ProductStatus, Requirements

HERE = Path(__file__).parent
REAL_CASES = HERE / "real_cases.json"
SHORT = {ProductStatus.MEETS: "M", ProductStatus.CONFLICT: "C", ProductStatus.INSUFFICIENT: "I"}


def baseline_filter(product: Product, req: Requirements) -> str:
    """An ordinary filter: it can only pass or reject, and a missing value passes."""
    if req.max_price_usd is not None and product.price > req.max_price_usd:
        return "C"
    composition = " ".join(e.quote or "" for e in product.evidence_for("composition")).lower()
    if any(m.lower() in composition for m in req.excluded_materials):
        return "C"
    for field, wanted, patterns in (("sleeves", req.sleeves, _SLEEVE_PATTERNS), ("neckline", req.neckline, _NECK_PATTERNS)):
        for e in product.evidence_for(field):
            value = extract_attribute(e.quote or "", patterns)
            if wanted and value and value != wanted:
                return "C"
    return "M"


def main() -> None:
    settings = get_settings()
    catalog = Catalog.load(settings.catalog_path, settings.catalog_images_dir)
    cases = json.loads((HERE / "cases.json").read_text())
    stats = {"proofpick": [0, 0], "baseline": [0, 0]}
    parser_ok = 0
    no_eligible_ok = no_eligible_total = 0
    lines = ["| Case | Parser | ProofPick correct | Baseline correct | Baseline unsupported passes |", "|---|---|---|---|---|"]
    misses = []
    for case in cases:
        req = Requirements.model_validate(case["requirements"])
        parsed = parse_with_rules(case["text"])
        parser_match = parsed == req
        parser_ok += parser_match
        if not parser_match:
            misses.append(f"parser {case['id']}: got {parsed.model_dump(exclude_defaults=True)}")
        pp = bl = unsupported = 0
        for pid, label in case["labels"].items():
            product = catalog.get(pid)
            ours = SHORT[verify_product(product, req).status]
            theirs = baseline_filter(product, req)
            pp += ours == label
            bl += theirs == label
            unsupported += theirs == "M" and label != "M"
            if ours != label:
                misses.append(f"verifier {case['id']} {pid}: expected {label}, got {ours}")
        total = len(case["labels"])
        stats["proofpick"][0] += pp
        stats["baseline"][0] += bl
        stats["proofpick"][1] += total
        stats["baseline"][1] += total
        if case.get("expect_no_eligible"):
            no_eligible_total += 1
            no_eligible_ok += not any(verify_product(p, req).status == ProductStatus.MEETS for p in catalog.products)
        lines.append(f"| {case['id']} | {'match' if parser_match else 'differs'} | {pp}/{total} | {bl}/{total} | {unsupported} |")
    lines += ["", f"Parser (rules mode) exact matches: {parser_ok}/{len(cases)}",
              f"ProofPick labeled outcomes correct: {stats['proofpick'][0]}/{stats['proofpick'][1]}",
              f"Baseline labeled outcomes correct: {stats['baseline'][0]}/{stats['baseline'][1]}",
              f"Impossible requests with no eligible product: {no_eligible_ok}/{no_eligible_total}"]
    lines += ["", "Misses:"] + (misses or ["none"])
    report = "\n".join(lines)
    real = real_garment_report(settings)
    print(report + real)
    (HERE / "results.md").write_text(
        "# Product-check evaluation\n\nLabels are hand-written against the fictional demo catalog in `cases.json`. "
        "This set is small and was written by the builders of the rules, so it shows the logic behaves as specified, not real-world accuracy.\n\n"
        + report + "\n" + real)


def real_garment_report(settings) -> str:
    """Scores real_cases.json, whose labels are the physical truth of garments the team photographed.

    Labels name garments as they appear on the Catalog page. Because the truth comes from the garment itself,
    a wrong owner entry or an unreadable care label shows up here as a failure rather than being hidden.
    """
    if not REAL_CASES.exists():
        return "\n## Real garments\n\nNot run: add eval/real_cases.json (see real_cases.example.json).\n"
    catalog = Catalog.load(settings.catalog_path, settings.catalog_images_dir, settings.real_catalog_path, settings.real_images_dir,
                           settings.real_listings_path)
    by_name = {p.name.lower(): p for p in catalog.real}
    lines = ["", "## Real garments", "", "| Case | Garment | Expected | ProofPick | Why |", "|---|---|---|---|---|"]
    right = total = 0
    for case in json.loads(REAL_CASES.read_text()):
        req = Requirements.model_validate(case["requirements"])
        for name, label in case["labels"].items():
            product = by_name.get(name.lower())
            if product is None:
                lines.append(f"| {case['id']} | {name} | {label} | missing | Garment not in the catalog |")
                continue
            result = verify_product(product, req)
            ours = SHORT[result.status]
            total += 1
            right += ours == label
            why = "; ".join(c.explanation for c in result.checks if c.status != ProductStatus.MEETS) or "All checks supported"
            lines.append(f"| {case['id']} | {name} | {label} | {ours}{'' if ours == label else ' ✗'} | {why} |")
    lines += ["", f"Correct: {right}/{total}. Every ✗ is a real failure and is listed, not removed.", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    main()
