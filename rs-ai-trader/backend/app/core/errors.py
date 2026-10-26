"""Uniform error contract shared by every endpoint and consumed by the app."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for expected, user-understandable failures."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = "bad_request"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}
        if code:
            self.code = code

    def to_response(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        }


class AuthError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "unauthorized"


class ForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "forbidden"


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"


class UpstreamError(AppError):
    status_code = status.HTTP_502_BAD_GATEWAY
    code = "upstream_error"


class ServiceUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "service_unavailable"


class StaleDataError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "stale_market_data"


class RiskRejectedError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "risk_rejected"


class ValidationAppError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "validation_failed"


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= 500:
            log.error("app error: %s (%s)", exc.message, exc.code)
        return JSONResponse(status_code=exc.status_code, content=exc.to_response())

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [
            {"field": ".".join(str(p) for p in err.get("loc", []) if p != "body"), "message": err.get("msg", "")}
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": {
                    "code": "validation_failed",
                    "message": "Some fields are invalid.",
                    "details": {"fields": fields},
                }
            },
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected error occurred. Try again shortly.",
                    "details": {},
                }
            },
        )
