from fastapi import FastAPI

from app.api.v1.router import router as v1_router

app = FastAPI(title="Safelock API", version="0.1.0")
app.include_router(v1_router)

@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
