"""Application configuration loaded from environment variables and .env file.

Settings uses pydantic-settings for automatic env-var validation at startup.
ScraperConfig holds GAF-scraper parameters that are always passed as a
structured object — never hardcoded at call sites.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from dataclasses import dataclass
from typing import Literal


class Settings(BaseSettings):
    """Environment-sourced API keys and Supabase credentials.

    Required fields raise ValidationError at startup. firecrawl_api_key is optional
    because the default scraper is playwright; set it only if using the firecrawl path.
    """
    supabase_url: str
    supabase_key: str
    firecrawl_api_key: str | None = None
    perplexity_api_key: str
    anthropic_api_key: str

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()


@dataclass
class ScraperConfig:
    """Runtime parameters for a single GAF contractor scrape.

    distance must be one of the three values supported by the GAF URL schema
    (25 / 50 / 100 miles); anything else raises ValueError at construction time.
    limit is a test-only cap — set it to a small integer to avoid burning
    API credits during development.
    scraper selects which scraper implementation to use at pipeline start time.
    """
    postal_code: str = "10013"
    country_code: str = "us"
    distance: int = 25     # supported: 25, 50, or 100 miles
    limit: int | None = None  # cap for testing (e.g. 3)
    scraper: Literal["firecrawl", "playwright"] = "playwright"

    def __post_init__(self):
        if self.distance not in (25, 50, 100):
            raise ValueError(f"distance must be 25, 50, or 100. Got: {self.distance}")
        if self.scraper not in ("firecrawl", "playwright"):
            raise ValueError(f"scraper must be 'firecrawl' or 'playwright'. Got: {self.scraper}")
