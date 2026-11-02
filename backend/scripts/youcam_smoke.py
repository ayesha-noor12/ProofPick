"""Phase 1 check: creates one real YouCam preview. This uses real API units.

Usage from backend/: .venv/bin/python -m scripts.youcam_smoke PERSON.jpg GARMENT.png OUTPUT.jpg
"""

import asyncio
import sys
import time
from pathlib import Path

from app.config import get_settings
from app.youcam_client import YouCamClient


def content_type(path: Path) -> str:
    return "image/png" if path.suffix.lower() == ".png" else "image/jpg"


async def main(person: Path, garment: Path, output: Path) -> None:
    settings = get_settings()
    if not settings.youcam_api_key:
        sys.exit("YOUCAM_API_KEY is not set.")
    client = YouCamClient(settings.youcam_api_key, settings.youcam_base_url)
    src = await client.upload_image(person.read_bytes(), person.name, content_type(person))
    ref = await client.upload_image(garment.read_bytes(), garment.name, content_type(garment))
    print("Uploaded both images.")
    task_id = await client.create_task(src, ref)
    print(f"Task created: {task_id}")
    started = time.time()
    while time.time() - started < settings.task_timeout_seconds:
        result = await client.get_task(task_id)
        if result.status == "success":
            output.write_bytes(await client.download(result.url))
            print(f"Saved {output} after {time.time() - started:.0f}s.")
            return
        if result.status == "error":
            sys.exit(f"YouCam reported an error: {result.error}")
        await asyncio.sleep(settings.poll_interval_seconds)
    sys.exit("Timed out waiting for YouCam.")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    asyncio.run(main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])))
