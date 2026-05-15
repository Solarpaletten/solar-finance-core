"""
Solar Finance Core — Qwen / Ollama adapter (Sprint 5)

Thin wrapper around the Ollama /api/generate endpoint that:
  - calls Qwen with deterministic options (temperature=0, seed=42)
  - uses Ollama's native `format: "json"` to coerce JSON output
  - returns parsed dict on success
  - raises typed errors on every distinct failure mode so the
    route handler can map them to the correct HTTP status:

      QwenTimeoutError       -> 504
      QwenUnreachableError   -> 503
      QwenBadOutputError     -> 502

Design rules:
  - No retries. Determinism beats availability at this layer; the
    upstream cache absorbs repeated calls within source_ts window.
  - No streaming. We need the full JSON before validation.
  - One shared httpx.AsyncClient is reused from app.state, mirroring
    main.py's existing pattern. We do not create a new client here.
"""

import json
import logging
from typing import Any

import httpx

log = logging.getLogger("solar.regime.qwen")


# ─── Exception taxonomy ─────────────────────────────────────────

class QwenError(Exception):
    """Base class for all Qwen call failures."""


class QwenTimeoutError(QwenError):
    """Ollama exceeded the configured timeout. Maps to HTTP 504."""


class QwenUnreachableError(QwenError):
    """Cannot connect to Ollama or Ollama returned 5xx. Maps to 503."""


class QwenBadOutputError(QwenError):
    """Ollama responded but body is not parseable JSON. Maps to 502."""


# ─── Adapter ────────────────────────────────────────────────────

async def call_qwen_json(
    *,
    http_client: httpx.AsyncClient,
    ollama_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    timeout_seconds: float = 120.0,
    num_ctx: int = 32768,
) -> dict[str, Any]:
    """
    Call Qwen on Ollama and return its JSON response as a dict.

    Args:
        http_client:     shared async client from app.state.http
        ollama_url:      base URL, e.g. http://ollama:11434
        model:           model name from settings.OLLAMA_MODEL
        system_prompt:   system instructions
        user_prompt:     user payload (typically JSON of indicators)
        timeout_seconds: hard timeout for the call (default 120s,
                         tuned for Q4_K_M on M4 Pro warm path)
        num_ctx:         context window passed to Ollama

    Returns:
        dict parsed from Qwen's JSON output.

    Raises:
        QwenTimeoutError, QwenUnreachableError, QwenBadOutputError.
    """
    payload = {
        "model": model,
        "system": system_prompt,
        "prompt": user_prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0,
            "seed": 42,
            "num_ctx": num_ctx,
        },
    }

    try:
        resp = await http_client.post(
            f"{ollama_url}/api/generate",
            json=payload,
            timeout=timeout_seconds,
        )
    except httpx.TimeoutException as exc:
        log.warning("qwen timeout after %ss", timeout_seconds)
        raise QwenTimeoutError(str(exc)) from exc
    except httpx.ConnectError as exc:
        log.warning("qwen unreachable: %s", exc)
        raise QwenUnreachableError(str(exc)) from exc
    except httpx.HTTPError as exc:
        # Other transport-level errors (DNS, SSL, etc.) -> treat as
        # unreachable so the caller returns 503.
        log.warning("qwen transport error: %s", exc)
        raise QwenUnreachableError(str(exc)) from exc

    if resp.status_code >= 500:
        raise QwenUnreachableError(
            f"ollama returned {resp.status_code}: {resp.text[:200]}"
        )
    if resp.status_code >= 400:
        # 4xx from Ollama typically means bad model name or bad request.
        # We surface this as bad output so the operator sees the body.
        raise QwenBadOutputError(
            f"ollama returned {resp.status_code}: {resp.text[:200]}"
        )

    try:
        envelope = resp.json()
    except ValueError as exc:
        raise QwenBadOutputError(f"ollama envelope not JSON: {exc}") from exc

    inner = envelope.get("response")
    if not isinstance(inner, str) or not inner.strip():
        raise QwenBadOutputError("ollama returned empty `response` field")

    try:
        parsed = json.loads(inner)
    except json.JSONDecodeError as exc:
        # `format: "json"` should prevent this, but Qwen can still
        # emit malformed JSON when the prompt confuses it.
        raise QwenBadOutputError(
            f"qwen output not parseable JSON: {exc}; raw={inner[:200]}"
        ) from exc

    if not isinstance(parsed, dict):
        raise QwenBadOutputError(
            f"qwen output is not a JSON object: type={type(parsed).__name__}"
        )

    return parsed
