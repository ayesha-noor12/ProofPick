import asyncio
from pathlib import Path

from app.catalog import Catalog
from app.config import get_settings
from app.llm import ModelClient
from app.preview_inspector import _ModelInspection, derive_status, inspect_preview
from app.product_verifier import verify_product
from app.recommender import _ModelRanking, rank_candidates
from app.requirements_parser import drop_unstated, parse_requirements, parse_with_rules
from app.schemas import FeatureObservation, PreviewStatus, RankedProduct, Requirements

settings = get_settings()
catalog = Catalog.load(settings.catalog_path, settings.catalog_images_dir)
SPEC = "I need a long-sleeved, high-neck top under $60, without polyester. I prefer something suitable for work."
NO_MODEL = ModelClient("", "m")


class FakeModel:
    configured = True

    def __init__(self, output):
        self.output = output

    async def structured(self, system, content, schema, effort="medium"):
        return self.output


def obs(feature, status, why=None):
    return FeatureObservation(feature=feature, status=status, why_not_assessable=why, observation=f"{feature} {status}")


def test_rule_parser_reads_spec_request():
    req = parse_with_rules(SPEC)
    assert req.max_price_usd == 60 and req.price_inclusive is False
    assert req.sleeves == "long" and req.neckline == "high"
    assert req.excluded_materials == ["polyester"]
    assert req.preferences == ["work-appropriate"]


def test_rule_parser_adds_nothing_unstated():
    assert parse_with_rules("a nice top") == Requirements()


def test_parser_falls_back_and_says_so():
    parsed = asyncio.run(parse_requirements(SPEC, NO_MODEL))
    assert parsed.parser == "rules" and parsed.notes


def test_model_additions_are_removed():
    req, notes = drop_unstated("a work top", Requirements(max_price_usd=50, excluded_materials=["polyester"]))
    assert req.max_price_usd is None and req.excluded_materials == [] and len(notes) == 2


def _eligible():
    req = parse_with_rules(SPEC)
    products = [catalog.get("top_001"), catalog.get("top_002")]
    return products, {p.id: verify_product(p, req) for p in products}, req


def test_ranking_rejects_invented_evidence_and_products():
    products, results, req = _eligible()
    for bad in (
        [RankedProduct(product_id="top_999", explanation="x"), RankedProduct(product_id="top_001", explanation="x")],
        [RankedProduct(product_id="top_001", explanation="x", evidence_ids=["made_up"]), RankedProduct(product_id="top_002", explanation="x")],
        [RankedProduct(product_id="top_001", explanation="x", evidence_ids=["top_002_price"]), RankedProduct(product_id="top_002", explanation="x")],
    ):
        ranking = asyncio.run(rank_candidates(products, results, req, catalog, FakeModel(_ModelRanking(items=bad))))
        assert ranking.method == "rules"
        assert {i.product_id for i in ranking.items} == {"top_001", "top_002"}


def test_ranking_accepts_valid_order():
    products, results, req = _eligible()
    items = [RankedProduct(product_id="top_002", explanation="a", evidence_ids=["top_002_price"]),
             RankedProduct(product_id="top_001", explanation="b")]
    ranking = asyncio.run(rank_candidates(products, results, req, catalog, FakeModel(_ModelRanking(items=items))))
    assert ranking.method == "model" and ranking.items[0].product_id == "top_002"


def test_hidden_feature_is_not_a_mismatch():
    hidden = obs("sleeves", "not_assessable", "hidden_by_pose_or_cropping")
    assert derive_status([obs("neckline", "consistent"), hidden]) == PreviewStatus.NO_MISMATCH
    assert derive_status([obs("neckline", "not_assessable", "image_too_unclear"), hidden]) == PreviewStatus.NOT_ASSESSABLE
    assert derive_status([obs("details", "possible_difference"), obs("neckline", "consistent")]) == PreviewStatus.POSSIBLE_MISMATCH


def test_not_assessable_features_say_why_and_legacy_inspections_load():
    from app.preview_inspector import summarize
    text = summarize([obs("neckline", "consistent"), obs("sleeves", "not_assessable", "hidden_by_pose_or_cropping")])
    assert text == "Not assessable: sleeves hidden by pose or framing."
    legacy = FeatureObservation.model_validate({"feature": "pattern", "status": "hidden", "observation": "arm covers it"})
    assert (legacy.feature, legacy.status, legacy.why_not_assessable) == ("details", "not_assessable", "hidden_by_pose_or_cropping")


def test_inspection_without_model_is_not_assessable():
    image = Path(settings.catalog_images_dir) / "top_001.png"
    result = asyncio.run(inspect_preview(image, image, NO_MODEL))
    assert result.status == PreviewStatus.NOT_ASSESSABLE and result.method == "unavailable"


def test_inspection_uses_derived_status():
    image = Path(settings.catalog_images_dir) / "top_001.png"
    model = FakeModel(_ModelInspection(features=[obs("details", "possible_difference")]))
    assert asyncio.run(inspect_preview(image, image, model)).status == PreviewStatus.POSSIBLE_MISMATCH


def test_corrected_spelling_of_a_material_is_kept():
    req, notes = drop_unstated("a tee, no nylom please", Requirements(excluded_materials=["nylon"]))
    assert req.excluded_materials == ["nylon"] and notes == []


class _LabelModel:
    configured = True

    def __init__(self, legible=True, text="95% cotton, 5% elastane"):
        self.reply = {"legible": legible, "composition": text}

    async def structured(self, system, content, schema, effort="medium"):
        return schema.model_validate(self.reply)


def _label_png():
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (600, 400), (255, 255, 255)).save(buf, "PNG")
    return buf.getvalue()


def test_care_label_is_transcribed_but_never_saved_without_confirmation(tmp_path):
    from app.garments import build_garment, read_care_label
    composition, problem = asyncio.run(read_care_label(_label_png(), _LabelModel()))
    assert composition == "95% cotton, 5% elastane" and problem is None
    unconfirmed, notes = asyncio.run(build_garment(
        name="Rib Knit", price=30, color="black", sleeves="long", neckline="crew", description="", tags=[], composition_text="",
        garment_photo=_label_png(), label_photo=_label_png(), label_composition="", images_dir=tmp_path))
    assert not [e for e in unconfirmed.evidence if e.field == "composition"]
    assert any("not confirmed" in n for n in notes) and [f.name for f in tmp_path.iterdir()] == [unconfirmed.image]


def test_confirmed_care_label_becomes_evidence_that_the_rules_read(tmp_path):
    from app.garments import build_garment
    from app.product_verifier import verify_product
    product, notes = asyncio.run(build_garment(
        name="Rib Knit", price=30, color="black", sleeves="long", neckline="crew", description="", tags=[], composition_text="",
        garment_photo=_label_png(), label_photo=_label_png(), label_composition="96% cotton, 4% elastane", images_dir=tmp_path))
    label = [e for e in product.evidence if e.field == "composition"]
    assert notes == [] and label[0].source_type == "care_label_photo" and label[0].image and "confirmed" in label[0].source
    assert verify_product(product, Requirements(excluded_materials=["polyester"])).status == "meets_documented_requirements"
    assert verify_product(product, Requirements(excluded_materials=["elastane"])).status == "conflicts_with_requirement"


def test_illegible_care_label_is_not_guessed():
    from app.garments import read_care_label
    composition, problem = asyncio.run(read_care_label(_label_png(), _LabelModel(legible=False, text="")))
    assert composition is None and "not legible" in problem
