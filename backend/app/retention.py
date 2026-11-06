from datetime import datetime, timedelta, timezone

from sqlalchemy import delete

from app.config import settings
from app.database import SessionLocal
from app.models import Scan


async def purge_expired_scans() -> int:
    """Delete scans and related findings older than configured retention; schedule with cron/ARQ."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.data_retention_days)
    async with SessionLocal() as session:
        result = await session.execute(delete(Scan).where(Scan.created_at < cutoff))
        await session.commit()
        return result.rowcount or 0
