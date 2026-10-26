"""Structured logging with mandatory credential redaction.

Every log record passes through :class:`RedactionFilter`, so an accidental
``log.info("key=%s", api_key)`` cannot leak a secret to disk, stdout or a log
aggregator.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

from .security import redact

_CONFIGURED = False


class RedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - defensive
            message = str(record.msg)
        record.msg = redact(message)
        record.args = ()
        if record.exc_info and record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in ("request_id", "user_id", "path", "method", "status_code", "duration_ms"):
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(redact(payload), default=str)


def configure_logging(level: str = "INFO", *, json_output: bool = True) -> None:
    global _CONFIGURED
    root = logging.getLogger()
    root.setLevel(level)
    if _CONFIGURED:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RedactionFilter())
    if json_output:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s :: %(message)s"))
    root.handlers = [handler]
    for noisy in ("uvicorn.access", "httpx", "httpcore", "websockets.client"):
        logging.getLogger(noisy).setLevel("WARNING")
    _CONFIGURED = True
