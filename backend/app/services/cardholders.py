from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo import ASCENDING, ReturnDocument

from app.db.mongo import Database
from app.schemas.cardholders import CardholderCreate, CardholderOut

CardholderDocument = dict[str, Any]


def _normalize_optional_email(email: str | None) -> str | None:
    return str(email).strip().lower() if email is not None else None


def cardholder_to_out(document: CardholderDocument) -> CardholderOut:
    return CardholderOut(
        id=str(document["_id"]),
        name=document["name"],
        email=document.get("email"),
        unit=document.get("unit"),
        status=document.get("status", "active"),
        created_at=document["created_at"],
        updated_at=document["updated_at"],
    )


async def get_cardholder(db: Database, cardholder_id: str) -> CardholderDocument | None:
    if not ObjectId.is_valid(cardholder_id):
        return None
    return await db.cardholders.find_one({"_id": ObjectId(cardholder_id)})


async def list_cardholders(db: Database) -> list[CardholderDocument]:
    cursor = db.cardholders.find({}).sort("name", ASCENDING)
    return [document async for document in cursor]


async def create_cardholder(
    db: Database, payload: CardholderCreate
) -> CardholderDocument:
    now = datetime.now(UTC)
    document: CardholderDocument = {
        "name": payload.name.strip(),
        "email": _normalize_optional_email(payload.email),
        "unit": payload.unit.strip() if payload.unit else None,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    result = await db.cardholders.insert_one(document)
    document["_id"] = result.inserted_id
    return document


async def update_cardholder(
    db: Database, cardholder_id: ObjectId, updates: dict[str, Any]
) -> CardholderDocument | None:
    updates["updated_at"] = datetime.now(UTC)
    return await db.cardholders.find_one_and_update(
        {"_id": cardholder_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )
