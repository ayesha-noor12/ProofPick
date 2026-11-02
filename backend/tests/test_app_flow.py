import asyncio
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.llm import ModelClient
from app.main import build_app
from app.youcam_client import TaskResult, YouCamError

REQ = {"max_price_usd": 60, "sleeves": "long", "neckline": "high", "excluded_materials": ["polyester"], "preferences": ["work-appropriate"]}


class FakeYouCam:
    configured = True

    def __init__(self):
        self.created, self.polls, self.uploads = [], [], 0
        self.result = TaskResult("success", url="https://signed.test/r")
        self.fail_create = False

    async def upload_image(self, data, name, content_type):
        self.uploads += 1
        return f"file{self.uploads}"

    async def create_task(self, src, ref):
        if self.fail_create:
            raise YouCamError("YouCam task creation failed", code="CreditInsufficiency")
        self.created.append((src, ref))
        return f"task{len(self.created)}"

    async def get_task(self, task_id):
        self.polls.append(task_id)
        return self.result

    async def download(self, url):
        return _jpeg()


def _jpeg(size=(800, 600)):
    buf = io.BytesIO()
    Image.new("RGB", size, (120, 120, 120)).save(buf, "JPEG", exif=Image.Exif())
    return buf.getvalue()


@pytest.fixture
def env(tmp_path):
    settings = Settings(_env_file=None, PROOFPICK_VAR_DIR=tmp_path, PROOFPICK_POLL_INTERVAL_SECONDS=0,
                        PROOFPICK_REAL_CATALOG=tmp_path / "real.json", PROOFPICK_REAL_IMAGES=tmp_path / "real_images",
                        PROOFPICK_REAL_LISTINGS=tmp_path / "listings.json", PROOFPICK_CACHED_DEMO_DIR=tmp_path / "cached_demo")
    youcam = FakeYouCam()
    app = build_app(settings, youcam=youcam, model=ModelClient("", "m"), start_worker=False)
    return TestClient(app), app, youcam


def drain(app, ticks=12):
    for _ in range(ticks):
        asyncio.run(app.state.worker.tick())


def upload(client):
    response = client.post("/api/photos", data={"consent": "true", "adult": "true"},
                           files={"file": ("me.jpg", _jpeg(), "image/jpeg")})
    assert response.status_code == 200
    return response.json()["photo_id"]


def start(client, photo_id=None, req=REQ):
    response = client.post("/api/recommendations", json={"requirements": req, "photo_id": photo_id})
    assert response.status_code == 202
    return response.json()["run_id"]


def test_full_journey(env):
    client, app, youcam = env
    run_id = start(client, upload(client))
    assert client.get(f"/api/runs/{run_id}").json()["state"] == "queued"
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    assert report["state"] == "complete"
    assert len(report["recommendations"]) == 3 and len(youcam.created) == 3
    assert all(c["status"] == "meets_documented_requirements" for c in report["recommendations"])
    needs = {c["product_id"] for c in report["needs_information"]}
    assert {"top_005", "top_007", "top_008", "top_009", "top_015"} == needs
    assert "top_003" in {c["product_id"] for c in report["excluded"]}
    preview = report["recommendations"][0]["previews"][0]
    assert preview["status"] == "done"
    # With no model available the preview is reported as not inspected, not as passed.
    assert preview["inspection"]["status"] == "not_assessable"
    assert client.get(preview["image_url"]).status_code == 200
    assert "signed.test" not in str(report) and "task1" not in str(report)
    assert report["recommendations"][0]["checks"][0]["evidence"][0]["quote"]


def test_failed_preview_never_changes_product_status(env):
    client, app, youcam = env
    youcam.result = TaskResult("error", error="error_pose")
    run_id = start(client, upload(client))
    drain(app)
    card = client.get(f"/api/runs/{run_id}").json()["recommendations"][0]
    assert card["status"] == "meets_documented_requirements"
    assert card["previews"][0]["status"] == "failed" and "error_pose" in card["previews"][0]["error"]


def test_restart_resumes_existing_task(env, tmp_path):
    client, app, youcam = env
    youcam.result = TaskResult("running")
    run_id = start(client, upload(client))
    drain(app)
    submitted = len(youcam.created)
    assert submitted == 3
    # A new process with the same database polls the same tasks.
    second = FakeYouCam()
    settings = Settings(_env_file=None, PROOFPICK_VAR_DIR=tmp_path, PROOFPICK_POLL_INTERVAL_SECONDS=0,
                        PROOFPICK_CACHED_DEMO_DIR=tmp_path / "cached_demo")
    app2 = build_app(settings, youcam=second, model=ModelClient("", "m"), start_worker=False)
    drain(app2)
    assert second.created == [] and second.uploads == 0
    assert set(second.polls) == {"task1", "task2", "task3"}


