import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, DateTime, Index, Uuid, text
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()




class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    plan = Column(String, nullable=False, default="enterprise")
    created_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"))


class User(Base):
    __tablename__ = "users"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id = Column(Uuid, ForeignKey("tenants.id"), nullable=False)
    email = Column(String, nullable=False, unique=True)
    full_name = Column(String)
    role = Column(String, nullable=False, default="user")
    # Legacy column — not populated by SSO flow, retained for schema compatibility.
    password_hash = Column(String)
    microsoft_oid = Column(String, unique=True)
    created_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"))


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id = Column(Uuid, ForeignKey("tenants.id"), nullable=False)
    user_id = Column(Uuid, ForeignKey("users.id"), nullable=False)
    title = Column(String, default="New Chat")
    model_used = Column(String)
    created_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"), onupdate=datetime.utcnow)

    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id = Column(Uuid, ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String, nullable=False)
    content = Column(String, nullable=False)
    timestamp = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"))

    session = relationship("ChatSession", back_populates="messages")


class RegulatoryEvent(Base):
    """A single regulatory / trade-compliance event discovered by the sweep team.

    Dates are separated by intent so filters and UI can distinguish them:
      - published_at   : when the regulator announced it (Federal Register, EUR-Lex, etc.)
      - effective_from : when the rule/sanction actually takes force
      - effective_until: when it expires (nullable — most are open-ended)
      - detected_at    : when *our* sweep first surfaced it (audit trail)
    """
    __tablename__ = "regulatory_events"

    id = Column(String, primary_key=True)          # e.g. 'EVT-001'
    event_type   = Column(String, nullable=False, default="REGULATORY", index=True)
    severity     = Column(String, nullable=False, index=True)
    title        = Column(String, nullable=False)
    jurisdiction = Column(String, nullable=False, index=True)

    published_at    = Column(Date, nullable=True, index=True)
    effective_from  = Column(Date, nullable=True, index=True)
    effective_until = Column(Date, nullable=True)
    detected_at     = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    description = Column(Text, nullable=False)
    impact      = Column(Text, nullable=False)

    # Lifecycle: NEW → ACKNOWLEDGED → DISMISSED (soft-delete)
    status = Column(String, nullable=False, default="NEW", index=True)

    # Deterministic hash over (event_type, jurisdiction, title, effective_from)
    # so re-sweeps don't create duplicates.
    dedupe_hash = Column(String, nullable=True, unique=True, index=True)

    affected_entities = relationship("AffectedEntity", back_populates="event", cascade="all, delete-orphan")
    citations         = relationship("Citation",      back_populates="event", cascade="all, delete-orphan")


# Composite index for the common list query: filter by status+severity, sort by effective_from desc.
Index("ix_events_status_sev_effective", RegulatoryEvent.status, RegulatoryEvent.severity, RegulatoryEvent.effective_from.desc())


class AffectedEntity(Base):
    __tablename__ = "affected_entities"

    id       = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(String, ForeignKey("regulatory_events.id"), nullable=False, index=True)
    name     = Column(String, nullable=False)

    event = relationship("RegulatoryEvent", back_populates="affected_entities")


class Citation(Base):
    __tablename__ = "citations"

    id       = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(String, ForeignKey("regulatory_events.id"), nullable=False, index=True)
    title    = Column(String, nullable=False)
    url      = Column(String, nullable=False)

    event = relationship("RegulatoryEvent", back_populates="citations")


class CompanyProfile(Base):
    __tablename__ = "company_profile"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    company_name      = Column(String, nullable=False)
    industry          = Column(String)
    business_type     = Column(Text)
    business_overview = Column(Text)

    export_countries  = Column(Text)
    import_countries  = Column(Text)
    monitor_countries = Column(Text)

    certifications         = Column(Text)
    monitoring_preferences = Column(Text)
    # JSON-encoded list of top-supplier names (usually "Name (Country)").
    # Consumed by the sanctions specialist for batched entity-list screening.
    top_suppliers          = Column(Text)
    additional_context     = Column(Text)

    # ── Tier-A trade-exposure fields (added 2026-07-31).
    # Sharply improve specialist output over vanilla HS + country data.
    # See memory/reference_compliance_domain.md for rationale.

    # JSON-encoded list of Incoterms 2020 the company operates under
    # (e.g. ["DDP","FOB","EXW"]). Direction of duty burden pivots on this.
    incoterms = Column(Text)

    # Annual export/import volume tier — one of:
    #   "<1M", "1-10M", "10-100M", "100M+", or None if unknown.
    # License thresholds, CTPAT eligibility, EU General Authorisations gate on this.
    volume_tier = Column(String)

    # End-use / end-user category driving OFAC 50%-rule, Entity List MEU, EAR 744.11.
    # One of: "commercial", "military", "government", "state_owned",
    # "research", "consumer", "mixed".
    end_use_category = Column(String)

    products = relationship("Product", back_populates="profile", cascade="all, delete-orphan")


class Product(Base):
    __tablename__ = "products"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    profile_id  = Column(Integer, ForeignKey("company_profile.id"), nullable=False, index=True)
    name        = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    hs_code     = Column(String, nullable=True, index=True)  # optional — matches frontend
    # Export-control classification: ECCN (US EAR), USML (ITAR), EU dual-use code,
    # or literals "EAR99" / "unknown". Biggest single unlock for the export-control agent.
    eccn        = Column(String, nullable=True)

    profile = relationship("CompanyProfile", back_populates="products")
