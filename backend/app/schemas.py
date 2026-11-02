"""Shared records. Evidence is kept separate from the conclusions drawn from it."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Sleeve = Literal["long", "three_quarter", "short", "sleeveless"]
Neckline = Literal["high", "crew", "v_neck", "scoop", "boat", "collared"]


class ProductStatus(StrEnum):
    MEETS = "meets_documented_requirements"
    CONFLICT = "conflicts_with_requirement"
    INSUFFICIENT = "insufficient_evidence"


class PreviewStatus(StrEnum):
    NO_MISMATCH = "no_visible_mismatch_detected"
    POSSIBLE_MISMATCH = "possible_mismatch"
    NOT_ASSESSABLE = "not_assessable"


class Method(StrEnum):
    PRICE_RULE = "price_comparison"
    MATERIAL_RULE = "material_rule"
    SOURCE_TEXT = "source_text_rule"
    VISUAL = "visual_assessment"
    LOOKUP = "exact_lookup"


class Requirements(BaseModel):
    """Non-negotiable fields are constraints; `preferences` may only affect ranking."""

    product: Literal["top"] = "top"
    max_price_usd: float | None = Field(default=None, ge=0)
    price_inclusive: bool = False
    sleeves: Sleeve | None = None
    neckline: Neckline | None = None
    excluded_materials: list[str] = Field(default_factory=list)
    preferences: list[str] = Field(default_factory=list)
    preferred_colors: list[str] = Field(default_factory=list)
    # When true, preferred_colors becomes a must-have: the listed color must be in one of those color families.
    colors_required: bool = False


class ParsedRequirements(BaseModel):
    requirements: Requirements
    parser: Literal["model", "rules"]
    notes: list[str] = Field(default_factory=list)


SourceType = Literal["listing_text", "care_label_photo", "size_chart", "seller_title", "owner_inspection", "demo"]
SOURCE_LABELS = {
    "listing_text": "listing text", "care_label_photo": "care-label photo", "size_chart": "size chart",
    "seller_title": "seller title", "owner_inspection": "owner inspection", "demo": "demo data",
}


class Evidence(BaseModel):
    """One documented fact. `quote` is the snippet: a short paraphrase or transcription, never a long copy."""

    id: str
    product_id: str
    field: Literal["price", "composition", "sleeves", "neckline", "availability", "image", "color"]
    kind: Literal["text", "image"] = "text"
    source: str
    source_type: SourceType = "demo"
    source_url: str | None = None
    quote: str | None = Field(default=None, max_length=140)
    image: str | None = None
    collected_at: str
    is_generated: bool = False


class Product(BaseModel):
    id: str
    name: str
    brand: str
    variant: str
    color: str
    price: float
    currency: str
    description: str
    tags: list[str] = Field(default_factory=list)
    image: str
    source_url: str | None = None
    collected_at: str
    data_label: str
    retailer_name: str | None = None
    # The exact listing page. Required for real listings; demo products and the team's own garments have none.
    product_url: str | None = None
    image_rights: Literal["own_photo", "permitted", "demo_illustration"]
    is_demo: bool = False
    # A garment the team owns and photographed, rather than a retailer listing.
    is_owned: bool = False
    evidence: list[Evidence]

    def evidence_for(self, field: str) -> list[Evidence]:
        return [e for e in self.evidence if e.field == field]


class Check(BaseModel):
    product_id: str
    requirement: str
    status: ProductStatus
    observed: str
    evidence_ids: list[str] = Field(default_factory=list)
    method: Method
    action: Literal["keep", "exclude", "seek_or_disclose"]
    explanation: str
    # One line naming the source and collection date, e.g. 'Composition documented as "65% cotton…" in listing text, collected 2026-11-01.'
    reason: str = ""


class ProductResult(BaseModel):
    product_id: str
    status: ProductStatus
    checks: list[Check]


class RankedProduct(BaseModel):
    product_id: str
    explanation: str
    evidence_ids: list[str] = Field(default_factory=list)


class Ranking(BaseModel):
    items: list[RankedProduct]
    method: Literal["model", "rules"]


_LEGACY_STATUS = {"altered": ("possible_difference", None), "hidden": ("not_assessable", "hidden_by_pose_or_cropping"),
                  "unclear": ("not_assessable", "image_too_unclear")}


class FeatureObservation(BaseModel):
    """One visible observation about the garment in a try-on. Not a guarantee, and never a score."""

    feature: Literal["neckline", "sleeves", "color", "silhouette", "details"]
    status: Literal["consistent", "possible_difference", "not_assessable"]
    # Required when not_assessable, so the shopper always learns why.
    why_not_assessable: Literal["hidden_by_pose_or_cropping", "image_too_unclear", "not_visible_in_original"] | None = None
    observation: str

    @model_validator(mode="before")
    @classmethod
    def _upgrade_legacy(cls, data):
        """Inspections saved before the three-status scheme still load."""
        if isinstance(data, dict):
            data = dict(data)
            if data.get("feature") == "pattern":
                data["feature"] = "details"
            if data.get("status") in _LEGACY_STATUS:
                data["status"], reason = _LEGACY_STATUS[data["status"]]
                data.setdefault("why_not_assessable", reason)
        return data


class PreviewInspection(BaseModel):
    status: PreviewStatus
    features: list[FeatureObservation] = Field(default_factory=list)
    summary: str
    method: Literal["model", "unavailable"] = "model"


class PhotoOut(BaseModel):
    photo_id: str
    width: int
    height: int
    is_sample: bool = False


class RecommendationRequest(BaseModel):
    original_text: str = Field(default="", max_length=2000)
    requirements: Requirements
    photo_id: str | None = None
    # Which products to search: everything, only the team's photographed garments, or only the demo catalog.
    scope: Literal["all", "real", "demo"] = "all"


class ParseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class RetryRequest(BaseModel):
    product_id: str