def test_one_retry_per_session(env):
    client, app, youcam = env
    youcam.fail_create = True
    run_id = start(client, upload(client))
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    pid = report["recommendations"][0]["product_id"]
    assert report["retries_remaining"] == 1
    youcam.fail_create = False
    assert client.post(f"/api/runs/{run_id}/retry-preview", json={"product_id": pid}).status_code == 202
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    assert report["retries_remaining"] == 0
    assert [p["status"] for p in report["recommendations"][0]["previews"]] == ["failed", "done"]
    other = report["recommendations"][1]["product_id"]
    assert client.post(f"/api/runs/{run_id}/retry-preview", json={"product_id": other}).status_code == 409


def test_uninspected_preview_does_not_spend_the_retry(env):
    client, app, _ = env
    run_id = start(client, upload(client))
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    pid = report["recommendations"][0]["product_id"]
    assert client.post(f"/api/runs/{run_id}/retry-preview", json={"product_id": pid}).status_code == 409
    assert client.get(f"/api/runs/{run_id}").json()["retries_remaining"] == 1


def test_session_preview_limit_is_enforced_across_runs(env):
    client, app, youcam = env
    photo = upload(client)
    start(client, photo)
    drain(app)
    second = start(client, photo)
    drain(app)
    assert len(youcam.created) == 3
    report = client.get(f"/api/runs/{second}").json()
    assert report["state"] == "complete" and "limit" in report["preview_notice"]
    assert all(c["previews"][0]["status"] == "skipped" for c in report["recommendations"])


def test_no_match_explains_without_relaxing(env):
    client, app, youcam = env
    run_id = start(client, upload(client), {**REQ, "max_price_usd": 10})
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    assert report["recommendations"] == [] and report["state"] == "complete"
    assert "Nothing was relaxed" in report["no_match"]["message"]
    budget = next(b for b in report["no_match"]["blockers"] if b["requirement"] == "budget")
    assert budget["would_unlock"] >= 1
    assert youcam.created == []


def test_no_photo_skips_try_on(env):
    client, app, youcam = env
    run_id = start(client)
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    assert report["state"] == "complete" and youcam.created == [] and "No photo" in report["preview_notice"]


def test_photo_rules(env):
    client, _, _ = env
    good = ("me.jpg", _jpeg(), "image/jpeg")
    assert client.post("/api/photos", files={"file": good}).status_code == 400  # no consent
    bad = ("x.jpg", b"not an image", "image/jpeg")
    assert client.post("/api/photos", data={"consent": "true", "adult": "true"}, files={"file": bad}).status_code == 400
    small = ("s.jpg", _jpeg((300, 200)), "image/jpeg")
    enlarged = client.post("/api/photos", data={"consent": "true", "adult": "true"}, files={"file": small}).json()
    assert enlarged["width"] >= 512 and enlarged["height"] >= 384
    tiny = ("t.jpg", _jpeg((40, 40)), "image/jpeg")
    assert client.post("/api/photos", data={"consent": "true", "adult": "true"}, files={"file": tiny}).status_code == 400


def test_other_sessions_cannot_read_runs_and_delete_clears_data(env, tmp_path):
    client, app, _ = env
    run_id = start(client, upload(client))
    drain(app)
    stranger = TestClient(app)
    assert stranger.get(f"/api/runs/{run_id}").status_code == 404
    session_id = client.get("/api/session").json()["session_id"]
    assert stranger.delete(f"/api/sessions/{session_id}").status_code == 404
    deleted = client.delete(f"/api/sessions/{session_id}")
    assert deleted.status_code == 200 and "does not delete" in deleted.json()["note"]
    assert not (tmp_path / "sessions" / session_id).exists()


def test_unconfigured_youcam_fails_honestly(tmp_path):
    settings = Settings(_env_file=None, PROOFPICK_VAR_DIR=tmp_path, YOUCAM_API_KEY="", PROOFPICK_CACHED_DEMO_DIR=tmp_path / "cached_demo")
    app = build_app(settings, model=ModelClient("", "m"), start_worker=False)
    client = TestClient(app)
    run_id = start(client, upload(client))
    drain(app)
    preview = client.get(f"/api/runs/{run_id}").json()["recommendations"][0]["previews"][0]
    assert preview["status"] == "failed" and preview["image_url"] is None


