import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, File, Form, HTTPException, Response, UploadFile
from pydantic import TypeAdapter
from fastapi.responses import FileResponse

from .catalog import Catalog
from .config import Settings, get_settings
from .garments import build_garment, read_care_label
from .images import InvalidImage, sanitize_photo
from .llm import ModelClient
from .pipeline import Pipeline, RetryNotAllowed
from .recommender import preference_matches, why_lines
from .requirements_parser import parse_requirements
from .schemas import Neckline, ParsedRequirements, ParseRequest, PhotoOut, ProductResult, RecommendationRequest, Requirements, RetryRequest, Sleeve
from .storage import Store
from .worker import Worker
from .youcam_client import YouCamClient

# httpx logs full request URLs at INFO, which would include signed image URLs.
logging.getLogger("httpx").setLevel(logging.WARNING)

COOKIE = "pp_session"
MAX_RUNS_PER_SESSION = 25
MAX_PARSES_PER_SESSION = 30
PROVIDER_NOTICE = {
    "providers": ["YouCam (Perfect Corp) creates the try-on",
                  "Google Gemini inspects the preview image (on Gemini's free tier, Google may use it to improve its products)"],
    "retention": ("YouCam documents keeping uploaded and generated files for 30 days. Deleting your session removes "
                  "ProofPick's copies right away, but does not delete copies held by those providers."),
}


