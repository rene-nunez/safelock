import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pymongo.errors import PyMongoError

from app.api.v1.router import router as v1_router
from app.core.config import get_settings, validate_runtime_settings
from app.db.mongo import create_client, ensure_indexes, get_database
from app.services.mqtt_gateway import MqttGateway

logger = logging.getLogger(__name__)


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


@app.middleware("http")
async def add_security_headers(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


app.include_router(v1_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