def test_history_lists_only_this_sessions_runs(env):
    client, app, _ = env
    run_id = start(client)
    drain(app)
    runs = client.get("/api/runs").json()["runs"]
    assert [r["run_id"] for r in runs] == [run_id]
    assert runs[0]["matches"] >= 1 and runs[0]["top_images"][0].startswith("/api/catalog-images/")
    other = TestClient(app)
    assert other.get("/api/runs").json()["runs"] == []


def test_reinspect_reuses_the_saved_preview(env):
    client, app, youcam = env
    run_id = start(client, upload(client))
    drain(app)
    card = client.get(f"/api/runs/{run_id}").json()["recommendations"][0]
    assert card["previews"][0]["inspection"]["method"] == "unavailable"
    assert client.post(f"/api/runs/{run_id}/reinspect", json={"product_id": card["product_id"]}).status_code == 202
    drain(app)
    again = client.get(f"/api/runs/{run_id}").json()
    assert again["state"] == "complete" and len(youcam.created) == 3
    assert again["recommendations"][0]["previews"][0]["status"] == "done"


def _png(size=(900, 900)):
    buf = io.BytesIO()
    Image.new("RGB", size, (40, 60, 90)).save(buf, "PNG")
    return buf.getvalue()


def test_real_garment_is_searchable_with_its_own_evidence(env):
    client, app, _ = env
    form = {"name": "Team Navy Knit", "price": "35", "color": "navy", "sleeves": "long", "neckline": "crew",
            "composition": "100% cotton", "tags": "work"}
    added = client.post("/api/garments", data=form, files={"garment": ("g.png", _png(), "image/png")})
    assert added.status_code == 201
    garment = added.json()["garment"]
    assert {e["source"] for e in garment["evidence"]} >= {"Owner inspection of the garment", "Team transcription of the care label"}
    req = {"max_price_usd": 40, "sleeves": "long", "neckline": "crew", "excluded_materials": ["polyester"]}
    run_id = client.post("/api/recommendations", json={"requirements": req, "scope": "real"}).json()["run_id"]
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    assert [c["product_id"] for c in report["recommendations"]] == [garment["product_id"]]
    assert report["recommendations"][0]["is_owned"] and not report["excluded"]
    assert client.get(garment["image_url"]).status_code == 200
    assert client.delete(f"/api/garments/{garment['product_id']}").json()["deleted"]
    assert client.get(f"/api/runs/{run_id}").json()["recommendations"] == []


def test_garment_without_composition_is_unknown_for_materials(env):
    client, app, _ = env
    form = {"name": "Mystery Top", "price": "20", "color": "red", "sleeves": "short"}
    added = client.post("/api/garments", data=form, files={"garment": ("g.png", _png(), "image/png")}).json()
    assert any("No composition" in n for n in added["notes"])
    run_id = client.post("/api/recommendations", json={"requirements": {"excluded_materials": ["polyester"]}, "scope": "real"}).json()["run_id"]
    drain(app)
    assert [c["product_id"] for c in client.get(f"/api/runs/{run_id}").json()["needs_information"]] == [added["garment"]["product_id"]]


def test_photo_with_no_match_explains_and_allows_trying_on_a_near_miss(env):
    client, app, youcam = env
    run_id = start(client, upload(client), req={"max_price_usd": 1})
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    assert report["state"] == "complete" and "photo has not been used" in report["preview_notice"]
    assert youcam.created == []
    near = report["excluded"][0]["product_id"]
    assert client.post(f"/api/runs/{run_id}/try-on", json={"product_id": near}).status_code == 202
    assert client.post(f"/api/runs/{run_id}/try-on", json={"product_id": near}).status_code == 409
    drain(app)
    card = next(c for c in client.get(f"/api/runs/{run_id}").json()["excluded"] if c["product_id"] == near)
    assert card["status"] == "conflicts_with_requirement" and card["previews"][0]["status"] == "done"


def test_sample_model_previews_are_cached_and_labeled(env, tmp_path):
    client, app, youcam = env
    settings = app.state.pipeline.settings
    sample = tmp_path / "model.jpg"
    sample.write_bytes(_jpeg())
    settings.sample_photo_path = sample
    first = start(client, client.post("/api/photos", data={"use_sample": "true"}).json()["photo_id"])
    drain(app)
    assert len(youcam.created) == 3
    second = start(client, client.post("/api/photos", data={"use_sample": "true"}).json()["photo_id"])
    drain(app)
    assert len(youcam.created) == 3
    previews = [c["previews"][0] for c in client.get(f"/api/runs/{second}").json()["recommendations"]]
    assert all(p["cached"] == 1 and p["status"] == "done" and p["image_url"] for p in previews)
    assert not any(c["previews"][0]["cached"] for c in client.get(f"/api/runs/{first}").json()["recommendations"])


