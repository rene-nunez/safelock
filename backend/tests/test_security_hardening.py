import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings, validate_runtime_settings
from app.main import app


def test_validate_runtime_settings_dev_allows_defaults() -> None:
    settings = Settings(env="dev", jwt_secret="dev-only-change-me")
    warnings = validate_runtime_settings(settings)
    assert any("JWT_SECRET" in warning for warning in warnings)


def test_validate_runtime_settings_prod_requires_jwt_secret() -> None:
    settings = Settings(
        env="prod",
        jwt_secret="dev-only-change-me",
        mqtt_tls=True,
        cors_origins=["https://example.com"],
    )
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        validate_runtime_settings(settings)


def test_validate_runtime_settings_prod_requires_mqtt_tls() -> None:
    settings = Settings(
        env="prod",
        jwt_secret="x" * 40,
        mqtt_tls=False,
        mqtt_url="mqtt://broker:1883",
        cors_origins=["https://example.com"],
    )
    with pytest.raises(RuntimeError, match="MQTT TLS"):
        validate_runtime_settings(settings)


def test_validate_runtime_settings_prod_rejects_cors_wildcard() -> None:
    settings = Settings(
        env="prod",
        jwt_secret="x" * 40,
        mqtt_tls=True,
        mqtt_password="secret",
        cors_origins=["*"],
        mongodb_uri="mongodb+srv://u:p@cluster.mongodb.net/safelock",
    )
    with pytest.raises(RuntimeError, match="CORS wildcard"):
        validate_runtime_settings(settings)


async def test_security_headers_present() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"


async def test_cors_allows_configured_origin() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/healthz", headers={"Origin": "http://localhost:5173"}
        )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_validate_runtime_settings_prod_requires_mqtt_password() -> None:
    settings = Settings(
        env="prod",
        jwt_secret="x" * 40,
        mqtt_tls=True,
        mqtt_password="",
        cors_origins=["https://example.com"],
        mongodb_uri="mongodb+srv://u:p@cluster.mongodb.net/safelock",
    )
    with pytest.raises(RuntimeError, match="MQTT_PASSWORD"):
        validate_runtime_settings(settings)


def test_validate_runtime_settings_prod_warns_on_plain_mongodb_uri() -> None:
    settings = Settings(
        env="prod",
        jwt_secret="x" * 40,
        mqtt_tls=True,
        mqtt_password="secret",
        cors_origins=["https://example.com"],
        mongodb_uri="mongodb://127.0.0.1:27017",
    )
    warnings = validate_runtime_settings(settings)
    assert any("MONGODB_URI" in warning for warning in warnings)
