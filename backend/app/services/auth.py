from datetime import UTC, datetime

from fastapi.concurrency import run_in_threadpool

from app.core.security import verify_password
from app.db.mongo import Database
from app.services.users import UserDocument, normalize_email


async def authenticate(db: Database, email: str, password: str) -> UserDocument | None:
    user = await db.users.find_one({"email": normalize_email(email)})
    if user is None:
        return None
    if not await run_in_threadpool(verify_password, password, user["password_hash"]):
        return None
    if not user.get("active", False):
        return None

    now = datetime.now(UTC)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": now}})
    user["last_login_at"] = now
    return user
