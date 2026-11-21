from datetime import UTC, datetime
from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps import get_current_user, get_db, get_gateway
from app.api.v1.common import actor_object_id, client_ip
from app.db.mongo import Database
from app.schemas.auth import UserOut
from app.schemas.enrollments import EnrollmentConfirm, EnrollmentCreate, EnrollmentOut
from app.services import enrollments as service
from app.services.audit import record_audit
from app.services.mqtt_gateway import MqttGateway

router = APIRouter(prefix="/enrollments", tags=["enrollments"])

CurrentUser = Annotated[UserOut, Depends(get_current_user)]
Db = Annotated[Database, Depends(get_db)]
Gateway = Annotated[MqttGateway | None, Depends(get_gateway)]


def _out(doc: dict[str, Any]) -> EnrollmentOut:
    return EnrollmentOut(**service.enrollment_to_out(doc))


@router.get("", response_model=list[EnrollmentOut])
async def get_enrollments(
    db: Db, _: CurrentUser, device_id: str | None = None
) -> list[EnrollmentOut]:
    docs = await service.list_enrollments(db, device_id=device_id)
    # mark expired for UI simplicity
    now = datetime.now(UTC)
    for doc in docs:
        expires = service._expires_at(doc)
        if doc.get("status") in {"pending", "scanned"} and expires < now:
            doc["status"] = "expired"
    return [_out(doc) for doc in docs]


@router.post("", response_model=EnrollmentOut, status_code=status.HTTP_201_CREATED)
async def create_enrollment_endpoint(
    payload: EnrollmentCreate,
    request: Request,
    db: Db,
    gateway: Gateway,
    user: CurrentUser,
) -> EnrollmentOut:
    try:
        doc = await service.create_enrollment(
            db, gateway, payload.device_id, actor_object_id(user)
        )
    except service.DeviceOfflineError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(error)
        ) from error
    except service.EnrollmentError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error

    await record_audit(
        db,
        actor_id=actor_object_id(user),
        action="enrollment.create",
        target=doc["device_id"],
        after={"request_id": doc["request_id"], "enrollment_id": str(doc["_id"])},
        ip=client_ip(request),
    )
    return _out(doc)


@router.post("/{enrollment_id}/confirm", response_model=EnrollmentOut)
async def confirm_enrollment_endpoint(
    enrollment_id: str,
    payload: EnrollmentConfirm,
    request: Request,
    db: Db,
    gateway: Gateway,
    user: CurrentUser,
) -> EnrollmentOut:
    enrollment = await service.get_enrollment(db, enrollment_id)
    if enrollment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Enrollment not found"
        )
    if not ObjectId.is_valid(payload.holder_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid holder_id"
        )

    try:
        updated = await service.confirm_enrollment(
            db, gateway, enrollment, ObjectId(payload.holder_id), payload
        )
    except service.EnrollmentStateError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(error)
        ) from error
    except service.EnrollmentNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
        ) from error

    await record_audit(
        db,
        actor_id=actor_object_id(user),
        action="enrollment.confirm",
        target=enrollment["device_id"],
        after={
            "enrollment_id": str(enrollment["_id"]),
            "uid": enrollment.get("uid"),
            "holder_id": payload.holder_id,
        },
        ip=client_ip(request),
    )
    return _out(updated)
