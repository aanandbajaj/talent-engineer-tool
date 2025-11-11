from __future__ import annotations

# Very light heuristic compensation estimator for prototype use.
# Returns estimated annual total comp in USD for a given organization and year.

from dataclasses import dataclass


@dataclass
class CompEstimate:
    year: int
    amount_usd: int
    band: str  # e.g., "industry-tier1", "academia"
    basis: str  # short text describing the heuristic


BIG_TECH = {
    "google",
    "deepmind",
    "openai",
    "microsoft",
    "meta",
    "facebook",
    "apple",
    "amazon",
    "nvidia",
    "anthropic",
    "xai",
}


def classify_org(org_name: str) -> str:
    n = (org_name or "").lower()
    if any(k in n for k in ["university", "college", "institute", "mit", "stanford", "cmu", "berkeley", "oxford", "cambridge"]):
        return "academia"
    if any(k in n for k in ["lab", "laboratory", "nasa", "nih", "doe"]):
        return "gov_lab"
    if any(bt in n for bt in BIG_TECH):
        return "industry-tier1"
    if any(k in n for k in ["research", "ai", "ml"]):
        return "startup-elite"
    return "industry-other"


def base_amount_for_band(band: str) -> int:
    return {
        "academia": 140_000,
        "gov_lab": 160_000,
        "industry-tier1": 325_000,
        "startup-elite": 280_000,
        "industry-other": 220_000,
    }.get(band, 200_000)


def estimate_compensation(org_name: str, year: int) -> CompEstimate:
    band = classify_org(org_name or "unknown")
    base = base_amount_for_band(band)
    # Very mild inflation adjustment (~2% YoY from 2016 baseline)
    years_from_2016 = max(0, year - 2016)
    adjusted = int(base * (1.02 ** years_from_2016))
    return CompEstimate(year=year, amount_usd=adjusted, band=band, basis=f"heuristic by org band ({band}) with 2% YoY")

