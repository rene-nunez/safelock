from fastapi import APIRouter

from app.api.v1.activity import router as activity_router
from app.api.v1.audit import router as audit_router
from app.api.v1.auth import router as auth_router
from app.api.v1.cardholders import router as cardholders_router
from app.api.v1.credentials import router as credentials_router
from app.api.v1.devices import router as devices_router
from app.api.v1.users import router as users_router

router = APIRouter(prefix="/api/v1")
router.include_router(auth_router)
router.include_router(users_router)
router.include_router(cardholders_router)
router.include_router(credentials_router)
router.include_router(devices_router)
router.include_router(activity_router)
router.include_router(audit_router)
