import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pymongo.errors import PyMongoError

from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.db.mongo import create_client, ensure_indexes, get_database

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.jwt_secret == "dev-only-change-me":
        logger.warning("JWT_SECRET uses the development default; set it in .env")

    client = create_client(settings.mongodb_uri)
    db = get_database(client, settings.mongodb_db)
    app.state.mongo_client = client
    app.state.db = db

    try:
        await ensure_indexes(db)
    except PyMongoError:
        logger.exception("Could not initialize MongoDB indexes")

    try:
        yield
    finally:
        await client.close()


app = FastAPI(title="Safelock API", version="0.1.0", lifespan=lifespan)
app.include_router(v1_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
