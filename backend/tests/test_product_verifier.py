import pytest

from app.catalog import Catalog
from app.config import get_settings
from app.product_verifier import parse_composition, verify_product
from app.schemas import ProductStatus as S
from app.schemas import ProductStatus
from app.schemas import Requirements

settings = get_settings()
catalog = Catalog.load(settings.catalog_path, settings.catalog_images_dir)
SPEC_REQ = Requirements(max_price_usd=60, sleeves="long", neckline="high", excluded_materials=["polyester"])


def result(pid, req=SPEC_REQ):
    return verify_product(catalog.get(pid), req)


def check(pid, name, req=SPEC_REQ):
    return next(c for c in result(pid, req).checks if c.requirement == name)


@pytest.mark.parametrize("pid,expected", [
    ("top_001", S.MEETS),         # complete composition
    ("top_002", S.MEETS),         # blend without polyester
    ("top_003", S.CONFLICT),      # 35% polyester
    ("top_004", S.MEETS),
    ("top_005", S.INSUFFICIENT),  # no composition at all
    ("top_006", S.MEETS),         # label is the only composition source
    ("top_007", S.INSUFFICIENT),  # "cotton blend" does not rule out polyester
    ("top_008", S.INSUFFICIENT),  # shell only, lining unknown
    ("top_009", S.INSUFFICIENT),  # composition and label disagree
    ("top_010", S.CONFLICT),      # exactly $60 with "under $60"
    ("top_011", S.CONFLICT),      # short sleeves, crew neck
    ("top_012", S.CONFLICT),      # v-neck
    ("top_013", S.CONFLICT),      # three-quarter sleeves
    ("top_014", S.CONFLICT),      # $88
    ("top_015", S.INSUFFICIENT),  # sleeves and neckline not in text
    ("top_016", S.CONFLICT),      # description lies; composition rules
])
def test_spec_request_outcomes(pid, expected):
    assert result(pid).status == expected


def test_price_boundary_respects_inclusive_flag():
    req = SPEC_REQ.model_copy(update={"price_inclusive": True})
    assert check("top_010", "budget", req).status == S.MEETS
    assert check("top_010", "budget").status == S.CONFLICT


def test_material_check_cites_evidence():
    c = check("top_003", "exclude_polyester")
    assert c.observed == "65% cotton, 35% polyester"
    assert c.evidence_ids == ["top_003_composition"]
    assert c.action == "exclude"


def test_polyamide_is_not_polyester():
    product = catalog.get("top_001").model_copy(deep=True)
    product.evidence_for("composition")[0].quote = "60% cotton, 40% polyamide"
    assert verify_product(product, Requirements(excluded_materials=["polyester"])).status == S.MEETS


def test_non_usd_price_is_not_converted():
    product = catalog.get("top_001").model_copy(update={"currency": "EUR"})
    assert verify_product(product, Requirements(max_price_usd=60)).checks[0].status == S.INSUFFICIENT


def test_incomplete_percentages_stay_unknown():
    product = catalog.get("top_001").model_copy(deep=True)
    product.evidence_for("composition")[0].quote = "60% cotton"
    assert verify_product(product, Requirements(excluded_materials=["polyester"])).status == S.INSUFFICIENT


def test_parse_composition():
    assert parse_composition("65% cotton, 35% polyester") == ({"cotton": 65, "polyester": 35}, True)


def test_required_colors_match_by_family_and_fix_typos():
    from app import colors
    assert colors.normalize("burgendi") == "burgundy" and colors.normalize("bottle greem") == "bottle green"
    assert colors.matches("bottle green", "forest") and colors.matches("burgundy", "wine red")
    assert not colors.matches("bottle green", "sage") and not colors.matches("burgundy", "dusty blue")


def test_only_burgundy_or_bottle_green_tops_pass_a_required_color():
    settings = get_settings()
    catalog = Catalog.load(settings.catalog_path, settings.catalog_images_dir)
    req = Requirements(preferred_colors=["burgendi", "bottle greem"], colors_required=True)
    passing = {p.color for p in catalog.products if verify_product(p, req).status == ProductStatus.MEETS}
    assert passing and passing <= {"burgundy", "forest"}
    blue = next(p for p in catalog.products if "blue" in p.color)
    check = next(c for c in verify_product(blue, req).checks if c.requirement == "color")
    assert check.status == ProductStatus.CONFLICT and "not burgundy, bottle green" in check.explanation


def test_liked_colors_alone_never_filter():
    settings = get_settings()
    catalog = Catalog.load(settings.catalog_path, settings.catalog_images_dir)
    req = Requirements(preferred_colors=["burgundy"])
    assert all(not any(c.requirement == "color" for c in verify_product(p, req).checks) for p in catalog.products)


def test_colors_found_in_text_tolerate_typos_without_false_positives():
    from app.colors import find_in_text
    assert find_in_text("a long-sleeve top in burgendi or bottle greem") == ["burgundy", "bottle green"]
    assert find_in_text("a formal top under $20 for casual days, no cotton") == []


def _listing(**evidence_quotes):
    """A non-demo listing whose only evidence is the given field -> quote pairs."""
    from app.schemas import Evidence, Product
    evidence = [Evidence(id=f"x_{f}", product_id="x", field=f, source="Retailer listing", source_type="listing_text",
                         source_url="https://example.com/p/1", quote=q, collected_at="2026-11-01") for f, q in evidence_quotes.items()]
    return Product(id="x", name="Listing", brand="B", variant="M", color="black", price=40, currency="USD", description="",
                   image="x.jpg", collected_at="2026-11-01", data_label="Real listing", retailer_name="Example",
                   product_url="https://example.com/p/1", image_rights="permitted", evidence=evidence)


def test_spec_a_missing_evidence_is_insufficient_never_conflict():
    result = verify_product(_listing(price="$40.00 USD"), Requirements(excluded_materials=["polyester"], sleeves="long"))
    assert {c.status for c in result.checks} == {S.INSUFFICIENT}
    assert all("not documented in any collected source" in c.reason for c in result.checks)


def test_spec_b_evidence_that_conflicts_with_a_requirement_is_a_conflict_with_its_source():
    result = verify_product(_listing(composition="100% polyester"), Requirements(excluded_materials=["polyester"]))
    check = result.checks[0]
    assert result.status == S.CONFLICT and check.evidence_ids == ["x_composition"]
    assert check.reason == 'Composition documented as "100% polyester" in listing text, collected 2026-11-01.'
