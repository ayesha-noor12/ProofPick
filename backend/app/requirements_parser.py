"""Turns a request into editable requirements without adding unstated restrictions."""

import difflib
import re

from . import colors
from .llm import ModelClient, ModelUnavailable
from .schemas import ParsedRequirements, Requirements

SYSTEM = """You convert a clothing request into structured requirements for tops.

Constraint fields hold only what the shopper states as a requirement:
- max_price_usd and price_inclusive: "under $60" and "below $60" mean price_inclusive=false; "up to $60" and "$60 or less" mean true.
- sleeves: long, three_quarter, short or sleeveless. neckline: high, crew, v_neck, scoop, boat or collared. Treat turtleneck, mock neck and funnel neck as high.
- excluded_materials: lowercase fiber names the shopper rejects.

Soft wishes such as occasion or style go in preferences, and favored colors in preferred_colors. Leave any unstated field empty. Never infer a restriction from an occasion: "for work" says nothing about the neckline.

Set colors_required to true only when the shopper says the color is a must ("only in black", "it has to be green", "must be burgundy"). A color they merely like stays a preference.

Correct obvious misspellings to the standard lowercase word ("burgendi" -> "burgundy", "polyster" -> "polyester", "flees" -> "fleece"), but never add anything the shopper did not ask for."""

_MATERIALS = "polyester|nylon|acrylic|wool|viscose|rayon|elastane|spandex|silk|cotton|linen|polyamide"
_COLORS = "black|white|navy|ivory|sage|burgundy|camel|charcoal|slate|forest|rust|blue|oatmeal|terracotta|plum|green|red|pink|grey|gray|brown|beige"


def parse_with_rules(text: str) -> Requirements:
    t = text.lower()
    req = Requirements()
    if m := re.search(r"(under|below|less than|up to|at most|max(?:imum)?(?: of)?|no more than)\s*\$?\s*(\d+(?:\.\d+)?)", t):
        req.max_price_usd = float(m.group(2))
        req.price_inclusive = m.group(1).startswith(("up to", "at most", "max", "no more"))
    elif m := re.search(r"\$\s*(\d+(?:\.\d+)?)\s*(or less|or under|max)", t):
        req.max_price_usd = float(m.group(1))
        req.price_inclusive = True
    if re.search(r"\blong[- ]sleeve", t):
        req.sleeves = "long"
    elif re.search(r"\bshort[- ]sleeve", t):
        req.sleeves = "short"
    elif re.search(r"\b(three[- ]quarter|3/4)[- ]?sleeve", t):
        req.sleeves = "three_quarter"
    elif "sleeveless" in t:
        req.sleeves = "sleeveless"
    if re.search(r"high[- ]neck|turtle ?neck|mock[- ]neck|funnel[- ]neck|roll ?neck", t):
        req.neckline = "high"
    elif re.search(r"crew[- ]?neck", t):
        req.neckline = "crew"
    elif re.search(r"\bv[- ]neck", t):
        req.neckline = "v_neck"
    excluded = re.findall(rf"(?:without|no|not|avoid|excluding|free of)\s+(?:any\s+)?({_MATERIALS})", t)
    excluded += re.findall(rf"({_MATERIALS})[- ]free", t)
    req.excluded_materials = sorted(set(excluded))
    if re.search(r"\b(work|office)\b", t):
        req.preferences.append("work-appropriate")
    for word in ("casual", "minimal", "classic", "polished"):
        if word in t:
            req.preferences.append(word)
    req.preferred_colors = colors.find_in_text(t)
    req.colors_required = bool(req.preferred_colors) and bool(re.search(r"\b(only|must be|has to be|needs to be)\b[^.]*\b(" + _COLORS + r")\b", t))
    return req


def drop_unstated(text: str, req: Requirements) -> tuple[Requirements, list[str]]:
    """Guards against a model adding a price or material the shopper never mentioned."""
    t = text.lower()
    words = re.findall(r"[a-z]+", t)
    notes: list[str] = []

    def mentioned(material: str) -> bool:
        m = material.lower()
        # A close spelling counts, so a corrected typo ("polyster") is kept.
        return m in t or (m == "polyester" and "poly" in t) or bool(difflib.get_close_matches(m, words, n=1, cutoff=0.7))

    stated = [m for m in req.excluded_materials if mentioned(m)]
    if len(stated) != len(req.excluded_materials):
        notes.append("Removed a material exclusion that was not in your request.")
    req = req.model_copy(update={"excluded_materials": [m.lower() for m in stated]})
    if req.max_price_usd is not None and f"{req.max_price_usd:g}" not in t:
        notes.append("Removed a budget that was not in your request.")
        req = req.model_copy(update={"max_price_usd": None})
    return req, notes


async def parse_requirements(text: str, model: ModelClient) -> ParsedRequirements:
    try:
        parsed = await model.structured(SYSTEM, f"<request>{text}</request>", Requirements, effort="low")
    except ModelUnavailable:
        return ParsedRequirements(
            requirements=parse_with_rules(text), parser="rules",
            notes=["Read with basic rules because the model was unavailable. Please check every field."],
        )
    requirements, notes = drop_unstated(text, parsed)
    requirements.preferred_colors = list(dict.fromkeys(colors.normalize(c) for c in requirements.preferred_colors))
    return ParsedRequirements(requirements=requirements, parser="model", notes=notes)