def build_app(settings: Settings | None = None, *, youcam: YouCamClient | None = None, model: ModelClient | None = None,
              start_worker: bool = True) -> FastAPI:
    settings = settings or get_settings()
    store = Store(settings.var_dir)
    catalog = Catalog.load(settings.catalog_path, settings.catalog_images_dir, settings.real_catalog_path, settings.real_images_dir,
                           settings.real_listings_path)
    youcam = youcam or YouCamClient(settings.youcam_api_key, settings.youcam_base_url)
    model = model or ModelClient(settings.gemini_api_key, settings.model)
    pipeline = Pipeline(store, catalog, youcam, model, settings)
    parse_counts: dict[str, int] = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(Worker(pipeline).run_forever()) if start_worker else None
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="ProofPick", lifespan=lifespan)
    app.state.pipeline = pipeline
    app.state.worker = Worker(pipeline)

    def session(response: Response, pp_session: str | None = Cookie(default=None)) -> str:
        session_id = store.ensure_session(pp_session)
        if session_id != pp_session:
            response.set_cookie(COOKIE, session_id, httponly=True, samesite="lax", secure=settings.cookie_secure, max_age=86400)
        return session_id

    def owned_run(run_id: str, session_id: str = Depends(session)) -> dict:
        run = store.get_run(run_id)
        if run is None or run["session_id"] != session_id:
            raise HTTPException(404, "Run not found.")
        return run

    def image_url(evidence_image: str | None) -> str | None:
        return f"/api/catalog-images/{evidence_image}" if evidence_image else None

    def evidence_view(evidence_id: str) -> dict | None:
        e = catalog.evidence(evidence_id)
        if e is None:
            return None
        return {"id": e.id, "field": e.field, "kind": e.kind, "source": e.source, "source_type": e.source_type,
                "source_url": e.source_url, "quote": e.quote, "image_url": image_url(e.image), "collected_at": e.collected_at}

    def check_view(check: dict) -> dict:
        return {**check, "evidence": [v for i in check["evidence_ids"] if (v := evidence_view(i))]}

    def job_view(job: dict) -> dict:
        return {
            "id": job["id"], "attempt": job["attempt"], "status": job["status"], "error": job["error"], "cached": job.get("cached") or 0,
            "inspection": job["inspection"],
            "image_url": f"/api/runs/{job['run_id']}/previews/{job['id']}/image" if job["output_path"] else None,
        }

    def product_card(product_id: str, data: dict, jobs: list[dict], explanation: str | None = None, req: dict | None = None) -> dict:
        product = catalog.get(product_id)
        result = data["results"][product_id]
        requirements = Requirements.model_validate(req or {})
        prefs = preference_matches(product, requirements)
        return {
            "product_id": product.id, "name": product.name, "brand": product.brand, "variant": product.variant,
            "color": product.color, "price": product.price, "currency": product.currency, "description": product.description,
            "image_url": image_url(product.image), "data_label": product.data_label, "collected_at": product.collected_at,
            "is_demo": product.is_demo, "is_owned": product.is_owned, "retailer_name": product.retailer_name,
            # Demo products never carry a link, so nothing can present demo data as a real listing.
            "product_url": None if product.is_demo else product.product_url, "tags": product.tags,
            "status": result["status"], "checks": [check_view(c) for c in result["checks"]], "explanation": explanation,
            "previews": [job_view(j) for j in jobs if j["product_id"] == product_id],
            "preferences": prefs,
            "why": why_lines(ProductResult.model_validate(result), prefs, requirements),
            # Everything the sources document, for the card's detail list. Price, stock and image are shown elsewhere.
            "documented": [evidence_view(e.id) for e in product.evidence
                           if e.kind == "text" and e.quote and e.field not in ("price", "availability")],
        }

    @app.get("/api/config")
    def config():
        return {
            "youcam_configured": youcam.configured, "model_configured": model.configured,
            "sample_photo_available": settings.sample_photo_path.exists(), "catalog_size": len(catalog.products),
            "real_garments": len(catalog.real),
            "privacy": PROVIDER_NOTICE,
        }

    @app.post("/api/requirements/parse", response_model=ParsedRequirements)
    async def parse(body: ParseRequest, session_id: str = Depends(session)):
        parse_counts[session_id] = parse_counts.get(session_id, 0) + 1
        if parse_counts[session_id] > MAX_PARSES_PER_SESSION:
            raise HTTPException(429, "This session has reached its request limit.")
        return await parse_requirements(body.text, model)

    @app.post("/api/photos", response_model=PhotoOut)
    async def upload_photo(file: UploadFile | None = File(default=None), use_sample: bool = Form(default=False),
                           consent: bool = Form(default=False), adult: bool = Form(default=False),
                           session_id: str = Depends(session)):
        if use_sample:
            if not settings.sample_photo_path.exists():
                raise HTTPException(404, "No sample photo is available on this server.")
            raw = settings.sample_photo_path.read_bytes()
        else:
            if not (consent and adult):
                raise HTTPException(400, "Please confirm that this is an adult's photo and that you have consent to use it.")
            if file is None:
                raise HTTPException(400, "Please choose a photo.")
            raw = await file.read(10 * 1024 * 1024 + 1)
        try:
            data, width, height = sanitize_photo(raw)
        except InvalidImage as exc:
            raise HTTPException(400, str(exc)) from exc
        photo_id = store.add_photo(session_id, data, width, height, is_sample=use_sample)
        return PhotoOut(photo_id=photo_id, width=width, height=height, is_sample=use_sample)

    @app.get("/api/photos/{photo_id}/image")
    def photo_image(photo_id: str, session_id: str = Depends(session)):
        photo = store.get_photo(photo_id)
        if photo is None or photo["session_id"] != session_id:
            raise HTTPException(404, "Photo not found.")
        return FileResponse(photo["path"], media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})

    @app.post("/api/recommendations", status_code=202)
    def start_recommendations(body: RecommendationRequest, session_id: str = Depends(session)):
        if store.count_runs(session_id) >= MAX_RUNS_PER_SESSION:
            raise HTTPException(429, "This session has reached its search limit.")
        if body.photo_id:
            photo = store.get_photo(body.photo_id)
            if photo is None or photo["session_id"] != session_id:
                raise HTTPException(400, "That photo is not available.")
        run_id = store.create_run(session_id, body.original_text, body.requirements.model_dump(mode="json"), body.photo_id)
        store.update_run(run_id, data={"scope": body.scope})
        return {"run_id": run_id}

    @app.get("/api/runs")
    def list_runs(session_id: str = Depends(session)):
        """This session's searches, newest first, so a shopper can return to any of them."""
        items = []
        for run in store.runs_for_session(session_id):
            data = run["data"]
            items.append({
                "run_id": run["id"], "state": run["state"], "original_text": run["original_text"],
                "requirements": run["requirements"], "created_at": run["created_at"], "has_photo": bool(run["photo_id"]),
                "matches": len(data.get("ranking", {}).get("items", [])),
                "top_images": [image_url(catalog.get(p).image) for p in data.get("shortlist", []) if catalog.get(p)],
            })
        return {"runs": items}

    @app.get("/api/runs/{run_id}")
    def get_run(run: dict = Depends(owned_run)):
        data, jobs, req = run["data"], store.jobs_for_run(run["id"]), run["requirements"]
        report = {"run_id": run["id"], "state": run["state"], "error": run["error"], "requirements": run["requirements"],
                  "original_text": run["original_text"], "has_photo": bool(run["photo_id"]), "photo_id": run["photo_id"], "scope": data.get("scope", "all")}
        if "ranking" not in data:
            return report
        # A garment the team deleted after this search simply drops out of the report.
        explanations = {i["product_id"]: i["explanation"] for i in data["ranking"]["items"] if catalog.get(i["product_id"])}
        shortlist = [p for p in data["shortlist"] if catalog.get(p)]
        results = data["results"]
        retries_left = max(0, settings.max_retries_per_session - store.retries_used(run["session_id"]))
        return {
            **report,
            "ranking_method": data["ranking"]["method"],
            "recommendations": [product_card(p, data, jobs, explanations.get(p), req) for p in shortlist],
            "needs_information": [product_card(p, data, jobs, None, req) for p, r in results.items() if r["status"] == "insufficient_evidence" and catalog.get(p)],
            "excluded": [product_card(p, data, jobs, None, req) for p, r in results.items() if r["status"] == "conflicts_with_requirement" and catalog.get(p)],
            "other_eligible": [product_card(p, data, jobs, explanations.get(p), req) for p in explanations if p not in shortlist],
            "no_match": data.get("no_match"),
            "preview_notice": data.get("preview_notice"),
            "retries_remaining": retries_left,
        }

    @app.get("/api/runs/{run_id}/previews/{job_id}/image")
    def preview_image(job_id: str, run: dict = Depends(owned_run)):
        job = store.get_job(job_id)
        if job is None or job["run_id"] != run["id"] or not job["output_path"]:
            raise HTTPException(404, "Preview not found.")
        return FileResponse(job["output_path"], media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})

    @app.post("/api/runs/{run_id}/retry-preview", status_code=202)
    def retry_preview(body: RetryRequest, run: dict = Depends(owned_run)):
        try:
            return {"job_id": pipeline.retry_preview(run, body.product_id)}
        except RetryNotAllowed as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/api/runs/{run_id}/try-on", status_code=202)
    def try_on(body: RetryRequest, run: dict = Depends(owned_run)):
        try:
            return {"job_id": pipeline.try_on(run, body.product_id)}
        except RetryNotAllowed as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/api/runs/{run_id}/reinspect", status_code=202)
    def reinspect(body: RetryRequest, run: dict = Depends(owned_run)):
        try:
            return {"job_id": pipeline.reinspect(run, body.product_id)}
        except RetryNotAllowed as exc:
            raise HTTPException(409, str(exc)) from exc

    def garment_view(p) -> dict:
        return {"product_id": p.id, "name": p.name, "color": p.color, "price": p.price, "description": p.description,
                "image_url": image_url(p.image), "collected_at": p.collected_at, "tags": p.tags,
                "evidence": [evidence_view(e.id) for e in p.evidence if e.kind == "text"]}

    def require_edits() -> None:
        if not settings.allow_catalog_edits:
            raise HTTPException(403, "Adding garments is turned off on this server.")

    @app.get("/api/garments")
    def list_garments():
        return {"garments": [garment_view(p) for p in catalog.owned], "editable": settings.allow_catalog_edits,
                "demo_count": len(catalog.products) - len(catalog.real), "listing_count": len(catalog.real) - len(catalog.owned)}

    @app.post("/api/garments", status_code=201)
    async def add_garment(name: str = Form(min_length=1, max_length=80), price: float = Form(ge=0, le=10000),
                          color: str = Form(min_length=1, max_length=40), sleeves: str = Form(default=""), neckline: str = Form(default=""),
                          description: str = Form(default="", max_length=400), tags: str = Form(default=""),
                          composition: str = Form(default="", max_length=140), garment: UploadFile = File(...),
                          label: UploadFile | None = File(default=None), label_composition: str = Form(default="", max_length=140)):
        require_edits()
        try:
            sleeve = TypeAdapter(Sleeve | None).validate_python(sleeves or None)
            neck = TypeAdapter(Neckline | None).validate_python(neckline or None)
        except ValueError as exc:
            raise HTTPException(400, "Unknown sleeve or neckline value.") from exc
        label_bytes = await label.read(10 * 1024 * 1024 + 1) if label and label.filename else None
        try:
            product, notes = await build_garment(
                name=name, price=price, color=color, sleeves=sleeve, neckline=neck, description=description,
                tags=[t.strip().lower() for t in tags.split(",") if t.strip()], composition_text=composition,
                garment_photo=await garment.read(10 * 1024 * 1024 + 1), label_photo=label_bytes, label_composition=label_composition,
                images_dir=settings.real_images_dir)
        except InvalidImage as exc:
            raise HTTPException(400, str(exc)) from exc
        catalog.add_owned(product)
        return {"garment": garment_view(product), "notes": notes}

    @app.post("/api/garments/read-label")
    async def read_label(label: UploadFile = File(...)):
        """Transcribes a care label for the team to confirm or edit. Nothing is stored."""
        require_edits()
        try:
            composition, problem = await read_care_label(await label.read(10 * 1024 * 1024 + 1), model)
        except InvalidImage as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"composition": composition, "problem": problem}

    @app.delete("/api/garments/{product_id}")
    def delete_garment(product_id: str):
        require_edits()
        product = catalog.remove_owned(product_id)
        if product is None:
            raise HTTPException(404, "Garment not found.")
        for name in {product.image, *(e.image for e in product.evidence if e.image)}:
            (Path(settings.real_images_dir) / name).unlink(missing_ok=True)
        return {"deleted": True}

    @app.get("/api/catalog-images/{name}")
    def catalog_image(name: str):
        path = catalog.file_for(name)
        if path is None or not path.exists():
            raise HTTPException(404, "Image not found.")
        return FileResponse(path)

    @app.delete("/api/sessions/{session_id}")
    def delete_session(session_id: str, response: Response, current: str = Depends(session)):
        if session_id != current:
            raise HTTPException(404, "Session not found.")
        store.delete_session(session_id)
        response.delete_cookie(COOKIE)
        return {"deleted": True, "note": PROVIDER_NOTICE["retention"]}

    @app.get("/api/session")
    def get_session(session_id: str = Depends(session)):
        return {"session_id": session_id}

    return app


app = build_app()
