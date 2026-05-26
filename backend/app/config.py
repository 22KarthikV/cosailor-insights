from pydantic_settings import BaseSettings, SettingsConfigDict
from dataclasses import dataclass


class Settings(BaseSettings):
    supabase_url: str
    supabase_key: str
    firecrawl_api_key: str
    perplexity_api_key: str
    anthropic_api_key: str

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()


@dataclass
class ScraperConfig:
    """Future-proof scraper config — never hardcode these values."""
    postal_code: str = "10013"
    country_code: str = "us"
    distance: int = 25     # supported: 25, 50, or 100 miles
    limit: int | None = None  # cap for testing (e.g. 3)

    def __post_init__(self):
        if self.distance not in (25, 50, 100):
            raise ValueError(f"distance must be 25, 50, or 100. Got: {self.distance}")
