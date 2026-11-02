"""Upload validation. Re-encoding drops EXIF and other metadata from user photos."""

import io

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
MAX_SIDE = 2048
# YouCam needs at least 512x384, so smaller photos are enlarged rather than rejected.
MIN_LONG, MIN_SHORT = 512, 384
TINY = 64


class InvalidImage(ValueError):
    pass


def sanitize_photo(data: bytes) -> tuple[bytes, int, int]:
    if len(data) > MAX_BYTES:
        raise InvalidImage("Photo must be smaller than 10 MB.")
    try:
        probe = Image.open(io.BytesIO(data))
        if probe.format not in ("JPEG", "PNG", "WEBP"):
            raise InvalidImage("Photo must be a JPEG, PNG or WebP image.")
        probe.verify()
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise InvalidImage("That file could not be read as an image.") from exc
    if min(image.size) < TINY:
        raise InvalidImage("That image is too small to show a person. Please choose a clearer photo.")
    image = image.convert("RGB")
    scale = max(MIN_LONG / max(image.size), MIN_SHORT / min(image.size))
    if scale > 1:
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=92)
    return out.getvalue(), image.width, image.height
