import json

from PIL import Image

from app.catalog import Catalog
from scripts.validate_catalog import validate_entry, validate_file


def _entry(**overrides):
    entry = {
        "id": "l1", "name": "Rib Top", "brand": "B", "variant": "black / M", "color": "black", "price": 40, "currency": "USD",
        "description": "Rib knit.", "image": "l1.jpg", "collected_at": "2026-11-01", "data_label": "Real listing",
        "retailer_name": "Example", "product_url": "https://example.com/p/1", "image_rights": "permitted", "is_demo": False,
        "evidence": [{"id": "l1_c", "product_id": "l1", "field": "composition", "source": "Listing", "source_type": "listing_text",
                      "source_url": "https://example.com/p/1", "quote": "100% cotton", "collected_at": "2026-11-01"}],
    }
    entry.update(overrides)
    return entry


def _image(folder, size=(800, 800)):
    Image.new("RGB", size, (20, 20, 20)).save(folder / "l1.jpg")


def test_complete_listing_passes(tmp_path):
    _image(tmp_path)
    assert validate_entry(_entry(), tmp_path) == []


def test_spec_f_non_demo_listing_without_product_url_fails(tmp_path):
    _image(tmp_path)
    assert any("product_url" in p for p in validate_entry(_entry(product_url=None), tmp_path))


def test_missing_rights_date_or_source_url_and_small_images_fail(tmp_path):
    _image(tmp_path, (400, 300))
    problems = " ".join(validate_entry(_entry(image_rights=None), tmp_path))
    assert "image_rights" in problems
    assert any("collected_at" in p for p in validate_entry(_entry(collected_at=""), tmp_path))
    evidence = [{**_entry()["evidence"][0], "source_url": None}]
    assert any("needs a source_url" in p for p in validate_entry(_entry(evidence=evidence), tmp_path))
    assert any("smaller than 512x384" in p for p in validate_entry(_entry(), tmp_path))


def test_todo_placeholders_are_skipped_and_never_loaded(tmp_path):
    path = tmp_path / "real.json"
    path.write_text(json.dumps([_entry(id="TODO_x", todo=True, product_url="TODO")]))
    assert validate_file(path, tmp_path) == (0, 1, [])
    demo = tmp_path / "demo.json"
    demo.write_text("[]")
    assert Catalog.load(demo, tmp_path, listings_path=path).products == []
