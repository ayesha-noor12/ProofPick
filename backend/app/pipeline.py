"""Controls run transitions. Each step is persisted, so a restart resumes rather than repeats it.

Product verification and preview inspection stay separate: nothing in the
preview path can change a product's eligibility.
"""

import json
import logging
import mimetypes
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from .catalog import Catalog
from .config import Settings
from .llm import ModelClient
from .preview_inspector import assess_attribute, inspect_preview
from .product_verifier import combine, verify_product
from .recommender import rank_candidates
from .schemas import Check, PreviewStatus, ProductResult, ProductStatus, Requirements
from .storage import ACTIVE_JOB_STATUSES, Store, now
from .youcam_client import YouCamClient, YouCamError

log = logging.getLogger("proofpick.pipeline")
MAX_SHORTLIST = 3
MAX_VISUAL_CHECKS = 4
VISUAL_FIELDS = ("sleeves", "neckline")


# Values of jobs.cached: a pre-generated example for the sample model photo, or one shown in place of a live
# try-on of the shopper's own photo because live try-on was unavailable.
SAMPLE_EXAMPLE, FALLBACK_EXAMPLE = 1, 2


class RetryNotAllowed(Exception):
    pass


def explain_no_match(results: dict[str, ProductResult]) -> dict:
    """Reports what blocks the request and what relaxing each part would unlock. It relaxes nothing itself."""
    blockers: dict[str, dict[str, int]] = {}
    unlocks: dict[str, int] = {}
    for result in results.values():
        failing = [c for c in result.checks if c.status != ProductStatus.MEETS]
        for check in failing:
            entry = blockers.setdefault(check.requirement, {"conflicts": 0, "unknown": 0})
            entry["conflicts" if check.status == ProductStatus.CONFLICT else "unknown"] += 1
        if len(failing) == 1:
            unlocks[failing[0].requirement] = unlocks.get(failing[0].requirement, 0) + 1
    return {
        "message": "No product in the catalog has documented support for every requirement. Nothing was relaxed.",
        "blockers": [{"requirement": k, **v, "would_unlock": unlocks.get(k, 0)} for k, v in blockers.items()],
    }


