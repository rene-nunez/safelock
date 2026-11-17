from typing import Self

from pydantic import BaseModel, EmailStr, Field, model_validator

from app.schemas.auth import Role

PASSWORD_MIN_LENGTH = 12
PASSWORD_MAX_LENGTH = 256


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(
        min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH
    )
    role: Role = "operator"


class UpdateUserRequest(BaseModel):
    role: Role | None = None
    active: bool | None = None
    password: str | None = Field(
        default=None,
        min_length=PASSWORD_MIN_LENGTH,
        max_length=PASSWORD_MAX_LENGTH,
    )

    @model_validator(mode="after")
    def require_a_change(self) -> Self:
        if self.role is None and self.active is None and self.password is None:
            raise ValueError("At least one field must be provided")
        return self
