import asyncio
import json

import httpx
import pytest

from app.youcam_client import YouCamClient, YouCamError

BASE = "https://yce.test"


def client(handler):
    return YouCamClient("key", BASE, transport=httpx.MockTransport(handler))


def test_upload_requests_slot_then_puts_bytes():
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path == "/s2s/v2.0/file":
            return httpx.Response(200, json={"status": 200, "data": {"files": [{
                "file_id": "fid", "requests": [{"method": "PUT", "url": "https://s3.test/x", "headers": {"Content-Type": "image/jpg"}}]}]}})
        return httpx.Response(200)

    file_id = asyncio.run(client(handler).upload_image(b"abc", "a.jpg", "image/jpg"))
    assert file_id == "fid"
    assert seen[0].headers["authorization"] == "Bearer key"
    assert json.loads(seen[0].content)["files"][0]["file_size"] == 3
    assert seen[1].method == "PUT" and seen[1].content == b"abc"
    assert "authorization" not in seen[1].headers  # the key never goes to the storage host


def test_create_task_payload():
    def handler(request):
        body = json.loads(request.content)
        assert request.url.path == "/s2s/v2.0/task/cloth-v4"
        assert body == {"src_file_id": "s", "ref_file_id": "r", "garment_category": "upper_body", "filter_multi_person": "strict"}
        return httpx.Response(200, json={"status": 200, "data": {"task_id": "t1"}})

    assert asyncio.run(client(handler).create_task("s", "r")) == "t1"


@pytest.mark.parametrize("body,status,url", [
    ({"data": {"task_status": "running"}}, "running", None),
    ({"data": {"task_status": "success", "results": {"url": "https://r"}}}, "success", "https://r"),
    ({"data": {"task_status": "success", "url": "https://r2"}}, "success", "https://r2"),
    ({"data": {"task_status": "success"}}, "error", None),
    ({"data": {"task_status": "error", "error": "error_pose"}}, "error", None),
])
def test_get_task_states(body, status, url):
    result = asyncio.run(client(lambda r: httpx.Response(200, json=body)).get_task("t1"))
    assert (result.status, result.url) == (status, url)


@pytest.mark.parametrize("code,retryable", [(400, False), (429, True), (500, True)])
def test_errors_are_classified(code, retryable):
    handler = lambda r: httpx.Response(code, json={"error_code": "CreditInsufficiency"})
    with pytest.raises(YouCamError) as exc:
        asyncio.run(client(handler).create_task("s", "r"))
    assert exc.value.retryable is retryable and exc.value.code == "CreditInsufficiency"
