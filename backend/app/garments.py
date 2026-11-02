"""Turns a garment the team photographed into a catalog product whose every fact has a source.

The care-label photo is the composition source: the model only transcribes the printed
text, and the deterministic material rules then read that transcription like any other.
"""

import uuid
from datetime import date
from pathlib import Path

from pydantic import BaseModel

from .images import sanitize_photo
from google.genai import types

from .llm import ModelClient, ModelUnavailable
from .schemas import Evidence, Neckline, Product, Sleeve

REAL_LABEL = "Real garment photographed by the ProofPick team. Reference price, not for sale"
OWNER = "Owner inspection of the garment"
LABEL_SOURCE = "Care label photo"
SLEEVE_TEXT = {"long": "Long sleeves.", "three_quarter": "Three-quarter sleeves.", "short": "Short sleeves.", "sleeveless": "Sleeveless."}
NECK_TEXT = {"high": "High neck.", "crew": "Crew neck.", "v_neck": "V-neck.", "scoop": "Scoop neck.", "boat": "Boat neck.", "collared": "Collared."}

LABEL_SYSTEM = """You transcribe the fiber composition printed on a clothing care label.

Copy the percentages and fiber names exactly as printed, in English if the label has several languages, for example
"52% cotton, 48% modal" or "Shell: 100% wool; Lining: 100% polyester". Keep section words such as shell, body, lining or trim.
Do not add, round, translate loosely or guess a fiber. If no composition is legible, set legible to false and leave composition empty."""


class _Label(BaseModel):
    legible: bool
    composition: str


async def read_care_label(photo: bytes, model: ModelClient) -> tuple[str | None, str | None]:
    """Returns (composition, problem); exactly one is set. Nothing is saved: the team confirms or edits the text first."""
    data, _, _ = sanitize_photo(photo)
    try:
        part = types.Part.from_bytes(data=data, mime_type="image/jpeg")
        parsed = await model.structured(LABEL_SYSTEM, [part, "Transcribe the composition on this label."], _Label, effort="low")
    except ModelUnavailable as exc:
        return None, f"The care label could not be read automatically: {exc}"
    if not parsed.legible or "%" not in parsed.composition:
        return None, "The composition on the care label was not legible, so it was not recorded."
    return parsed.composition.strip(), None


async def build_garment(*, name: str, price: float, color: str, sleeves: Sleeve | None, neckline: Neckline | None,
                        description: str, tags: list[str], composition_text: str, garment_photo: bytes,
                        label_photo: bytes | None, label_composition: str, images_dir: Path) -> tuple[Product, list[str]]:
    """Saves the images and returns the product plus notes about anything that could not be recorded.

    label_composition is the care-label text after the team confirmed or corrected it. A label photo without
    confirmed text is not turned into evidence: an AI transcription is never accepted automatically.
    """
    pid = f"real_{uuid.uuid4().hex[:8]}"
    images_dir.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    notes: list[str] = []
    data, _, _ = sanitize_photo(garment_photo)
    image = f"{pid}.jpg"
    (images_dir / image).write_bytes(data)

    def ev(suffix: str, field: str, quote: str | None, source: str, source_type: str = "owner_inspection",
           kind: str = "text", img: str | None = None) -> Evidence:
        return Evidence(id=f"{pid}_{suffix}", product_id=pid, field=field, kind=kind, source=source, source_type=source_type,
                        quote=quote, image=img, collected_at=today)

    evidence = [
        ev("price", "price", f"${price:.2f} USD (reference price entered by the team)", "Team entry"),
        ev("image", "image", None, "Team photo of the garment", kind="image", img=image),
        ev("color", "color", f"Color: {color.strip()}", OWNER),
    ]
    if sleeves:
        evidence.append(ev("sleeves", "sleeves", SLEEVE_TEXT[sleeves], OWNER))
    if neckline:
        evidence.append(ev("neckline", "neckline", NECK_TEXT[neckline], OWNER))
    if composition_text.strip():
        evidence.append(ev("composition", "composition", composition_text.strip()[:140], "Team transcription of the care label", "care_label_photo"))
    if label_photo and label_composition.strip():
        label_data, _, _ = sanitize_photo(label_photo)
        label_image = f"{pid}_label.jpg"
        (images_dir / label_image).write_bytes(label_data)
        evidence.append(ev("label", "composition", label_composition.strip()[:140], f"{LABEL_SOURCE} (transcription confirmed by the team)",
                           "care_label_photo", img=label_image))
    elif label_photo:
        notes.append("The care-label photo was not saved because its composition was not confirmed.")
    if not any(e.field == "composition" for e in evidence):
        notes.append("No composition was recorded, so material requirements will show as unknown for this garment.")
    product = Product(id=pid, name=name.strip(), brand="Team wardrobe", variant=color.strip(), color=color.strip(), price=price,
                      currency="USD", description=description.strip(), tags=tags, image=image, collected_at=today,
                      data_label=REAL_LABEL, evidence=evidence,
                      image_rights="own_photo", is_demo=False, is_owned=True)
    return product, notes
