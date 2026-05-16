"""
Solar Finance Core — API Configuration

Loads settings from environment variables. Pydantic validates types.
No secrets hardcoded.

Sprint 5.1 change:
  - Default OLLAMA_MODEL switched from 72B to 32B (qwen2.5:32b-instruct-q4_K_M)
  - Rationale: 72B on M4 Pro hit hardware ceiling — JSON-constrained
    inference exceeded 5 minutes per call. 32B fits comfortably in
    available memory, with warm inference target <60s, enabling
    real-time-ish UX through the cache layer (Sprint 7).
  - The 72B model remains available in Ollama for future migrations
    (e.g., heavier hardware or background chronicle compute).
  - This is the *default*. Production deployment may override via
    OLLAMA_MODEL env var.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True)

    # PostgreSQL / TimescaleDB
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432

    # Redis
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379

    # Ollama
    OLLAMA_HOST: str = "ollama"
    OLLAMA_PORT: int = 11434
    OLLAMA_MODEL: str = "qwen2.5:32b-instruct-q4_K_M"

    # API
    API_LOG_LEVEL: str = "info"
    ENVIRONMENT: str = "development"

    @property
    def postgres_dsn(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def ollama_url(self) -> str:
        return f"http://{self.OLLAMA_HOST}:{self.OLLAMA_PORT}"


settings = Settings()
