from pydantic import BaseModel, Field
from typing import Optional
from firecrawl import FirecrawlApp, JsonConfig

from app.config import ScraperConfig
from app.models.lead import ContractorRecord

GAF_COMMERCIAL_URL = (
    "https://www.gaf.com/en-us/roofing-contractors/commercial"
    "?postalCode={postal_code}&countryCode={country_code}&distance={distance}"
)


class _ContractorSchema(BaseModel):
    company_name: str = Field(..., description="Full trading name of the roofing contractor")
    address: Optional[str] = Field(None, description="Street address")
    city: Optional[str] = Field(None, description="City")
    state: Optional[str] = Field(None, description="Two-letter US state abbreviation, e.g. NY")
    postal_code: Optional[str] = Field(None, description="5-digit postal/ZIP code")
    country_code: Optional[str] = Field(None, description="Two-letter country code, e.g. us")
    phone: Optional[str] = Field(None, description="Business phone number")
    website: Optional[str] = Field(None, description="Company website URL")
    gaf_profile_url: Optional[str] = Field(None, description="URL to this contractor's GAF profile page")
    certifications: list[str] = Field(
        default_factory=list,
        description="GAF certification tier(s), e.g. ['Master Elite', 'Certified Contractor']",
    )
    rating: Optional[float] = Field(None, description="Star rating 0.0-5.0")
    review_count: Optional[int] = Field(None, description="Number of customer reviews")
    years_in_business: Optional[int] = Field(None, description="Years in business, if shown")
    service_area: Optional[str] = Field(None, description="Service area description, if shown")
    gaf_contractor_id: Optional[str] = Field(
        None, description="GAF's own identifier, if present in the URL or page"
    )


class _GAFContractorList(BaseModel):
    contractors: list[_ContractorSchema] = Field(
        ..., description="All roofing contractors listed on this page"
    )


class GafScraper:
    def __init__(self, api_key: str):
        self._app = FirecrawlApp(api_key=api_key)

    def scrape_contractors(self, config: ScraperConfig) -> list[ContractorRecord]:
        url = GAF_COMMERCIAL_URL.format(
            postal_code=config.postal_code,
            country_code=config.country_code,
            distance=config.distance,
        )

        result = self._app.scrape_url(
            url,
            formats=["json"],
            json_options=JsonConfig(schema=_GAFContractorList.model_json_schema()),
            only_main_content=False,
            timeout=60000,
        )

        # firecrawl-py 2.x: JSON data is in result.json_field (alias 'json')
        json_data = getattr(result, "json_field", None)
        if not json_data:
            return []

        raw_contractors = json_data.get("contractors", []) if isinstance(json_data, dict) else []

        contractors = [
            ContractorRecord(
                company_name=c.get("company_name", "Unknown"),
                gaf_contractor_id=c.get("gaf_contractor_id"),
                address=c.get("address"),
                city=c.get("city"),
                state=c.get("state"),
                postal_code=c.get("postal_code"),
                country_code=c.get("country_code") or config.country_code,
                phone=c.get("phone"),
                website=c.get("website"),
                gaf_profile_url=c.get("gaf_profile_url"),
                certifications=c.get("certifications") or [],
                rating=c.get("rating"),
                review_count=c.get("review_count"),
                years_in_business=c.get("years_in_business"),
                service_area=c.get("service_area"),
            )
            for c in raw_contractors
            if c.get("company_name")
        ]

        if config.limit is not None:
            contractors = contractors[: config.limit]

        return contractors
