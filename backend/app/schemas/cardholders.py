from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, EmailStr, Field, model_validator

CardholderStatus = Literal["active", "inactive"]


class CardholderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr | None = None
    unit: str | None = Field(default=None, max_length=120)


class CardholderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    unit: str | None = Field(default=None, max_length=120)
    status: CardholderStatus | None = None

    @model_validator(mode="after")
    def require_a_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        for field in ("name", "status"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class CardholderOut(BaseModel):
    id: str
    name: str
    email: EmailStr | None = None
    unit: str | None = None
    status: CardholderStatus
    created_at: datetime
    updated_at: datetime
