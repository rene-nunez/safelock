from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

_WEAK_SECRETS = {
    "change-me",
    "changeme",
    "dev-only-change-me",
    "replace-me",
    "secret",
}
_JWT_SECRET_MIN_LENGTH = 32


def _is_weak_secret(value: str) -> bool:
    return value.strip().lower() in _WEAK_SECRETS


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "dev"
    cors_origins: list[str] = ["http://localhost:5173"]
    mqtt_url: str = "mqtt://127.0.0.1:1883"
    mqtt_tls: bool = False
    mqtt_ca_path: str | None = None
    mqtt_username: str = "svc-backend"
    mqtt_password: str = ""
    mongodb_uri: str = "mongodb://127.0.0.1:27017"
    mongodb_db: str = "safelock_dev"
    jwt_secret: str = "dev-only-change-me"
    access_token_ttl_minutes: int = 30

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            items = [item.strip() for item in value.split(",")]
            return [item for item in items if item]
        return value

    @property
    def is_dev(self) -> bool:
        return self.env.lower() in {"dev", "development", "test"}

    @property
    def mqtt_tls_enabled(self) -> bool:
        return self.mqtt_tls or self.mqtt_url.startswith("mqtts://")


def validate_runtime_settings(settings: Settings) -> list[str]:
    warnings: list[str] = []
    if (
        _is_weak_secret(settings.jwt_secret)
        or len(settings.jwt_secret) < _JWT_SECRET_MIN_LENGTH
    ):
        if settings.is_dev:
            warnings.append("JWT_SECRET uses the development default; set it in .env")
        else:
            raise RuntimeError(
                "JWT_SECRET must be a unique secret of at least 32 characters "
                "outside development"
            )

    if settings.is_dev:
        return warnings

    if not settings.mqtt_tls_enabled:
        raise RuntimeError("MQTT TLS must be enabled outside development")
    if not settings.mqtt_password or _is_weak_secret(settings.mqtt_password):
        raise RuntimeError(
            "MQTT_PASSWORD must be set to a non-placeholder value outside development"
        )
    if "*" in settings.cors_origins:
        raise RuntimeError("CORS wildcard origin is not allowed outside development")
    if "mongodb.net" not in settings.mongodb_uri and "@" not in settings.mongodb_uri:
        warnings.append(
            "MONGODB_URI does not look like an authenticated/Atlas URI "
            "outside development"
        )
    if any(
        origin.startswith(("http://localhost", "http://127.0.0.1", "http://[::1]"))
        or origin.startswith(("https://localhost", "https://127.0.0.1", "https://[::1]"))
        for origin in settings.cors_origins
    ):
        warnings.append("CORS_ORIGINS includes localhost outside development")
    return warnings


@lru_cache
def get_settings() -> Settings:
    return Settings()
