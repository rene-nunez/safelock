from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user, get_db
from app.db.mongo import Database
from app.schemas.access_events import AccessEventOut, AccessEventPage
from app.schemas.auth import UserOut
from app.services.access_events import list_access_events

router = APIRouter(prefix="/access-events", tags=["activity"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]
Db = Annotated[Database, Depends(get_db)]


def _to_out(document: dict[str, Any]) -> AccessEventOut:
    return AccessEventOut(
        id=str(document["_id"]),
        device_id=document["device_id"],
        ts=document["ts"],
        uid=document.get("uid"),
        credential_id=document.get("credential_id"),
        decision=document["decision"],
        reason=document["reason"],
        source=document["source"],
        acl_version=document.get("acl_version"),
        acl_age_s=document.get("acl_age_s"),
        degraded=document.get("degraded", False),
        created_at=document["created_at"],
    )


@router.get("", response_model=AccessEventPage)
async def get_access_events(
    db: Db,
    _: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    device_id: Annotated[str | None, Query(pattern=r"^sl-\d{4}$")] = None,
) -> AccessEventPage:
    documents, total = await list_access_events(
        db, limit=limit, offset=offset, device_id=device_id
    )
    today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = await db.access_events.count_documents({"ts": {"$gte": today_start}})
    return AccessEventPage(
        items=[_to_out(document) for document in documents],
        total=total,
        today_count=today_count,
        limit=limit,
        offset=offset,
    )
