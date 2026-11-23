from typing import Annotated

from bson import ObjectId
from fastapi import Query, Request

from app.schemas.auth import UserOut

MAX_PAGE_SIZE = 100
MAX_OFFSET = 10_000

Limit = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)]
Offset = Annotated[int, Query(ge=0, le=MAX_OFFSET)]


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client is not None else None


def actor_object_id(user: UserOut) -> ObjectId:
    return ObjectId(user.id)
