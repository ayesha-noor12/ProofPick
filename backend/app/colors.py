"""Matches a requested color to a product's listed color name by color family. It never judges shades from images."""

import difflib
import re

# Each requested color accepts these words in a listing's color name.
FAMILIES: dict[str, set[str]] = {
    "black": {"black", "jet", "onyx", "ebony"},
    "white": {"white", "ivory", "cream", "off-white", "ecru"},
    "grey": {"grey", "gray", "charcoal", "slate", "heather", "silver"},
    "navy": {"navy", "midnight"},
    "blue": {"blue", "navy", "cobalt", "azure", "sky", "denim", "dusty blue", "indigo", "teal"},
    "green": {"green", "forest", "sage", "olive", "emerald", "bottle green", "mint", "khaki", "hunter"},
    "bottle green": {"bottle green", "forest", "hunter", "emerald", "pine", "dark green"},
    "forest": {"forest", "bottle green", "hunter", "pine", "dark green"},
    "sage": {"sage", "mint"},
    "olive": {"olive", "khaki"},
    "red": {"red", "scarlet", "crimson", "cherry", "burgundy", "wine", "rust", "brick"},
    "burgundy": {"burgundy", "wine", "maroon", "oxblood", "bordeaux", "claret", "merlot"},
    "pink": {"pink", "rose", "blush", "fuchsia", "magenta"},
    "purple": {"purple", "plum", "lilac", "lavender", "violet", "aubergine", "mauve"},
    "brown": {"brown", "camel", "chocolate", "tan", "mocha", "coffee", "terracotta", "rust"},
    "beige": {"beige", "oatmeal", "sand", "camel", "taupe", "stone", "ecru"},
    "orange": {"orange", "rust", "terracotta", "coral", "burnt orange"},
    "yellow": {"yellow", "mustard", "lemon", "gold"},
}
_KNOWN = sorted({*FAMILIES, *(w for words in FAMILIES.values() for w in words)}, key=len, reverse=True)


def normalize(color: str) -> str:
    """Lowercases and fixes an obvious misspelling ("burgendi" -> "burgundy", "bottle greem" -> "bottle green")."""
    c = re.sub(r"\s+", " ", color.strip().lower())
    if c in FAMILIES or c in _KNOWN:
        return c
    # A typo almost always keeps its first letter; requiring it stops "under" becoming "hunter".
    close = difflib.get_close_matches(c, [k for k in _KNOWN if k[:1] == c[:1]], n=1, cutoff=0.72)
    return close[0] if close else c


def find_in_text(text: str) -> list[str]:
    """Color names in free text, tolerating typos in longer words ("burgendi", "bottle greem")."""
    words = re.findall(r"[a-z]+", text.lower())
    found: list[str] = []
    i = 0
    while i < len(words):
        pair = f"{words[i]} {words[i + 1]}" if i + 1 < len(words) else ""
        if pair and len(pair) >= 8 and normalize(pair) in _KNOWN and " " in normalize(pair):
            found.append(normalize(pair))
            i += 2
            continue
        word = words[i]
        if word in _KNOWN or (len(word) >= 5 and normalize(word) in _KNOWN):
            found.append(normalize(word))
        i += 1
    return list(dict.fromkeys(found))


def accepted_words(color: str) -> set[str]:
    c = normalize(color)
    return FAMILIES.get(c, {c})


def matches(requested: str, listed: str) -> bool:
    listed = listed.lower()
    return any(re.search(rf"\b{re.escape(w)}\b", listed) for w in accepted_words(requested))
