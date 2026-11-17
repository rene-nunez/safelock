from bson import ObjectId
from fastapi import Request

from app.schemas.auth import UserOut


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client is not None else None


def actor_object_id(user: UserOut) -> ObjectId:
    return ObjectId(user.id)
