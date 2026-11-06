from dataclasses import dataclass
import json
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from app.config import settings


@dataclass
class SearchResult:
    source_name: str
    url: str
    title: str
    snippet: str
    risk: str
    removal_url: str | None = None
    risk_score: int = 0
    risk_keywords: list[str] | None = None
    result_kind: str = "live"


class SearchUnavailable(Exception):
    pass


RISK_SCORES = {"low": 10, "medium": 35, "high": 65, "critical": 90, "unknown": 0}


def keyword_risk(text: str, keyword_groups: dict[str, list[str]]) -> tuple[str, int, list[str]]:
    normalized = re.sub(r"\s+", " ", text.casefold())
    found: list[tuple[str, str]] = []
    for level in ("critical", "high", "medium", "low"):
        for keyword in keyword_groups.get(level, []):
            if keyword.casefold() in normalized:
                found.append((level, keyword))
    if not found:
        return "low", RISK_SCORES["low"], []
    rank = {"low": 1, "medium": 2, "high": 3, "critical": 4}
    level = max((item[0] for item in found), key=rank.get)
    # Higher levels dominate, then additional matched terms increase the score modestly.
    score = min(100, RISK_SCORES[level] + (len({kw for _, kw in found}) - 1) * 4)
    return level, score, list(dict.fromkeys(keyword for _, keyword in found))


def load_site_catalog() -> tuple[dict[str, list[str]], list[SearchResult]]:
    catalog_path = Path(__file__).resolve().parents[2] / "data" / "websites.json"
    with catalog_path.open(encoding="utf-8") as catalog_file:
        catalog = json.load(catalog_file)
    groups = catalog.get("danger_keywords", {})
    sites: list[SearchResult] = []
    for site in catalog.get("sites", []):
        matched_terms = site.get("keywords", [])
        risk, score, matched = keyword_risk(" ".join(matched_terms), groups)
        sites.append(SearchResult(
            source_name=site["name"],
            url=site["url"],
            title=f"{site.get('category', 'Website')} · Catalog source",
            snippet="Catalog source only. This does not confirm that your email or personal data appears on this website.",
            risk=risk,
            removal_url=site.get("removal_url"),
            risk_score=score,
            risk_keywords=matched,
            result_kind="catalog",
        ))
    return groups, sites


class SearchProvider:
    async def search(self, email: str) -> list[SearchResult]:
        raise NotImplementedError


class BraveSearchProvider(SearchProvider):
    """Uses the official Brave Search API. Does not crawl arbitrary websites."""

    async def search(self, email: str) -> list[SearchResult]:
        if not settings.brave_search_api_key:
            raise SearchUnavailable("Search provider credentials are not configured")
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": f'"{email}"', "count": 20},
                headers={"X-Subscription-Token": settings.brave_search_api_key, "Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
        results: list[SearchResult] = []
        keyword_groups, _ = load_site_catalog()
        for item in payload.get("web", {}).get("results", []):
            url = item.get("url", "")
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                continue
            title = BeautifulSoup(item.get("title", ""), "html.parser").get_text(" ", strip=True)[:500]
            snippet = BeautifulSoup(item.get("description", ""), "html.parser").get_text(" ", strip=True)[:1200]
            haystack = f"{parsed.hostname} {title} {snippet}"
            risk, score, matched = keyword_risk(haystack, keyword_groups)
            results.append(SearchResult(parsed.hostname, url, title or parsed.hostname, snippet, risk,
                                        risk_score=score, risk_keywords=matched, result_kind="live"))
        return results


def get_search_provider() -> SearchProvider:
    if settings.search_provider == "brave":
        return BraveSearchProvider()
    raise SearchUnavailable("No supported search provider is configured")


def combine_results(live_results: list[SearchResult], catalog_results: list[SearchResult]) -> list[SearchResult]:
    """Merge live and catalog rows, dedupe identical URLs and sort by keyword danger score."""
    merged: dict[str, SearchResult] = {}
    for result in [*live_results, *catalog_results]:
        parsed = urlparse(result.url)
        key = (parsed.hostname or result.url).removeprefix("www.").casefold()
        existing = merged.get(key)
        if existing is None or (existing.result_kind == "catalog" and result.result_kind == "live"):
            merged[key] = result
    return sorted(merged.values(), key=lambda row: (-row.risk_score, row.source_name.casefold(), row.url))
