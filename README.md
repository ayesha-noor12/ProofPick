# ProofPick

**Find it. Check it. Try it on.**

ProofPick recommends tops for shoppers with specific requirements. It checks each requirement against product evidence, creates try-on previews with the YouCam Clothes VTO API, and inspects whether those previews preserve the garment's visible details. When information is missing or a preview may mislead, it says so.

> **Two catalogs:** `backend/data/catalog.json` holds 16 fictional demo products with illustrated images, labeled as demo data. The **Catalog** page adds real garments the team photographed, each with a care-label photo as composition evidence. Prices on real garments are reference prices; nothing is for sale and no stock is claimed.

## How it works

1. **Describe:** the request becomes editable requirements, split into non-negotiable fields and preferences. Nothing is searched until the shopper confirms.
<img width="574" height="619" alt="Screenshot from 2026-11-02 20-59-24" src="https://github.com/user-attachments/assets/8fb0c48a-4a17-4d59-9bf5-4a05137d7f98" />

3. **Check products:** backend rules compare each requirement with the evidence and return `meets_documented_requirements`, `conflicts_with_requirement` or `insufficient_evidence`.
5. **Rank:** the model orders eligible products by preference. It cannot change eligibility, and any invented product or evidence ID is rejected.
6. **Try on:** up to three shortlisted products go to YouCam with the shopper's photo.
<img width="581" height="461" alt="Screenshot from 2026-11-02 21-00-22" src="https://github.com/user-attachments/assets/933a8016-15a0-447a-8714-d2ea93750b42" />

8. **Inspect:** the model compares each original garment with its preview, feature by feature. The result is `no_visible_mismatch_detected`, `possible_mismatch` or `not_assessable`.
9. **Compare:** each card shows the price, the checks, their source evidence, the preview with a before/after slider, and any uncertainty. The **Evidence matrix** view puts requirements in rows and products in columns, each cell Verified, Conflict or Unknown with its source. The shopper decides; ProofPick never buys anything.
<img width="627" height="628" alt="Screenshot from 2026-11-02 21-00-36" src="https://github.com/user-attachments/assets/50b700a6-f523-44ab-91c4-3ebb048bbb93" />

11. **No match:** ProofPick shows what blocks the request, what dropping each must-have would unlock, and the closest matches. It never relaxes a must-have by itself: the shopper clicks "Search without it", and can still choose to try on a closest match, which stays labeled as not recommended.
<img width="627" height="628" alt="Screenshot from 2026-11-02 21-00-45" src="https://github.com/user-attachments/assets/e1bd55d0-c27b-483a-ac9c-d2d9a279391e" />
<img width="627" height="628" alt="Screenshot from 2026-11-02 21-00-54" src="https://github.com/user-attachments/assets/5fafc9f1-6ab3-4fc2-ad74-284f8cc2e5d5" />


Product verification and preview inspection are separate systems, so a bad preview can never make a suitable product look unsuitable.

### What ProofPick does not claim

It does not verify physical fit, comfort, opacity under real lighting, or exact color. Style fit is a judgment, not a verified fact. It never scores a person's body or attractiveness.

## YouCam integration

All authenticated calls run on the server, in `backend/app/youcam_client.py`:

| Step | Call |
|---|---|
| Request upload slots and file IDs | `POST /s2s/v2.0/file` |
| Upload the person and garment images | `PUT` to the returned URL |
| Create the task with `garment_category: upper_body` | `POST /s2s/v2.0/task/cloth-v4` |
| Poll about every 10 seconds | `GET /s2s/v2.0/task/cloth-v4/{task_id}` |
| Save the result, whose URL lasts two hours | `GET` the returned URL |

Task and file IDs are saved in SQLite, so a restart resumes an existing task instead of creating a duplicate. Each session gets three previews and one retry, and `PROOFPICK_MAX_TASKS_PER_DAY` caps the whole deployment.

## Run it locally

You need Python 3.11+ and Node 20+.

```bash
cp .env.example .env      # add YOUCAM_API_KEY and GEMINI_API_KEY

cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000 --reload   # --reload picks up code changes

# in a second terminal
cd frontend
npm install
npm run dev               # http://localhost:3000
```

Without keys the app still runs and says what is unavailable:

| Missing | Behavior |
|---|---|
| `YOUCAM_API_KEY` | Previews show as unavailable. No image is faked. |
| `GEMINI_API_KEY` | Parsing and ranking use labeled basic rules. Previews show "Could not be checked". |

The model is Google Gemini, `gemini-3.6-flash` by default (set `PROOFPICK_MODEL` to change it). Get a key at Google AI Studio. On Gemini's free tier, Google may use submitted content, including preview images, to improve its products; use a paid key if that is not acceptable.

To offer the sample model button, add a photo of a consenting adult at `backend/data/sample/model.jpg`.

Create one real preview from the command line (this uses API units):

```bash
cd backend
.venv/bin/python -m scripts.youcam_smoke person.jpg data/catalog_images/top_001.png out.jpg
```

