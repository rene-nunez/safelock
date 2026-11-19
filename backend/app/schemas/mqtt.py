from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.identifiers import InvalidDeviceIdError, normalize_device_id

Decision = Literal["granted", "denied", "unknown"]
Source = Literal["card", "pin", "remote", "manual"]


class MessageEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    ts: int = Field(ge=0)
    device_id: str
    data: dict[str, Any]

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        parsed = UUID(value)
        if parsed.version != 4:
            raise ValueError("Message id must be a UUID4")
        return str(parsed)

    @field_validator("device_id")
    @classmethod
    def normalize(cls, value: str) -> str:
        try:
            return normalize_device_id(value)
        except InvalidDeviceIdError as error:
            raise ValueError(str(error)) from error


class StatusData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    online: bool
    fw: str | None = Field(default=None, max_length=40)
    acl_version: int | None = Field(default=None, ge=0)
    requires_pin: bool | None = None
    locked: bool | None = None
    lock: Literal["locked", "unlocked"] | None = None


class HeartbeatData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    uptime_s: int | None = Field(default=None, ge=0)
    rssi: int | None = None
    rtc_valid: bool
    free_heap: int | None = Field(default=None, ge=0)


class AccessDecisionData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    decision: Decision
    reason: str = Field(min_length=1, max_length=60)
    source: Source
    uid: str | None = Field(default=None, max_length=32)
    credential_id: str | None = Field(default=None, max_length=64)
    acl_version: int | None = Field(default=None, ge=0)
    acl_age_s: int | None = Field(default=None, ge=0)
