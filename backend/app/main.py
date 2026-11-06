from contextlib import asynccontextmanager
import asyncio
from datetime import datetime, timezone, timedelta
import json
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, status, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import create_schema, get_session
from app.models import AccessToken, CleanupRequest, Finding, Order, OrderItem, Scan, ScanStatus, User
from app.schemas import CleanupDraftIn, CleanupDraftOut, MagicLinkRequest, MagicLinkVerify, OrderCreate, OrderOut, PasswordLogin, PasswordRegister, ScanCreate, ScanOut, FindingOut
from app.security import encrypt_email, hash_password, lookup_hash, new_magic_token, token_hash, verify_password
from app.services.ai import get_ai_provider
from app.services.search import load_site_catalog
from app.worker import enqueue_scan


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.app_env == "development":
        await create_schema()
    yield


app = FastAPI(title="FingerprintScanner API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                   allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "Authorization"])


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


async def _new_access_session(session: AsyncSession, user_id: UUID) -> str:
    access_token = new_magic_token()
    session.add(AccessToken(user_id=user_id, token_hash=token_hash(access_token),
                            expires_at=datetime.now(timezone.utc) + timedelta(days=7)))
    return access_token


async def authenticated_user(authorization: str | None, session: AsyncSession) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="A verified session is required")
    digest = token_hash(authorization.split(None, 1)[1])
    row = await session.scalar(select(AccessToken).where(AccessToken.token_hash == digest))
    if row is None or row.consumed_at is not None or _utc(row.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await session.get(User, row.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Account not found")
    return user


@app.post("/api/auth/request-link", status_code=202)
async def request_magic_link(payload: MagicLinkRequest, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    await session.execute(delete(AccessToken).where(AccessToken.expires_at < datetime.now(timezone.utc)))
    try:
        digest = lookup_hash(str(payload.email))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Secure sign-in is not configured") from exc
    user = await session.scalar(select(User).where(User.email_lookup_hash == digest))
    # First visit creates the account record; the email owner must still confirm via the emailed link.
    if user is None:
        user = User(email_ciphertext=encrypt_email(str(payload.email)), email_lookup_hash=digest)
        session.add(user)
        await session.flush()
    token = new_magic_token()
    row = AccessToken(user_id=user.id, token_hash=token_hash(token), expires_at=datetime.now(timezone.utc) + timedelta(minutes=15))
    session.add(row)
    if payload.scan_id:
        scan = await session.get(Scan, payload.scan_id)
        if scan is not None and scan.user_id == user.id:
            row.scan_id = scan.id
    await session.commit()
    link = f"{settings.frontend_base_url}/auth/verify?token={token}"
    if settings.email_delivery_mode == "console" and settings.app_env == "development":
        print(f"FingerprintScanner sign-in link (development only): {link}")
    return {"status": "if_account_exists_link_sent"}


@app.post("/api/auth/register", status_code=202)
async def register_account(payload: PasswordRegister, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Create a password account; email ownership must be verified before sign-in."""
    if settings.app_env != "development" or settings.email_delivery_mode != "console":
        raise HTTPException(status_code=503, detail="Email verification delivery is only configured for local development")
    email = str(payload.email).strip().lower()
    try:
        digest = lookup_hash(email)
        ciphertext = encrypt_email(email)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Secure registration is not configured") from exc

    user = await session.scalar(select(User).where(User.email_lookup_hash == digest))
    password_hash = await asyncio.to_thread(hash_password, payload.password)
    if user is None:
        user = User(email_ciphertext=ciphertext, email_lookup_hash=digest, password_hash=password_hash)
        session.add(user)
        await session.flush()
    elif user.password_hash is not None:
        if user.email_verified_at is not None:
            raise HTTPException(status_code=409, detail="Un compte existe déjà pour cette adresse. Connectez-vous.")
    else:
        # A previous free scan may have created the account row before registration.
        user.email_ciphertext = ciphertext
        user.password_hash = password_hash

    if user.email_verified_at is not None:
        access_token = await _new_access_session(session, user.id)
        await session.commit()
        return {"status": "registered", "access_token": access_token, "user_id": str(user.id)}

    verification_token = new_magic_token()
    session.add(AccessToken(user_id=user.id, token_hash=token_hash(verification_token),
                            expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    await session.commit()
    link = f"{settings.frontend_base_url}/auth/verify?token={verification_token}"
    print(f"FingerprintScanner email verification link (development only): {link}")
    return {"status": "verification_required", "delivery_mode": "console"}


@app.post("/api/auth/login")
async def login_account(payload: PasswordLogin, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    email = str(payload.email).strip().lower()
    try:
        digest = lookup_hash(email)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Secure sign-in is not configured") from exc
    user = await session.scalar(select(User).where(User.email_lookup_hash == digest))
    valid_password = await asyncio.to_thread(verify_password, payload.password, user.password_hash if user else None)
    if user is None or not valid_password:
        raise HTTPException(status_code=401, detail="Adresse e-mail ou mot de passe incorrect")
    if user.email_verified_at is None:
        raise HTTPException(status_code=403, detail="Confirmez votre adresse depuis le lien reçu dans le terminal de l’API")
    access_token = await _new_access_session(session, user.id)
    await session.commit()
    return {"access_token": access_token, "token_type": "bearer", "user_id": str(user.id), "scan_id": ""}


@app.post("/api/auth/verify")
async def verify_magic_link(payload: MagicLinkVerify, session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    row = await session.scalar(select(AccessToken).where(AccessToken.token_hash == token_hash(payload.token)))
    now = datetime.now(timezone.utc)
    if row is None or row.consumed_at is not None or _utc(row.expires_at) < now:
        raise HTTPException(status_code=400, detail="Sign-in link is invalid or expired")
    user_id = row.user_id
    row.consumed_at = now
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Account not found")
    user.email_verified_at = user.email_verified_at or now
    scan_id = row.scan_id
    if scan_id:
        scan = await session.get(Scan, scan_id)
        if scan is None or scan.user_id != user_id:
            scan_id = None
    # Return the opaque session secret separately; only its digest is stored.
    access_token = await _new_access_session(session, user_id)
    await session.commit()
    return {"access_token": access_token, "token_type": "bearer", "user_id": str(user_id), "scan_id": str(scan_id) if scan_id else ""}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/catalog")
async def public_site_catalog() -> list[dict]:
    """Return curated catalog entries for display; these are not scan findings."""
    _, sites = load_site_catalog()
    return [{
        "source_name": site.source_name,
        "url": site.url,
        "title": site.title,
        "snippet": site.snippet,
        "risk": site.risk,
        "risk_score": site.risk_score,
        "risk_keywords": site.risk_keywords or [],
        "result_kind": "catalog",
        "removal_url": site.removal_url,
    } for site in sites]


@app.post("/api/scans", response_model=ScanOut, status_code=status.HTTP_202_ACCEPTED)
async def create_scan(payload: ScanCreate, authorization: str | None = Header(default=None), session: AsyncSession = Depends(get_session)) -> ScanOut:
    """Run the public footprint scan at no charge; this endpoint never creates an order."""
    normalized_email = str(payload.email).strip().lower()
    try:
        digest, ciphertext = lookup_hash(normalized_email), encrypt_email(normalized_email)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Secure scan intake is not configured") from exc
    user = await session.scalar(select(User).where(User.email_lookup_hash == digest))
    verified = await authenticated_user(authorization, session) if authorization else None
    if verified and verified.email_lookup_hash != digest:
        raise HTTPException(status_code=403, detail="Authenticated email does not match")
    if user is None:
        user = User(email_ciphertext=ciphertext, email_lookup_hash=digest)
        session.add(user)
        await session.flush()
    elif verified is not None:
        user.email_ciphertext = ciphertext
    scan = Scan(user_id=user.id, ownership_confirmed=True, status=ScanStatus.queued)
    session.add(scan)
    await session.commit()
    try:
        await enqueue_scan(scan.id)
    except Exception as exc:
        scan.status, scan.error_code = ScanStatus.failed, "queue_unavailable"
        await session.commit()
        raise HTTPException(status_code=503, detail="Scan queue is temporarily unavailable") from exc
    return ScanOut(id=scan.id, status=scan.status.value, created_at=scan.created_at, completed_at=None, findings=[])


async def _get_scan(scan_id: UUID, session: AsyncSession) -> Scan:
    scan = await session.get(Scan, scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan


@app.get("/api/scans/{scan_id}", response_model=ScanOut)
async def read_scan(scan_id: UUID, authorization: str | None = Header(default=None), session: AsyncSession = Depends(get_session)) -> ScanOut:
    scan = await _get_scan(scan_id, session)
    if authorization:
        user = await authenticated_user(authorization, session)
        if scan.user_id != user.id:
            raise HTTPException(status_code=403, detail="Forbidden")
    else:
        return ScanOut(id=scan.id, status=scan.status.value, created_at=scan.created_at,
                       completed_at=scan.completed_at, findings=[])
    findings = (await session.scalars(select(Finding).where(Finding.scan_id == scan.id).order_by(Finding.discovered_at))).all()
    return ScanOut(id=scan.id, status=scan.status.value, created_at=scan.created_at,
                   completed_at=scan.completed_at, findings=[FindingOut(
                       id=x.id, source_name=x.source_name, url=x.url, title=x.title, snippet=x.snippet,
                       risk=x.risk, risk_score=x.risk_score, risk_keywords=json.loads(x.risk_keywords),
                       result_kind=x.result_kind, removal_url=x.removal_url, discovered_at=x.discovered_at,
                   ) for x in findings])


@app.get("/api/users/{user_id}/dashboard")
async def user_dashboard(user_id: UUID, authorization: str | None = Header(default=None), session: AsyncSession = Depends(get_session)) -> dict:
    user = await authenticated_user(authorization, session)
    if user.id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    scans = (await session.scalars(select(Scan).where(Scan.user_id == user.id).order_by(Scan.created_at.desc()))).all()
    orders = (await session.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc()))).all()
    order_items = (await session.scalars(select(OrderItem).join(Order, OrderItem.order_id == Order.id).where(Order.user_id == user.id))).all()
    items_by_order: dict[UUID, list[dict[str, str]]] = {}
    for item in order_items:
        items_by_order.setdefault(item.order_id, []).append({"source_name": item.source_name, "url": item.url})
    return {"user_id": user.id, "scans": [ScanOut(id=s.id, user_id=user.id, status=s.status.value, created_at=s.created_at,
            completed_at=s.completed_at, findings=[]) for s in scans],
            "orders": [{"id": o.id, "plan": o.plan, "amount_eur": o.amount_eur, "status": o.status,
                        "selected_findings": items_by_order.get(o.id, [])} for o in orders]}


@app.post("/api/scans/{scan_id}/cleanup-drafts", response_model=CleanupDraftOut, status_code=201)
async def create_cleanup_draft(scan_id: UUID, payload: CleanupDraftIn, authorization: str | None = Header(default=None), session: AsyncSession = Depends(get_session)) -> CleanupDraftOut:
    scan = await _get_scan(scan_id, session)
    user = await authenticated_user(authorization, session)
    if scan.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    finding = await session.get(Finding, payload.finding_id)
    if finding is None or finding.scan_id != scan.id:
        raise HTTPException(status_code=404, detail="Finding not found")
    from urllib.parse import urlparse
    domain = urlparse(finding.url).hostname or finding.source_name
    text = await get_ai_provider().draft_removal(domain, finding.url, "I did not consent to this personal information being displayed publicly.")
    draft = CleanupRequest(user_id=scan.user_id, finding_id=finding.id, request_text=text)
    session.add(draft)
    await session.commit()
    return CleanupDraftOut(id=draft.id, status=draft.status, request_text=draft.request_text, created_at=draft.created_at)


@app.get("/api/users/{user_id}/cleanup-drafts")
async def user_cleanup_drafts(user_id: UUID, authorization: str | None = Header(default=None), session: AsyncSession = Depends(get_session)) -> list[dict]:
    user = await authenticated_user(authorization, session)
    if user.id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    drafts = (await session.scalars(select(CleanupRequest).where(CleanupRequest.user_id == user_id).order_by(CleanupRequest.created_at.desc()))).all()
    return [{"id": d.id, "finding_id": d.finding_id, "status": d.status, "request_text": d.request_text, "created_at": d.created_at} for d in drafts]


@app.post("/api/cleanup-drafts/{draft_id}/approve", response_model=CleanupDraftOut)
async def approve_cleanup_draft(draft_id: UUID, authorization: str | None = Header(default=None), session: AsyncSession = Depends(get_session)) -> CleanupDraftOut:
    user = await authenticated_user(authorization, session)
    draft = await session.get(CleanupRequest, draft_id)
    if draft is None or draft.user_id != user.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    draft.status, draft.approved_at = "approved_for_user_submission", datetime.now(timezone.utc)
    await session.commit()
    return CleanupDraftOut(id=draft.id, status=draft.status, request_text=draft.request_text, created_at=draft.created_at)


@app.post("/api/orders", response_model=OrderOut, status_code=201)
async def create_order(payload: OrderCreate, authorization: str | None = Header(default=None), session: AsyncSession = Depends(get_session)) -> OrderOut:
    """Create a cleanup checkout intent only after the user explicitly clicks Nettoyer."""
    user = await authenticated_user(authorization, session)
    if user.id != payload.user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    selected_ids = list(dict.fromkeys(payload.selected_finding_ids))
    if payload.plan == "guided" and len(selected_ids) > 1:
        raise HTTPException(status_code=400, detail="Guided cleanup accepts one selected result")
    if payload.plan == "complete" and len(selected_ids) > 5:
        raise HTTPException(status_code=400, detail="Complete cleanup accepts up to five selected results")
    findings = []
    if selected_ids:
        findings = (await session.scalars(
            select(Finding).join(Scan, Finding.scan_id == Scan.id)
            .where(Finding.id.in_(selected_ids), Scan.user_id == user.id, Finding.result_kind == "live")
        )).all()
        if len(findings) != len(selected_ids):
            raise HTTPException(status_code=400, detail="Selected results must be real public matches from your scans")
    amount = 99 if payload.plan == "guided" else 199
    order = Order(user_id=user.id, plan=payload.plan, amount_eur=amount, status="checkout_unconfigured")
    session.add(order)
    await session.flush()
    items = [OrderItem(order_id=order.id, finding_id=finding.id, source_name=finding.source_name, url=finding.url) for finding in findings]
    session.add_all(items)
    await session.commit()
    return OrderOut(id=order.id, plan=order.plan, amount_eur=order.amount_eur, status=order.status,
                    selected_findings=[{"source_name": item.source_name, "url": item.url} for item in items])


@app.delete("/api/users/{user_id}", status_code=204)
async def delete_user_data(user_id: UUID, authorization: str | None = Header(default=None), session: AsyncSession = Depends(get_session)) -> None:
    user = await authenticated_user(authorization, session)
    if user.id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if user is not None:
        await session.delete(user)
        await session.commit()
