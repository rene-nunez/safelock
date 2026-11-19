from datetime import datetime

from pydantic import BaseModel

from app.schemas.mqtt import Decision, Source


class AccessEventOut(BaseModel):
    id: str
    device_id: str
    ts: datetime
    uid: str | None = None
    credential_id: str | None = None
    decision: Decision
    reason: str
    source: Source
    acl_version: int | None = None
    acl_age_s: int | None = None
    degraded: bool
    created_at: datetime


class AccessEventPage(BaseModel):
    items: list[AccessEventOut]
    total: int
    today_count: int
    limit: int
    offset: int
