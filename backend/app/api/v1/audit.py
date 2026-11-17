from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_admin, get_db
from app.db.mongo import Database
from app.schemas.audit import AuditLogOut, AuditLogPage
from app.schemas.auth import UserOut
from app.services.audit import list_audit_logs

router = APIRouter(prefix="/audit-logs", tags=["audit"])

AdminUser = Annotated[UserOut, Depends(get_current_admin)]
Db = Annotated[Database, Depends(get_db)]


def _to_out(document: dict[str, Any]) -> AuditLogOut:
    actor_id = document.get("actor_id")
    return AuditLogOut(
        id=str(document["_id"]),
        actor_id=str(actor_id) if actor_id is not None else None,
        action=document["action"],
        target=document["target"],
        before=document.get("before"),
        after=document.get("after"),
        ip=document.get("ip"),
        ts=document["ts"],
    )


@router.get("", response_model=AuditLogPage)
async def get_audit_logs(
    db: Db,
    _: AdminUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    action: Annotated[str | None, Query(max_length=120)] = None,
) -> AuditLogPage:
    documents, total = await list_audit_logs(
        db, limit=limit, offset=offset, action=action
    )
    return AuditLogPage(
        items=[_to_out(document) for document in documents],
        total=total,
        limit=limit,
        offset=offset,
    )
