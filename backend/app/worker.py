import json
from datetime import datetime, timezone
from uuid import UUID

from arq import create_pool
from arq.connections import RedisSettings
from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import Finding, Scan, ScanStatus, User
from app.security import _fernet
from app.services.ai import get_ai_provider
from app.services.search import SearchUnavailable, combine_results, get_search_provider, load_site_catalog


async def run_scan(ctx: dict, scan_id: str) -> None:
    async with SessionLocal() as session:
        scan = await session.get(Scan, UUID(scan_id))
        if scan is None:
            return
        user = await session.get(User, scan.user_id)
        if user is None:
            scan.status, scan.error_code = ScanStatus.failed, "user_missing"
            await session.commit()
            return
        try:
            email = _fernet().decrypt(user.email_ciphertext.encode()).decode()
        except Exception:
            scan.status, scan.error_code = ScanStatus.failed, "encryption_key_invalid"
            await session.commit()
            return
        scan.status = ScanStatus.running
        await session.commit()
        try:
            ai = get_ai_provider()
            _, catalog_results = load_site_catalog()
            try:
                provider = get_search_provider()
                live_results = await provider.search(email)
            except SearchUnavailable:
                # The free local scan still reports the manually curated catalog when live search is not configured.
                live_results = []
            results = combine_results(live_results, catalog_results)
            for result in results:
                analysis = await ai.analyze(result.title, result.snippet, result.source_name) if result.result_kind == "live" else None
                session.add(Finding(scan_id=scan.id, source_name=result.source_name, url=result.url,
                                    title=result.title, snippet=result.snippet, risk=analysis.risk if analysis else result.risk,
                                    risk_score=max(result.risk_score, {"low": 10, "medium": 35, "high": 65, "critical": 90}.get(analysis.risk, 0)) if analysis else result.risk_score,
                                    risk_keywords=json.dumps(result.risk_keywords or []),
                                    result_kind=result.result_kind,
                                    removal_url=result.removal_url))
            scan.status = ScanStatus.completed
            scan.completed_at = datetime.now(timezone.utc)
        except Exception:
            scan.status = ScanStatus.failed
            scan.error_code = "provider_unavailable"
        await session.commit()


class WorkerSettings:
    functions = [run_scan]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 10
    job_timeout = 90


async def enqueue_scan(scan_id: UUID) -> None:
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        await redis.enqueue_job("run_scan", str(scan_id))
    finally:
        await redis.aclose()