## How to test in 2 minutes

Start both servers (above) and open http://localhost:3000. No keys are needed for steps 1–4.

| Step | Do this | You should see |
|---|---|---|
| 1 | Click the chip **"A high-neck top up to $60 in black or forest, no polyester"**, then **Read my request**. | "Is this right?" with $60, High neck, No polyester as must-haves and black, forest as colors. Nothing has been searched yet. |
| 2 | Choose **Demo catalog** under "Search in" (it is preselected when there are no real listings) and click **Confirm and find tops**. | Results with all three states: **Verified** top picks, **Missing information** (Unknown) and **Ruled out** (Conflict). Each pick has "Why ranked #n" lines and "Ranking never changes eligibility." |
| 3 | Click **Evidence matrix**, then any must-have cell. | Shortlist columns, must-have and preference rows. The panel shows the snippet, source type, collection date and a **DEMO DATA** badge (real listings show **View listing on {retailer}**). |
| 4 | Back on the start page, search **"A sleeveless collared top under $20, no cotton"**. | "No top matches every must-have", what blocks it, the closest matches, and **Search without it** buttons. Nothing is relaxed until you click. |
| 5 | On the confirm screen, click **Use the sample model** (or upload a photo) and confirm. | The **Fitting room**: your photo as Original, the try-on as Result. Open **Detail check** for the preview integrity table. |

About step 5:
- **Sample model:** put a photo of a consenting adult at `backend/data/sample/model.jpg` to enable the button.
- **Pre-generated examples:** every successful live try-on with the sample model is saved in `backend/data/cached_demo/` and reused afterwards, labeled **"Pre-generated example"**. When `YOUCAM_API_KEY` is missing or the daily cap is reached, an existing example is shown instead of a live try-on, labeled **"Pre-generated example with the sample model, not your photo"**. Examples are never presented as live. Run each demo search once with the sample model before judging to fill the folder, and commit it.
- **Daily cap:** `PROOFPICK_MAX_TASKS_PER_DAY` caps live YouCam tasks per UTC day for the whole deployment. Raise it for the judging window, or set it to `0` to turn the cap off.

## Add real garments

Open **Catalog** (`/garments`). For each top you own, add a flat, front-facing photo, a close-up of the care label, the color, a reference price, and the sleeves and neckline you can see. The label is transcribed by Gemini into composition evidence with the source "Care label photo"; an illegible label is recorded as missing, never guessed. You can also type the composition, which is stored as a second source, so a disagreement between the two shows as Unknown.

Include tricky garments: a cotton blend, one without a label, and one whose sleeve length you enter wrongly on purpose. Garments are saved in `backend/data/real_garments.json` and `backend/data/real_garment_images/`. On a public deployment, set `PROOFPICK_ALLOW_CATALOG_EDITS=false`.

## Tests and evaluation

```bash
cd backend
.venv/bin/python -m pytest          # YouCam and the model are mocked
.venv/bin/python -m eval.run_eval   # writes eval/results.md
```

For real garments, copy `backend/eval/real_cases.example.json` to `real_cases.json` and label each garment by its physical truth. The report lists every failure, including ones caused by wrong owner entries or unreadable labels.

The evaluation compares the verifier and an ordinary catalog filter on 12 hand-labeled requests. See [the latest results](backend/eval/results.md). The labels were written by the same people as the rules, against a fictional catalog, so this shows the logic behaves as specified. It does not measure real-world accuracy.

## Use real products

Replace `backend/data/catalog.json` and `backend/data/catalog_images/` with products you have permission to use, keeping each item's source and collection date. YouCam asks for a front-facing, single-garment JPEG or PNG of at least 512×384 pixels, under 10 MB. `backend/scripts/build_catalog.py` shows the expected format.

## Deploy

- **Backend:** run one process (`uvicorn app.main:app`), because the worker lives inside it. Mount persistent storage at `PROOFPICK_VAR_DIR` and set `PROOFPICK_COOKIE_SECURE=true`.
- **Frontend:** run `next build` and `next start` with `BACKEND_URL` pointing to the backend. The browser only talks to the frontend, which proxies `/api/*`.

## Privacy

API keys stay on the server. Uploads must be JPEG or PNG and are re-encoded to remove metadata. Photos and previews are stored privately and served only to their session. Signed URLs are kept out of logs.

YouCam documents keeping uploaded and generated files for 30 days. **Delete my data** removes ProofPick's copies right away, but it does not delete copies held by providers.

## Project layout

```
backend/app/       product_verifier, recommender, requirements_parser, preview_inspector,
                   youcam_client, pipeline, worker, storage, main
backend/eval/      labeled cases, baseline comparison and results
backend/scripts/   demo catalog builder and YouCam smoke test
backend/app/garments.py  real-garment intake and care-label transcription
frontend/          Next.js pages: search, results (cards and evidence matrix), my searches, catalog, how it works
```
