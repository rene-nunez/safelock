from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.identifiers import InvalidDeviceIdError, normalize_device_id

OfflinePolicy = Literal["allow", "deny"]
DeviceStatus = Literal["active", "retired"]


class DeviceLocation(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class DeviceCreate(BaseModel):
    device_id: str
    name: str = Field(min_length=1, max_length=120)
    site: str | None = Field(default=None, max_length=120)
    location: DeviceLocation | None = None
    offline_policy: OfflinePolicy = "allow"
    stale_acl_hours: int = Field(default=72, ge=1, le=8760)
    unlock_ms: int = Field(default=3000, ge=100, le=30_000)
    requires_pin: bool = False

    @field_validator("device_id")
    @classmethod
    def normalize(cls, value: str) -> str:
        try:
            return normalize_device_id(value)
        except InvalidDeviceIdError as error:
            raise ValueError(str(error)) from error


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    site: str | None = Field(default=None, max_length=120)
    location: DeviceLocation | None = None
    offline_policy: OfflinePolicy | None = None
    stale_acl_hours: int | None = Field(default=None, ge=1, le=8760)
    unlock_ms: int | None = Field(default=None, ge=100, le=30_000)
    requires_pin: bool | None = None
    locked: bool | None = None
    status: DeviceStatus | None = None

    @model_validator(mode="after")
    def require_a_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        for field in (
            "name",
            "offline_policy",
            "stale_acl_hours",
            "unlock_ms",
            "requires_pin",
            "locked",
            "status",
        ):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class CommandOut(BaseModel):
    request_id: str
    expires_at: int
    acl_version: int


class UnlockCommandOut(BaseModel):
    request_id: str
    expires_at: int


class DeviceOut(BaseModel):
    id: str
    device_id: str
    name: str
    site: str | None = None
    fw: str | None = None
    online: bool
    last_seen: datetime | None = None
    acl_version: int
    last_sync_at: datetime | None = None
    offline_policy: OfflinePolicy
    stale_acl_hours: int
    unlock_ms: int
    requires_pin: bool
    locked: bool
    lock: Literal["locked", "unlocked"] | None = None
    status: DeviceStatus
    location: DeviceLocation | None = None
    created_at: datetime
    updated_at: datetime
