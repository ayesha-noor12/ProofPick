# Pre-generated examples

Real YouCam try-ons made with the consenting sample model (`../sample/model.jpg`). They are filled automatically:
each successful live try-on that uses the sample photo saves `<product_id>.jpg`, its inspection (`<product_id>.json`)
and provenance (`<product_id>.meta.json`, with the YouCam task id and date) here.

The app always labels these "Pre-generated example". It serves them for the sample model, and in place of a live
try-on only when `YOUCAM_API_KEY` is missing or the daily cap is reached, then marked "not your photo".
Never add images here that were not produced this way.
