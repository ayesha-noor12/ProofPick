import asyncio
import json
from types import SimpleNamespace

import pytest
from google.genai import errors, types

from app.llm import ModelClient, ModelUnavailable, plain_schema
from app.preview_inspector import _Attribute, _ModelInspection
from app.recommender import _ModelRanking
from app.schemas import Requirements


def response(text, finish=types.FinishReason.STOP, block=None):
    return SimpleNamespace(text=text, candidates=[SimpleNamespace(finish_reason=finish)],
                           prompt_feedback=SimpleNamespace(block_reason=block) if block else None)


def rate_limit(delay=None):
    details = [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay}] if delay else []
    return errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED", "details": details}})


def client_returning(*results):
    """Each call gets the next result; the last one repeats."""
    calls = []

    async def generate_content(**kwargs):
        calls.append(kwargs)
        result = results[min(len(calls), len(results)) - 1]
        if isinstance(result, Exception):
            raise result
        return result

    model = ModelClient("test-key", "gemini-test")
    model._client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
    return model, calls


@pytest.mark.parametrize("schema", [Requirements, _ModelRanking, _ModelInspection, _Attribute])
def test_schemas_use_only_the_documented_gemini_subset(schema):
    text = json.dumps(plain_schema(schema.model_json_schema()))
    for keyword in ('"$ref"', '"$defs"', '"anyOf"', '"const"', '"default"'):
        assert keyword not in text


def test_nullable_enum_keeps_its_choices():
    sleeves = plain_schema(Requirements.model_json_schema())["properties"]["sleeves"]
    assert sleeves["type"] == ["string", "null"] and "long" in sleeves["enum"]


def test_structured_returns_validated_output():
    model, calls = client_returning(response('{"value": "long", "observation": "Long sleeves."}'))
    parsed = asyncio.run(model.structured("system text", "question", _Attribute, effort="low"))
    assert parsed == _Attribute(value="long", observation="Long sleeves.")
    config = calls[0]["config"]
    assert calls[0]["model"] == "gemini-test" and config.system_instruction == "system text"
    assert config.thinking_config.thinking_level == types.ThinkingLevel.LOW


@pytest.mark.parametrize("result, message", [
    (errors.ClientError(429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}), "rate limited"),
    (errors.ClientError(400, {"error": {"code": 400, "message": "bad key", "status": "INVALID_ARGUMENT"}}), "HTTP 400"),
    (response(None, finish=types.FinishReason.SAFETY), "declined"),
    (response(None, block=types.BlockedReason.SAFETY), "declined"),
    (response('{"value": "purple"}'), "did not match"),
    (response(None, finish=types.FinishReason.MAX_TOKENS), "no structured output"),
])
def test_failures_become_model_unavailable(result, message):
    model, _ = client_returning(result)
    with pytest.raises(ModelUnavailable, match=message):
        asyncio.run(model.structured("s", "q", _Attribute))


@pytest.fixture
def waits(monkeypatch):
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr("app.llm.asyncio.sleep", fake_sleep)
    return slept


def test_short_rate_limit_waits_as_asked_then_retries(waits):
    model, calls = client_returning(rate_limit("7s"), response('{"value": "short", "observation": "Short sleeves."}'))
    assert asyncio.run(model.structured("s", "q", _Attribute)).value == "short"
    assert waits == [7.0] and len(calls) == 2


@pytest.mark.parametrize("results", [(rate_limit("90s"),), (rate_limit("3s"), rate_limit("3s"))])
def test_long_or_repeated_rate_limits_fall_back(waits, results):
    model, calls = client_returning(*results)
    with pytest.raises(ModelUnavailable, match="rate limited"):
        asyncio.run(model.structured("s", "q", _Attribute))
    assert len(calls) == len(results) and all(w <= 20 for w in waits)
