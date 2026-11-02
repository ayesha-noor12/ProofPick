"""Server-side client for YouCam Clothes VTO V4. Never log signed URLs or image data."""

from dataclasses import dataclass

import httpx


class YouCamError(Exception):
    def __init__(self, message: str, code: str | None = None, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass
class TaskResult:
    status: str  # "running" | "success" | "error"
    url: str | None = None
    error: str | None = None


class YouCamClient:
    def __init__(self, api_key: str, base_url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self._transport, timeout=60.0)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    @staticmethod
    def _raise_for_response(response: httpx.Response, action: str) -> dict:
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.is_success:
            return body
        code = body.get("error_code") or body.get("error")
        raise YouCamError(f"YouCam {action} failed with HTTP {response.status_code}: {code or 'no detail'}",
                          code=code, retryable=response.status_code == 429 or response.status_code >= 500)

    async def upload_image(self, data: bytes, file_name: str, content_type: str) -> str:
        """Requests an upload slot, PUTs the bytes to it and returns the file ID."""
        payload = {"files": [{"content_type": content_type, "file_name": file_name, "file_size": len(data)}]}
        async with self._client() as client:
            try:
                created = await client.post(f"{self.base_url}/s2s/v2.0/file", headers=self._headers(), json=payload)
                body = self._raise_for_response(created, "upload request")
                try:
                    entry = body["data"]["files"][0]
                    slot = entry["requests"][0]
                    file_id = entry["file_id"]
                except (KeyError, IndexError, TypeError) as exc:
                    raise YouCamError("YouCam upload response had an unexpected shape") from exc
                put = await client.request(slot.get("method", "PUT"), slot["url"], headers=slot.get("headers", {}), content=data)
            except httpx.HTTPError as exc:
                raise YouCamError(f"YouCam upload connection failed: {type(exc).__name__}", retryable=True) from exc
        if not put.is_success:
            raise YouCamError(f"YouCam file upload failed with HTTP {put.status_code}", retryable=put.status_code >= 500)
        return file_id

    async def create_task(self, src_file_id: str, ref_file_id: str) -> str:
        payload = {
            "src_file_id": src_file_id,
            "ref_file_id": ref_file_id,
            "garment_category": "upper_body",
            "filter_multi_person": "strict",
        }
        async with self._client() as client:
            try:
                response = await client.post(f"{self.base_url}/s2s/v2.0/task/cloth-v4", headers=self._headers(), json=payload)
            except httpx.HTTPError as exc:
                raise YouCamError(f"YouCam task request failed: {type(exc).__name__}", retryable=True) from exc
        body = self._raise_for_response(response, "task creation")
        try:
            return body["data"]["task_id"]
        except (KeyError, TypeError) as exc:
            raise YouCamError("YouCam task response had no task ID") from exc

    async def get_task(self, task_id: str) -> TaskResult:
        async with self._client() as client:
            try:
                response = await client.get(f"{self.base_url}/s2s/v2.0/task/cloth-v4/{task_id}", headers=self._headers())
            except httpx.HTTPError as exc:
                raise YouCamError(f"YouCam status request failed: {type(exc).__name__}", retryable=True) from exc
        body = self._raise_for_response(response, "status check")
        data = body.get("data") or {}
        status = data.get("task_status")
        if status == "success":
            # The docs show both data.results.url and a url field, so accept either.
            url = (data.get("results") or {}).get("url") or data.get("url") or body.get("url")
            if not url:
                return TaskResult("error", error="YouCam reported success without a result URL")
            return TaskResult("success", url=url)
        if status == "error":
            error = data.get("error")
            return TaskResult("error", error=str(error) if error else "YouCam reported a task error")
        return TaskResult("running")

    async def download(self, url: str) -> bytes:
        """Result URLs expire after two hours, so results are saved as soon as they complete."""
        async with self._client() as client:
            try:
                response = await client.get(url)
            except httpx.HTTPError as exc:
                raise YouCamError(f"YouCam result download failed: {type(exc).__name__}", retryable=True) from exc
        if not response.is_success:
            raise YouCamError(f"YouCam result download failed with HTTP {response.status_code}")
        return response.content
