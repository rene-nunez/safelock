from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from fastapi.concurrency import run_in_threadpool
from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.security import hash_password
from app.db.mongo import Database
from app.schemas.auth import Role, UserOut

UserDocument = dict[str, Any]


class UserAlreadyExistsError(Exception):
    def __init__(self, email: str) -> None:
        super().__init__(f"A user with email {email} already exists")
        self.email = email


def normalize_email(email: str) -> str:
    return email.strip().lower()


def user_to_out(document: UserDocument) -> UserOut:
    return UserOut(
        id=str(document["_id"]),
        email=document["email"],
        role=document["role"],
        active=document["active"],
        last_login_at=document.get("last_login_at"),
    )


async def get_user_by_email(db: Database, email: str) -> UserDocument | None:
    return await db.users.find_one({"email": normalize_email(email)})


async def get_user_by_id(db: Database, user_id: str) -> UserDocument | None:
    if not ObjectId.is_valid(user_id):
        return None
    return await db.users.find_one({"_id": ObjectId(user_id)})


async def create_user(
    db: Database, email: str, password: str, role: Role = "admin"
) -> UserDocument:
    account = normalize_email(email)
    document: UserDocument = {
        "email": account,
        "password_hash": await run_in_threadpool(hash_password, password),
        "role": role,
        "active": True,
        "token_version": 0,
        "last_login_at": None,
        "created_at": datetime.now(UTC),
    }
    try:
        result = await db.users.insert_one(document)
    except DuplicateKeyError as error:
        raise UserAlreadyExistsError(account) from error

    document["_id"] = result.inserted_id
    return document


async def list_users(db: Database) -> list[UserDocument]:
    cursor = db.users.find({}, {"password_hash": 0}).sort("email", ASCENDING)
    return [document async for document in cursor]


async def count_active_admins(db: Database, exclude_id: ObjectId | None = None) -> int:
    query: dict[str, Any] = {"role": "admin", "active": True}
    if exclude_id is not None:
        query["_id"] = {"$ne": exclude_id}
    return await db.users.count_documents(query)


async def update_user(
    db: Database, user_id: ObjectId, updates: dict[str, Any]
) -> UserDocument | None:
    return await db.users.find_one_and_update(
        {"_id": user_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )
