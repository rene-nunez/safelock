import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, Field
from starlette.requests import Request

from app.core.config import Settings, validate_runtime_settings
from app.main import app, internal_server_error, sanitize_validation_errors


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
        mqtt_password="strong-mqtt-password",
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
        mqtt_password="strong-mqtt-password",
        cors_origins=["https://example.com"],
        mongodb_uri="mongodb://127.0.0.1:27017",
    )
    warnings = validate_runtime_settings(settings)
    assert any("MONGODB_URI" in warning for warning in warnings)


@pytest.mark.parametrize("jwt_secret", ["change-me", "dev-only-change-me", "short"])
def test_validate_runtime_settings_prod_rejects_weak_jwt_secret(
    jwt_secret: str,
) -> None:
    settings = Settings(
        env="prod",
        jwt_secret=jwt_secret,
        mqtt_tls=True,
        mqtt_password="strong-mqtt-password",
        cors_origins=["https://example.com"],
        mongodb_uri="mongodb+srv://u:p@cluster.mongodb.net/safelock",
    )
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        validate_runtime_settings(settings)


def test_validate_runtime_settings_prod_rejects_placeholder_mqtt_password() -> None:
    settings = Settings(
        env="prod",
        jwt_secret="x" * 40,
        mqtt_tls=True,
        mqtt_password="change-me",
        cors_origins=["https://example.com"],
        mongodb_uri="mongodb+srv://u:p@cluster.mongodb.net/safelock",
    )
    with pytest.raises(RuntimeError, match="MQTT_PASSWORD"):
        validate_runtime_settings(settings)


class _SensitivePayload(BaseModel):
    pin: str = Field(min_length=6)


async def test_validation_errors_do_not_echo_sensitive_input() -> None:
    probe = FastAPI()
    probe.add_exception_handler(RequestValidationError, sanitize_validation_errors)

    @probe.post("/probe")
    async def probe_endpoint(payload: _SensitivePayload) -> None:
        return None

    transport = ASGITransport(app=probe)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/probe", json={"pin": "123"})

    assert response.status_code == 422
    assert "123" not in response.text
    assert response.json()["detail"][0]["loc"] == ["body", "pin"]


async def test_oversized_body_is_rejected_before_validation() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "someone@example.com", "password": "x" * 70_000},
        )
    assert response.status_code == 413
    assert response.headers["x-content-type-options"] == "nosniff"


async def test_internal_error_is_generic_and_has_security_headers() -> None:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/boom",
        "scheme": "http",
        "headers": [],
        "query_string": b"",
        "server": ("test", 80),
        "client": ("test", 1),
    }
    request = Request(scope)
    response = await internal_server_error(request, RuntimeError("secret detail"))
    assert response.status_code == 500
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "secret detail" not in bytes(response.body).decode()
