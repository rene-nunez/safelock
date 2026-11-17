from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: str
    actor_id: str | None = None
    action: str
    target: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    ip: str | None = None
    ts: datetime


class AuditLogPage(BaseModel):
    items: list[AuditLogOut]
    total: int
    limit: int
    offset: int
