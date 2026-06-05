# Backend Rules (Python/FastAPI)

## Stack
Python 3.14, FastAPI, uvicorn, supabase-py, firecrawl-py, httpx, anthropic, pydantic-settings, tenacity

## GAF Scraper Config Object
```python
@dataclass
class ScraperConfig:
    postal_code: str = "10013"
    country_code: str = "us"
    distance: int = 25   # must be 25, 50, or 100
    limit: int | None = None   # cap for testing
    scraper: Literal["firecrawl", "playwright"] = "playwright"
```

## Claude Model
Use exactly: `claude-haiku-4-5`

## Supabase Async Client
```python
from supabase import acreate_client
client = await acreate_client(url, key)
```

## Test Commands
```bash
cd backend
pytest tests/ -v                      # all tests
pytest tests/ -v -m "not integration" # unit tests only
pytest tests/ -v -m integration       # integration tests (real APIs)
```
