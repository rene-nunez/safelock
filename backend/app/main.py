import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from typing import cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pymongo.errors import PyMongoError

from app.api.v1.router import router as v1_router
from app.core.config import get_settings, validate_runtime_settings
from app.db.mongo import create_client, ensure_indexes, get_database
from app.services.mqtt_gateway import MqttGateway

logger = logging.getLogger(__name__)
MAX_BODY_BYTES = 64 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    for warning in validate_runtime_settings(settings):
        logger.warning(warning)

    client = create_client(settings.mongodb_uri)
    db = get_database(client, settings.mongodb_db)
    app.state.mongo_client = client
    app.state.db = db

    try:
        await ensure_indexes(db)
    except PyMongoError:
        logger.exception("Could not initialize MongoDB indexes")

    # The MQTT consumer lives in the lifespan: never run more than one worker.
    gateway = MqttGateway(db, settings)
    gateway_task = asyncio.create_task(gateway.run())
    app.state.gateway = gateway

    try:
        yield
    finally:
        gateway_task.cancel()
        with suppress(asyncio.CancelledError):
            await gateway_task
        await client.close()


app = FastAPI(title="Safelock API", version="0.1.0", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def _with_security_headers(response: Response, request: Request) -> Response:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


@app.middleware("http")
async def add_security_headers(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return _with_security_headers(
            JSONResponse(status_code=413, content={"detail": "Request body too large"}),
            request,
        )
    return _with_security_headers(await call_next(request), request)


@app.exception_handler(RequestValidationError)
async def sanitize_validation_errors(request: Request, error: Exception) -> Response:
    # `input` and `ctx` can echo passwords, PINs and UIDs back to the client.
    validation_error = cast(RequestValidationError, error)
    detail = [
        {
            "loc": item.get("loc", ()),
            "msg": item.get("msg", "Invalid value"),
            "type": item.get("type", "value_error"),
        }
        for item in validation_error.errors()
    ]
    return _with_security_headers(
        JSONResponse(status_code=422, content={"detail": detail}), request
    )


@app.exception_handler(Exception)
async def internal_server_error(request: Request, error: Exception) -> Response:
    logger.exception(
        "Unhandled error method=%s path=%s type=%s",
        request.method,
        request.url.path,
        type(error).__name__,
    )
    return _with_security_headers(
        JSONResponse(status_code=500, content={"detail": "Internal Server Error"}),
        request,
    )


app.include_router(v1_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