def test_spec_e_demo_products_never_render_a_retailer_link(env):
    client, app, _ = env
    run_id = start(client)
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    cards = report["recommendations"] + report["needs_information"] + report["excluded"] + report["other_eligible"]
    assert cards and all(c["is_demo"] and c["product_url"] is None for c in cards)
    assert all(e["source_type"] == "demo" and e["source_url"] is None for c in cards for k in c["checks"] for e in k["evidence"])


def test_why_ranked_here_is_built_from_structured_data(env):
    client, app, _ = env
    req = {**REQ, "preferences": ["work", "beach"], "preferred_colors": ["navy"]}
    run_id = start(client, req=req)
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    pick = report["recommendations"][0]
    assert pick["why"][0].startswith("Meets all 5 must-haves: within budget, no polyester, long sleeves, high neckline")
    assert any(line.startswith("Matches your preferences:") for line in pick["why"])
    assert "Not documented: beach" in " ".join(pick["why"])
    assert report["excluded"][0]["why"][0].startswith("Not eligible:")



def _seed_example(app, product_id):
    folder = app.state.pipeline.settings.cached_demo_dir
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{product_id}.jpg").write_bytes(_jpeg())


def test_live_tryon_unavailable_serves_a_labeled_example_never_a_live_result(env):
    client, app, youcam = env
    youcam.configured = False
    _seed_example(app, "top_001")
    run_id = start(client, upload(client))
    drain(app)
    cards = {c["product_id"]: c for c in client.get(f"/api/runs/{run_id}").json()["recommendations"]}
    example = cards["top_001"]["previews"][0]
    assert example["cached"] == 2 and example["image_url"] and "not configured" in example["error"]
    others = [c["previews"][0] for pid, c in cards.items() if pid != "top_001"]
    assert others and all(p["status"] == "failed" and not p["cached"] for p in others)
    assert youcam.created == []


def test_daily_cap_zero_means_no_cap_and_a_hit_cap_falls_back(env):
    client, app, youcam = env
    settings = app.state.pipeline.settings
    settings.max_tasks_per_day = 0
    start(client, upload(client))
    drain(app)
    assert len(youcam.created) == 3
    settings.max_tasks_per_day = 3
    _seed_example(app, "top_001")
    fresh = TestClient(app)  # a new session, so the per-session preview limit is not what stops it
    run_id = start(fresh, upload(fresh))
    drain(app)
    previews = {c["product_id"]: c["previews"][0] for c in fresh.get(f"/api/runs/{run_id}").json()["recommendations"]}
    assert len(youcam.created) == 3 and previews["top_001"]["cached"] == 2
    assert "limit" in previews["top_001"]["error"]


class HostileRanker:
    """A model that tries to rank an ineligible product (top_003 lists polyester) first."""

    configured = True

    async def structured(self, system, content, schema, effort="medium"):
        from app.llm import ModelUnavailable
        from app.recommender import _ModelRanking
        from app.schemas import RankedProduct
        if schema is _ModelRanking:
            ids = ["top_003", "top_001", "top_002", "top_004", "top_006"]
            return _ModelRanking(items=[RankedProduct(product_id=i, explanation="best") for i in ids])
        raise ModelUnavailable("not used in this test")


def test_spec_c_model_ranking_cannot_flip_eligibility(tmp_path):
    settings = Settings(_env_file=None, PROOFPICK_VAR_DIR=tmp_path, PROOFPICK_REAL_LISTINGS=tmp_path / "l.json",
                        PROOFPICK_REAL_CATALOG=tmp_path / "r.json", PROOFPICK_CACHED_DEMO_DIR=tmp_path / "c")
    app = build_app(settings, youcam=FakeYouCam(), model=HostileRanker(), start_worker=False)
    client = TestClient(app)
    run_id = start(client)
    drain(app)
    report = client.get(f"/api/runs/{run_id}").json()
    picked = {c["product_id"] for c in report["recommendations"] + report["other_eligible"]}
    assert "top_003" not in picked
    assert next(c for c in report["excluded"] if c["product_id"] == "top_003")["status"] == "conflicts_with_requirement"
    assert report["ranking_method"] == "rules"  # the invalid model order was rejected as a whole
