"""Chat sessions + messages CRUD + Ask Sentinel HITL approvals.

Frontend `/chat` page: session list in sidebar, one page for the active
session. POST /{sid}/generate routes each user turn through
`ask_sentinel_agent`; POST /{sid}/approvals resumes a paused specialist
call after the user Approves / Rejects the in-thread card.
"""
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from api.auth_deps import get_current_user
from api.deps import get_db
from core.models import ChatMessage, ChatSession, User
from services.chat_reply import generate_reply, resume_reply


# ─── Response / request schemas ────────────────────────────────────────

class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    timestamp: datetime


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: Optional[str]
    model_used: Optional[str]
    created_at: datetime
    updated_at: datetime


class CreateSessionRequest(BaseModel):
    title: Optional[str] = "New Chat"
    # Kept for wire compatibility with the current frontend. No picker
    # UI exists; the value is unused server-side.
    model_used: Optional[str] = None


class CreateMessageRequest(BaseModel):
    role: str
    content: str


class GenerateRequest(BaseModel):
    content: str
    # Reserved for a future agent picker. Ignored — Ask Sentinel has one
    # persona baked into services/chat_reply.py.
    agent_id: Optional[str] = None


class ApprovalRequest(BaseModel):
    """Approve or reject a paused specialist call (HITL).

    The frontend picks `run_id` + `tool_call_id` out of the `[[APPROVAL:{...}]]`
    marker at the head of an assistant message and posts them back here
    when the user clicks Approve / Reject on the card.
    """
    run_id: str
    tool_call_id: str
    confirmed: bool


def get_chat_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

    @router.get("", response_model=List[ChatSessionResponse])
    def list_sessions(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        return (
            db.query(ChatSession)
            .filter(ChatSession.user_id == current_user.id)
            .order_by(ChatSession.updated_at.desc())
            .all()
        )

    @router.post("", response_model=ChatSessionResponse)
    def create_session(
        req: CreateSessionRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        session = ChatSession(
            tenant_id=current_user.tenant_id,
            user_id=current_user.id,
            title=req.title,
            model_used=req.model_used,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    @router.get("/{session_id}/messages", response_model=List[ChatMessageResponse])
    def get_session_messages(
        session_id: uuid.UUID,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        session = _owned_session(db, session_id, current_user)
        return (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == session.id)
            .order_by(ChatMessage.timestamp.asc())
            .all()
        )

    @router.post("/{session_id}/messages", response_model=ChatMessageResponse)
    def add_message(
        session_id: uuid.UUID,
        req: CreateMessageRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        session = _owned_session(db, session_id, current_user)
        msg = ChatMessage(session_id=session.id, role=req.role, content=req.content)
        db.add(msg)
        session.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(msg)
        return msg

    @router.post("/{session_id}/generate", response_model=ChatMessageResponse)
    async def generate_message(
        session_id: uuid.UUID,
        req: GenerateRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        session = _owned_session(db, session_id, current_user)

        # 1. Persist the user turn immediately so a slow model call can't lose it.
        user_msg = ChatMessage(session_id=session.id, role="user", content=req.content)
        db.add(user_msg)
        session.updated_at = datetime.utcnow()
        db.commit()

        # 2. Ask Sentinel.
        return await generate_reply(
            db=db,
            session_id=session_id,
            user_message_content=req.content,
        )

    @router.post("/{session_id}/approvals", response_model=ChatMessageResponse)
    async def approve_specialist_call(
        session_id: uuid.UUID,
        req: ApprovalRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        """Resume a paused Ask Sentinel run after the user Approves / Rejects.

        On Approve: Agno fires the specialist tool and formats the answer.
        On Reject:  Agno skips the tool and gives a text-only reply.
        Either way, the resulting assistant turn is persisted and returned.
        """
        session = _owned_session(db, session_id, current_user)
        return await resume_reply(
            db=db,
            session_id=session.id,
            run_id=req.run_id,
            tool_call_id=req.tool_call_id,
            confirmed=req.confirmed,
        )

    @router.delete("/{session_id}", status_code=204)
    def delete_session(
        session_id: uuid.UUID,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
    ):
        session = _owned_session(db, session_id, current_user)
        db.delete(session)
        db.commit()
        return None

    return router


def _owned_session(db: Session, session_id: uuid.UUID, current_user: User) -> ChatSession:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session
