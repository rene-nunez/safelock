from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

Role = Literal["admin", "operator"]
PASSWORD_MAX_LENGTH = 256


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: Role
    active: bool
    last_login_at: datetime | None = None
