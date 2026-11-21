from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

EnrollmentStatus = Literal["pending", "scanned", "confirmed", "expired", "cancelled"]


class EnrollmentCreate(BaseModel):
    device_id: str = Field(min_length=1, max_length=32)


class EnrollmentConfirm(BaseModel):
    holder_id: str = Field(min_length=1, max_length=64)
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    pin: str | None = Field(default=None, pattern=r"^\d{6,32}$")


class EnrollmentOut(BaseModel):
    id: str
    device_id: str
    request_id: str
    status: EnrollmentStatus
    uid: str | None = None
    requested_by: str | None = None
    created_at: datetime
    expires_at: datetime
    scanned_at: datetime | None = None