class Pipeline:
    def __init__(self, store: Store, catalog: Catalog, youcam: YouCamClient, model: ModelClient, settings: Settings):
        self.store = store
        self.catalog = catalog
        self.youcam = youcam
        self.model = model
        self.settings = settings

    async def advance(self, run_id: str) -> None:
        """Performs one step for a run."""
        run = self.store.get_run(run_id)
        if run is None:
            return
        try:
            if run["state"] in ("queued", "checking"):
                await self._check_products(run)
            elif run["state"] == "ranking":
                await self._rank(run)
            elif run["state"] == "previewing":
                await self._advance_previews(run)
        except Exception:
            # Logged by type only; request data and image URLs stay out of the logs.
            log.exception("Run step failed")
            self.store.update_run(run_id, state="failed", error="Something went wrong while processing this request.")

    async def _check_products(self, run: dict) -> None:
        self.store.update_run(run["id"], state="checking")
        req = Requirements.model_validate(run["requirements"])
        scope = run["data"].get("scope", "all")
        results = {p.id: verify_product(p, req) for p in self.catalog.in_scope(scope)}
        await self._fill_gaps_from_photos(results, req)
        data = {"scope": scope, "results": {k: v.model_dump(mode="json") for k, v in results.items()}}
        self.store.update_run(run["id"], state="ranking", data=data)

    async def _fill_gaps_from_photos(self, results: dict[str, ProductResult], req: Requirements) -> None:
        """Looks at the original photo only when a text gap in sleeves or neckline is all that blocks a product."""
        if not self.model.configured:
            return
        wanted = {"sleeves": req.sleeves, "neckline": req.neckline}
        used = 0
        for result in results.values():
            if result.status != ProductStatus.INSUFFICIENT:
                continue
            failing = [c for c in result.checks if c.status != ProductStatus.MEETS]
            if not all(c.requirement in VISUAL_FIELDS and not c.evidence_ids for c in failing):
                continue
            product = self.catalog.get(result.product_id)
            replaced: list[Check] = []
            for check in result.checks:
                if check in failing and used < MAX_VISUAL_CHECKS:
                    used += 1
                    visual = await assess_attribute(product, check.requirement, wanted[check.requirement],
                                                    self.catalog.image_path(product), self.model)
                    replaced.append(visual or check)
                else:
                    replaced.append(check)
            result.checks = replaced
            result.status = combine(replaced)

    async def _rank(self, run: dict) -> None:
        req = Requirements.model_validate(run["requirements"])
        results = {k: ProductResult.model_validate(v) for k, v in run["data"]["results"].items()}
        eligible = [self.catalog.get(k) for k, v in results.items() if v.status == ProductStatus.MEETS]
        ranking = await rank_candidates(eligible, results, req, self.catalog, self.model)
        shortlist = [i.product_id for i in ranking.items][:MAX_SHORTLIST]
        data = {**run["data"], "ranking": ranking.model_dump(mode="json"), "shortlist": shortlist}
        if not eligible:
            data["no_match"] = explain_no_match(results)
        if run["photo_id"] and not shortlist:
            data["preview_notice"] = ("No top met every must-have, so your photo has not been used yet. "
                                      "You can still try on any of the closest matches below.")
            next_state = "complete"
        elif run["photo_id"]:
            data["preview_notice"] = self._create_first_jobs(run, shortlist)
            next_state = "previewing"
        else:
            data["preview_notice"] = "No photo was provided, so no try-on previews were generated."
            next_state = "complete"
        self.store.update_run(run["id"], state=next_state if shortlist else "complete", data=data)

    def _create_first_jobs(self, run: dict, shortlist: list[str]) -> str | None:
        remaining = self.settings.max_previews_per_session - self.store.previews_used(run["session_id"])
        notice = None
        sample = (self.store.get_photo(run["photo_id"]) or {}).get("is_sample")
        for product_id in shortlist:
            if sample and self._cache_path(product_id, ".jpg").exists():
                self.store.create_job(run["id"], run["session_id"], product_id, 1)  # cached: costs no units
            elif remaining > 0:
                self.store.create_job(run["id"], run["session_id"], product_id, 1)
                remaining -= 1
            else:
                notice = f"This session's limit of {self.settings.max_previews_per_session} previews has been reached."
                self.store.create_job(run["id"], run["session_id"], product_id, 1, status="skipped", error=notice)
        return notice

    async def _advance_previews(self, run: dict) -> None:
        jobs = self.store.jobs_for_run(run["id"])
        for job in jobs:
            if job["status"] == "pending":
                await self._submit(run, job)
            elif job["status"] == "running" and job["next_poll_at"] <= time.time():
                await self._poll(run, job)
            elif job["status"] == "inspecting":
                await self._inspect(run, job)
        jobs = self.store.jobs_for_run(run["id"])
        if not any(j["status"] in ACTIVE_JOB_STATUSES for j in jobs):
            self.store.update_run(run["id"], state="complete")

    async def _ensure_person_file(self, photo: dict) -> str:
        """The file ID is persisted, so a resumed job never uploads the photo twice."""
        if photo["youcam_file_id"]:
            return photo["youcam_file_id"]
        file_id = await self.youcam.upload_image(Path(photo["path"]).read_bytes(), "person.jpg", "image/jpg")
        self.store.set_photo_file_id(photo["id"], file_id)
        return file_id

    async def _submit(self, run: dict, job: dict) -> None:
        sample = run["photo_id"] and (self.store.get_photo(run["photo_id"]) or {}).get("is_sample")
        if sample and self._use_cached_example(run, job, SAMPLE_EXAMPLE):
            return
        cap = self.settings.max_tasks_per_day
        unavailable = None
        if not self.youcam.configured:
            unavailable = "Live try-on is unavailable because YouCam is not configured on this server."
        elif cap > 0 and self.store.tasks_submitted_today() >= cap:
            unavailable = "Today's live try-on limit for this demo has been reached."
        if unavailable:
            # A pre-generated example is shown instead when one exists, clearly marked as not the shopper's photo.
            if not self._use_cached_example(run, job, FALLBACK_EXAMPLE, notice=unavailable):
                self.store.update_job(job["id"], status="failed", error=unavailable)
            return
        photo = self.store.get_photo(run["photo_id"])
        product = self.catalog.get(job["product_id"])
        if photo is None or product is None:
            self.store.update_job(job["id"], status="failed", error="The photo or product is no longer available.")
            return
        try:
            src = await self._ensure_person_file(photo)
            ref = job["garment_file_id"]
            if not ref:
                path = self.catalog.image_path(product)
                content_type = mimetypes.guess_type(path.name)[0] or "image/png"
                ref = await self.youcam.upload_image(path.read_bytes(), path.name, content_type.replace("jpeg", "jpg"))
                self.store.update_job(job["id"], garment_file_id=ref)
            task_id = await self.youcam.create_task(src, ref)
        except YouCamError as exc:
            # A failed create may still have started a task, so it is not repeated automatically.
            self.store.update_job(job["id"], status="failed", error=str(exc))
            return
        self.store.update_job(job["id"], status="running", youcam_task_id=task_id, submitted_at=now(),
                              next_poll_at=time.time() + self.settings.poll_interval_seconds)

    async def _poll(self, run: dict, job: dict) -> None:
        next_poll = time.time() + self.settings.poll_interval_seconds
        try:
            result = await self.youcam.get_task(job["youcam_task_id"])
        except YouCamError as exc:
            if exc.retryable and not self._timed_out(job):
                self.store.update_job(job["id"], next_poll_at=next_poll)
            else:
                self.store.update_job(job["id"], status="failed", error=str(exc))
            return
        if result.status == "running":
            if self._timed_out(job):
                self.store.update_job(job["id"], status="failed", error="YouCam did not finish this preview in time.")
            else:
                self.store.update_job(job["id"], next_poll_at=next_poll)
            return
        if result.status == "error":
            self.store.update_job(job["id"], status="failed", error=f"YouCam could not create this preview: {result.error}")
            return
        try:
            image = await self.youcam.download(result.url)
        except YouCamError as exc:
            self.store.update_job(job["id"], status="failed", error=str(exc))
            return
        if not self.store.session_exists(run["session_id"]):
            return  # deleted while this was in flight
        output = self.store.session_dir(run["session_id"]) / f"preview_{job['id']}.jpg"
        output.write_bytes(image)
        if (self.store.get_photo(run["photo_id"]) or {}).get("is_sample"):
            shutil.copyfile(output, self._cache_path(job["product_id"], ".jpg"))
            self._cache_path(job["product_id"], ".meta.json").write_text(json.dumps(
                {"product_id": job["product_id"], "youcam_task_id": job["youcam_task_id"], "created_at": now(), "person": "sample model"}))
        self.store.update_job(job["id"], status="inspecting", output_path=str(output))
        await self._inspect(run, {**job, "output_path": str(output)})

    async def _inspect(self, run: dict, job: dict) -> None:
        product = self.catalog.get(job["product_id"])
        inspection = await inspect_preview(self.catalog.image_path(product), Path(job["output_path"]), self.model)
        self.store.update_job(job["id"], status="done", inspection=inspection.model_dump(mode="json"))
        sample = (self.store.get_photo(run["photo_id"]) or {}).get("is_sample")
        if sample and inspection.method == "model":
            self._cache_path(job["product_id"], ".json").write_text(json.dumps(inspection.model_dump(mode="json")))

    def _cache_path(self, product_id: str, suffix: str) -> Path:
        # Committed with the repository, so pre-generated examples survive a fresh checkout.
        folder = self.settings.cached_demo_dir
        folder.mkdir(parents=True, exist_ok=True)
        return folder / f"{product_id}{suffix}"

    def _use_cached_example(self, run: dict, job: dict, kind: int, notice: str | None = None) -> bool:
        """Serves a real try-on made earlier with the sample model. It is always labeled as a pre-generated example."""
        image = self._cache_path(job["product_id"], ".jpg")
        if not image.exists() or not self.store.session_exists(run["session_id"]):
            return False
        output = self.store.session_dir(run["session_id"]) / f"preview_{job['id']}.jpg"
        shutil.copyfile(image, output)
        saved = self._cache_path(job["product_id"], ".json")
        fields = dict(cached=kind, output_path=str(output), error=notice)
        if saved.exists():
            self.store.update_job(job["id"], status="done", inspection=json.loads(saved.read_text()), **fields)
        else:
            self.store.update_job(job["id"], status="inspecting", **fields)
        return True

    def _timed_out(self, job: dict) -> bool:
        started = job["submitted_at"] or job["created_at"]
        return _age_seconds(started) > self.settings.task_timeout_seconds

    def retry_preview(self, run: dict, product_id: str) -> str:
        """Allows one retry per session, for a preview that failed or looks questionable."""
        if self.store.retries_used(run["session_id"]) >= self.settings.max_retries_per_session:
            raise RetryNotAllowed("This session's retry has already been used.")
        attempts = [j for j in self.store.jobs_for_run(run["id"]) if j["product_id"] == product_id]
        if not attempts:
            raise RetryNotAllowed("That product has no preview in this run.")
        latest = attempts[-1]
        if latest["status"] in ACTIVE_JOB_STATUSES:
            raise RetryNotAllowed("That preview is still being created.")
        if latest["status"] == "skipped":
            raise RetryNotAllowed("That preview was not attempted because of the session limit.")
        if latest["status"] == "done" and (latest["inspection"] or {}).get("status") == PreviewStatus.NO_MISMATCH.value:
            raise RetryNotAllowed("No visible mismatch was detected, so no retry is needed.")
        if latest["status"] == "done" and (latest["inspection"] or {}).get("method") == "unavailable":
            raise RetryNotAllowed("The preview was not inspected, and a new preview would not change that.")
        job_id = self.store.create_job(run["id"], run["session_id"], product_id, latest["attempt"] + 1)
        self.store.update_run(run["id"], state="previewing")
        return job_id

    def try_on(self, run: dict, product_id: str) -> str:
        """Creates a preview for a product the shopper picked themselves, such as a closest match. Eligibility is unchanged."""
        if not run["photo_id"]:
            raise RetryNotAllowed("This search has no photo. Add one to a new search to try things on.")
        if product_id not in run["data"].get("results", {}):
            raise RetryNotAllowed("That product is not part of this search.")
        if self.store.has_job(run["id"], product_id):
            raise RetryNotAllowed("That product already has a preview in this search.")
        cached = (self.store.get_photo(run["photo_id"]) or {}).get("is_sample") and self._cache_path(product_id, ".jpg").exists()
        if not cached and self.store.previews_used(run["session_id"]) >= self.settings.max_previews_per_session:
            raise RetryNotAllowed(f"This session's limit of {self.settings.max_previews_per_session} previews has been reached.")
        job_id = self.store.create_job(run["id"], run["session_id"], product_id, 1)
        self.store.update_run(run["id"], state="previewing")
        return job_id

    def reinspect(self, run: dict, product_id: str) -> str:
        """Runs the inspection again when the model was unavailable. It reuses the saved preview, so it costs no YouCam units."""
        attempts = [j for j in self.store.jobs_for_run(run["id"]) if j["product_id"] == product_id]
        latest = attempts[-1] if attempts else None
        if latest is None or latest["status"] != "done" or not latest["output_path"]:
            raise RetryNotAllowed("There is no finished preview to check.")
        if (latest["inspection"] or {}).get("method") != "unavailable":
            raise RetryNotAllowed("This preview has already been checked.")
        self.store.update_job(latest["id"], status="inspecting")
        self.store.update_run(run["id"], state="previewing")
        return latest["id"]


def _age_seconds(stamp: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds()
