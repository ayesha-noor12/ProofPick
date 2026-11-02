"use client";

import { useRef, useState } from "react";
import { api, AppConfig } from "@/lib/api";
import { Button, ErrorNote, IconCamera, IconInfo, IconUpload, Spinner } from "./ui";

const MAX_SIDE = 2048;

/** Re-encodes any image the browser can open as a JPEG of at most 2048px, so size and format never block an upload. */
export async function normalize(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject()), "image/jpeg", 0.92));
  } catch {
    return file; // The server does its own checks and explains any problem.
  }
}

export function PhotoPicker({ config, photoId, onChange }: { config: AppConfig | null; photoId: string | null; onChange: (id: string | null) => void }) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  async function send(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      onChange((await api.uploadPhoto(form)).photo_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!consent) {
      setError("Please tick the consent box first.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("That file is not an image.");
      return;
    }
    const form = new FormData();
    form.set("file", await normalize(file), "photo.jpg");
    form.set("consent", "true");
    form.set("adult", "true");
    void send(form);
  }

  function useSample() {
    const form = new FormData();
    form.set("use_sample", "true");
    void send(form);
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-ink"><IconCamera className="size-4 text-brand" />Try-on photo <span className="text-sm font-normal text-muted">optional</span></h3>
          <p className="mt-1 text-sm text-muted">A front-facing photo from the waist up works best. Any size or image format.</p>
        </div>
      </div>

      {photoId ? (
        <div className="mt-5 flex flex-wrap items-center gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/photos/${photoId}/image`} alt="Your selected try-on photo" onError={() => onChange(null)}
            className="h-36 w-28 rounded-xl object-cover ring-1 ring-line" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Photo ready. Previews will be made for your top 3 picks.</p>
            <Button variant="quiet" size="sm" onClick={() => onChange(null)}>Use a different photo</Button>
          </div>
        </div>
      ) : (
        <>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl bg-sand px-3.5 py-3 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 size-4 flex-none" checked={consent} onChange={(e) => { setConsent(e.target.checked); setError(null); }} />
            This photo shows an adult, and I have their consent to send it to the providers listed below.
          </label>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files?.[0]); }}
            className={`mt-3 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${dragging ? "border-brand bg-brand-soft" : "border-line-strong"} ${consent ? "" : "opacity-60"}`}>
            {busy ? (
              <p className="flex items-center gap-2 text-sm text-ink" role="status"><Spinner className="size-4 text-brand" />Uploading…</p>
            ) : (
              <>
                <span className="grid size-10 place-items-center rounded-full bg-sand text-muted"><IconUpload className="size-5" /></span>
                <p className="text-sm text-muted"><span className="font-medium text-ink">Drop a photo here</span> or</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="quiet" size="sm" disabled={!consent} onClick={() => fileInput.current?.click()}>Choose a file</Button>
                  <Button variant="quiet" size="sm" disabled={!consent} onClick={() => cameraInput.current?.click()} className="sm:hidden">Take a photo</Button>
                  {config?.sample_photo_available && <Button variant="ghost" size="sm" onClick={useSample}>Use the sample model</Button>}
                </div>
              </>
            )}
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={cameraInput} type="file" accept="image/*" capture="user" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </>
      )}
      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
      {config && (
        <p className="mt-4 flex gap-2 text-xs leading-relaxed text-muted">
          <IconInfo className="mt-px size-3.5 flex-none" />
          <span>Who receives the photo: {config.privacy.providers.join("; ")}. {config.privacy.retention}</span>
        </p>
      )}
    </section>
  );
}
