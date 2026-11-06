from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ScanCreate(BaseModel):
    email: EmailStr
    ownership_confirmed: Literal[True]


class MagicLinkVerify(BaseModel):
    token: str


class MagicLinkRequest(BaseModel):
    email: EmailStr
    scan_id: UUID | None = None


class PasswordRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class PasswordLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    source_name: str
    url: str
    title: str
    snippet: str
    risk: str
    risk_score: int
    risk_keywords: list[str] = Field(default_factory=list)
    result_kind: str
    removal_url: str | None
    discovered_at: datetime


class ScanOut(BaseModel):
    id: UUID
    user_id: UUID | None = None
    status: str
    created_at: datetime
    completed_at: datetime | None
    findings: list[FindingOut] = Field(default_factory=list)


class CleanupDraftIn(BaseModel):
    finding_id: UUID


class CleanupDraftOut(BaseModel):
    id: UUID
    status: str
    request_text: str
    created_at: datetime


class OrderCreate(BaseModel):
    user_id: UUID
    plan: Literal["guided", "complete"]
    selected_finding_ids: list[UUID] = Field(default_factory=list)


class OrderOut(BaseModel):
    id: UUID
    plan: str
    amount_eur: int
    status: str
    selected_findings: list[dict] = Field(default_factory=list)
