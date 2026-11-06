from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite+aiosqlite:///./fingerprintscanner.db"
    redis_url: str = "redis://localhost:6379/0"
    pii_encryption_key: str | None = None
    search_provider: str | None = None
    brave_search_api_key: str | None = None
    ai_provider: str = "rules"
    ai_base_url: str | None = None
    ai_api_key: str | None = None
    ai_model: str | None = None
    magic_link_secret: str | None = None
    frontend_base_url: str = "http://127.0.0.1:3010"
    email_delivery_mode: str = "console"
    allowed_origins: str = "http://127.0.0.1:3010,http://localhost:3010"
    data_retention_days: int = 30

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


settings = Settings()
