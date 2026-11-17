from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mqtt_url: str = "mqtt://127.0.0.1:1883"
    mqtt_tls: bool = False
    mqtt_ca_path: str | None = None
    mqtt_username: str = "svc-backend"
    mqtt_password: str = ""
    mongodb_uri: str = "mongodb://127.0.0.1:27017"
    mongodb_db: str = "safelock_dev"
    jwt_secret: str = "dev-only-change-me"


@lru_cache
def get_settings() -> Settings:
    return Settings()
