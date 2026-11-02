import json
import logging
from pathlib import Path

from .schemas import Evidence, Product

log = logging.getLogger("proofpick.catalog")


def is_placeholder(raw: dict) -> bool:
    """Template entries marked TODO are never loaded, so placeholder data can't reach a shopper."""
    return bool(raw.get("todo")) or "TODO" in str(raw.get("id", ""))


def load_products(path: Path | None) -> list[Product]:
    if not path or not path.exists():
        return []
    return [Product.model_validate(p) for p in json.loads(path.read_text()) if not is_placeholder(p)]


class Catalog:
    """Demo products, real retailer listings (read-only) and garments the team owns (editable), in one index."""

    def __init__(self, products: list[Product], images_dir: Path, owned_path: Path | None = None, real_images_dir: Path | None = None):
        self.products = products
        self.images_dir = images_dir
        self.owned_path = owned_path
        self.real_images_dir = real_images_dir
        self._index()

    def _index(self) -> None:
        self._by_id = {p.id: p for p in self.products}
        self._evidence = {e.id: e for p in self.products for e in p.evidence}

    @classmethod
    def load(cls, path: Path, images_dir: Path, owned_path: Path | None = None, real_images_dir: Path | None = None,
             listings_path: Path | None = None) -> "Catalog":
        products = load_products(path) + load_products(listings_path) + load_products(owned_path)
        seen: set[str] = set()
        for p in products:
            if p.id in seen:
                raise ValueError(f"Duplicate product id in catalogs: {p.id}")
            seen.add(p.id)
        return cls(products, images_dir, owned_path, real_images_dir)

    def get(self, product_id: str) -> Product | None:
        return self._by_id.get(product_id)

    def evidence(self, evidence_id: str) -> Evidence | None:
        return self._evidence.get(evidence_id)

    def _dir(self, product: Product) -> Path:
        return self.images_dir if product.is_demo or self.real_images_dir is None else self.real_images_dir

    def image_path(self, product: Product) -> Path:
        return self._dir(product) / product.image

    def file_for(self, name: str) -> Path | None:
        """The path of a product or evidence image this catalog publishes, or None."""
        for p in self.products:
            if p.image == name or any(e.image == name for e in p.evidence):
                return self._dir(p) / name
        return None

    def in_scope(self, scope: str) -> list[Product]:
        if scope == "real":
            return [p for p in self.products if not p.is_demo]
        if scope == "demo":
            return [p for p in self.products if p.is_demo]
        return list(self.products)

    @property
    def real(self) -> list[Product]:
        """Everything that is not demo data: real listings and owned garments."""
        return [p for p in self.products if not p.is_demo]

    @property
    def owned(self) -> list[Product]:
        return [p for p in self.products if p.is_owned]

    def _save_owned(self) -> None:
        assert self.owned_path is not None
        self.owned_path.write_text(json.dumps([p.model_dump(mode="json") for p in self.owned], indent=1))

    def add_owned(self, product: Product) -> None:
        self.products.append(product)
        self._index()
        self._save_owned()

    def remove_owned(self, product_id: str) -> Product | None:
        product = self.get(product_id)
        if product is None or not product.is_owned:
            return None
        self.products.remove(product)
        self._index()
        self._save_owned()
        return product
