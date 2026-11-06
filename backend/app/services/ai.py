from dataclasses import dataclass

import httpx

from app.config import settings


@dataclass
class Analysis:
    risk: str
    explanation: str
    recommended_action: str


class AIProvider:
    async def analyze(self, title: str, snippet: str, domain: str) -> Analysis:
        raise NotImplementedError

    async def draft_removal(self, site_name: str, listing_url: str, reason: str) -> str:
        raise NotImplementedError


class RuleBasedAI(AIProvider):
    """Safe local fallback: no third-party model receives scan data."""

    async def analyze(self, title: str, snippet: str, domain: str) -> Analysis:
        sensitive = any(word in f"{title} {snippet}".lower() for word in ("address", "phone", "people search", "data broker"))
        return Analysis(
            risk="high" if sensitive else "low",
            explanation="This result may expose contact details. Review the page before taking action." if sensitive else "This appears to be a public profile. Check that its visible details are intentional.",
            recommended_action="Review the site's opt-out process." if sensitive else "Review your profile privacy settings.",
        )

    async def draft_removal(self, site_name: str, listing_url: str, reason: str) -> str:
        return (
            f"Subject: Request to remove personal information\n\n"
            f"Hello {site_name} privacy team,\n\n"
            f"I am requesting review and removal of my personal information from this page: {listing_url}. "
            f"{reason}\nPlease let me know if you need additional information to process this request.\n\n"
            "Thank you."
        )


class OpenAICompatibleAI(AIProvider):
    """Optional OpenAI/DeepSeek compatible adapter, gated by explicit opt-in."""

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url, self.api_key, self.model = base_url.rstrip("/"), api_key, model

    async def _complete(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.2},
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]

    async def analyze(self, title: str, snippet: str, domain: str) -> Analysis:
        # PII is not included in prompts. Search snippet/title may themselves contain personal data,
        # so enabling this adapter is an explicit operator decision.
        content = await self._complete(
            "Classify this public web search result for privacy exposure. Do not infer identity. "
            "Return JSON with risk (low/medium/high), explanation, recommended_action. "
            f"Domain: {domain}\nTitle: {title[:300]}\nSnippet: {snippet[:700]}"
        )
        import json
        try:
            data = json.loads(content)
            risk = data.get("risk", "medium")
            if risk not in {"low", "medium", "high"}:
                risk = "medium"
            return Analysis(risk, str(data.get("explanation", "Review this public result."))[:500], str(data.get("recommended_action", "Review the page."))[:300])
        except (ValueError, TypeError):
            return Analysis("medium", "Review this public result for personal information.", "Review the page and its privacy options.")

    async def draft_removal(self, site_name: str, listing_url: str, reason: str) -> str:
        return (await self._complete(
            "Write a concise, polite removal request. Do not claim legal rights or facts not provided. "
            f"Site: {site_name}\nURL: {listing_url}\nUser reason: {reason}"
        ))[:5000]


def get_ai_provider() -> AIProvider:
    if settings.ai_provider == "openai_compatible" and settings.ai_api_key and settings.ai_base_url and settings.ai_model:
        return OpenAICompatibleAI(settings.ai_base_url, settings.ai_api_key, settings.ai_model)
    return RuleBasedAI()
