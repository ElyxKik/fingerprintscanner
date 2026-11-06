from datetime import datetime, timezone
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ScanStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class User(Base):
    __tablename__ = "users"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    email_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    email_lookup_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    scans: Mapped[list["Scan"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Scan(Base):
    __tablename__ = "scans"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[ScanStatus] = mapped_column(Enum(ScanStatus), default=ScanStatus.queued)
    ownership_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    user: Mapped[User] = relationship(back_populates="scans")
    results: Mapped[list["Finding"]] = relationship(back_populates="scan", cascade="all, delete-orphan")


class Finding(Base):
    __tablename__ = "findings"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    scan_id: Mapped[UUID] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"), index=True)
    source_name: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    snippet: Mapped[str] = mapped_column(Text, nullable=False, default="")
    risk: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    risk_keywords: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    result_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="live")
    removal_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    scan: Mapped[Scan] = relationship(back_populates="results")


class CleanupRequest(Base):
    __tablename__ = "cleanup_requests"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    finding_id: Mapped[UUID] = mapped_column(ForeignKey("findings.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    request_text: Mapped[str] = mapped_column(Text, nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    plan: Mapped[str] = mapped_column(String(30), nullable=False)
    amount_eur: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    finding_id: Mapped[UUID] = mapped_column(ForeignKey("findings.id", ondelete="CASCADE"), index=True)
    source_name: Mapped[str] = mapped_column(String(250), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AccessToken(Base):
    __tablename__ = "access_tokens"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scan_id: Mapped[UUID | None] = mapped_column(ForeignKey("scans.id", ondelete="CASCADE"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
