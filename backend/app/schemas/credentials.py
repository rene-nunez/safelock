from datetime import UTC, datetime
from typing import Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.identifiers import InvalidUidError, normalize_uid

CredentialStatus = Literal["active", "revoked"]

PIN_PATTERN = r"^\d{6,32}$"


def _normalized_uid(value: str) -> str:
    try:
        return normalize_uid(value)
    except InvalidUidError as error:
        raise ValueError(str(error)) from error


def _ensure_utc(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def validate_window(valid_from: datetime | None, valid_to: datetime | None) -> None:
    if valid_from is not None and valid_to is not None and valid_from >= valid_to:
        raise ValueError("valid_from must be before valid_to")


class CredentialCreate(BaseModel):
    uid: str
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    pin: str | None = Field(default=None, pattern=PIN_PATTERN)

    @field_validator("uid")
    @classmethod
    def normalize(cls, value: str) -> str:
        return _normalized_uid(value)

    @field_validator("valid_from", "valid_to")
    @classmethod
    def ensure_utc(cls, value: datetime | None) -> datetime | None:
        return _ensure_utc(value)

    @model_validator(mode="after")
    def check_window(self) -> Self:
        validate_window(self.valid_from, self.valid_to)
        return self


class CredentialUpdate(BaseModel):
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    pin: str | None = Field(default=None, pattern=PIN_PATTERN)
    clear_pin: bool = False

    @field_validator("valid_from", "valid_to")
    @classmethod
    def ensure_utc(cls, value: datetime | None) -> datetime | None:
        return _ensure_utc(value)

    @model_validator(mode="after")
    def require_a_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        if self.pin is not None and self.clear_pin:
            raise ValueError("pin and clear_pin cannot be used together")
        return self

    @model_validator(mode="after")
    def check_window(self) -> Self:
        validate_window(self.valid_from, self.valid_to)
        return self


class CredentialOut(BaseModel):
    id: str
    holder_id: str
    uid: str
    status: CredentialStatus
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    revoked_at: datetime | None = None
    has_pin: bool
    pin_locked_until: datetime | None = None
    created_at: datetime
    updated_at: datetime
