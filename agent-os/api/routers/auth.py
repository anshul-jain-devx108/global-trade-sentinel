"""Microsoft SSO + session cookie router.

Flow:
  1. Browser hits `/api/v1/auth/microsoft/login` → we redirect to Microsoft.
  2. Microsoft calls back on `/api/v1/auth/microsoft/callback` — we sync the
     user to the `users` table, mint a JWT, and set it as an HTTP-only
     cookie before redirecting the browser to the frontend.
  3. Every subsequent request carries that cookie automatically.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from fastapi_sso.sso.microsoft import MicrosoftSSO
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.auth_deps import create_access_token, get_current_user
from api.deps import get_db
from core.models import Tenant, User


# ─── SSO configuration ────────────────────────────────────────────────
CLIENT_ID = os.environ.get("MICROSOFT_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("MICROSOFT_CLIENT_SECRET", "")
TENANT_ID = os.environ.get("MICROSOFT_TENANT_ID", "common")

# Must match the value registered on the Azure App Registration.
REDIRECT_URI = os.environ.get(
    "MICROSOFT_REDIRECT_URI",
    "http://localhost:8000/api/v1/auth/microsoft/callback",
)
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

sso = MicrosoftSSO(
    client_id=CLIENT_ID,
    client_secret=CLIENT_SECRET,
    redirect_uri=REDIRECT_URI,
    allow_insecure_http=True,
    tenant=TENANT_ID,
)


def get_auth_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

    @router.get("/microsoft/login")
    async def microsoft_login():
        async with sso:
            return await sso.get_login_redirect()

    @router.get("/microsoft/callback")
    async def microsoft_callback(request: Request, db: Session = Depends(get_db)):
        error = request.query_params.get("error")
        if error:
            error_description = request.query_params.get("error_description", "Authentication failed.")
            return RedirectResponse(
                url=f"{FRONTEND_URL}/login?error={error}&error_description={error_description}"
            )

        try:
            async with sso:
                user_info = await sso.verify_and_process(request)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"SSO Error: {e}")

        if not user_info:
            raise HTTPException(status_code=401, detail="Authentication failed")

        # 1. Look up or create the user
        user = db.query(User).filter(
            (User.microsoft_oid == user_info.id) | (User.email == user_info.email)
        ).first()

        if not user:
            # First user gets a default tenant auto-provisioned.
            tenant = db.query(Tenant).first()
            if not tenant:
                tenant = Tenant(name="Default Workspace")
                db.add(tenant)
                db.flush()

            user = User(
                tenant_id=tenant.id,
                email=user_info.email,
                full_name=user_info.display_name,
                microsoft_oid=user_info.id,
                role="user",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        elif not user.microsoft_oid:
            user.microsoft_oid = user_info.id
            db.commit()

        # 2. Mint the session cookie
        access_token = create_access_token(data={"sub": str(user.id)})
        redirect_res = RedirectResponse(url=f"{FRONTEND_URL}/chat")
        redirect_res.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            secure=False,
            samesite="lax",
            max_age=7 * 24 * 60 * 60,
        )
        return redirect_res

    @router.get("/me")
    async def get_me(current_user: User = Depends(get_current_user)):
        return {
            "id": str(current_user.id),
            "email": current_user.email,
            "full_name": current_user.full_name,
            "role": current_user.role,
            "tenant_id": str(current_user.tenant_id),
        }

    class UpdateProfileRequest(BaseModel):
        full_name: str

    @router.put("/me")
    async def update_me(
        req: UpdateProfileRequest,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        current_user.full_name = req.full_name
        db.commit()
        db.refresh(current_user)
        return {
            "id": str(current_user.id),
            "email": current_user.email,
            "full_name": current_user.full_name,
            "role": current_user.role,
            "tenant_id": str(current_user.tenant_id),
        }

    @router.post("/logout")
    async def logout(response: Response):
        response.delete_cookie(key="access_token", httponly=True, samesite="lax")
        return {"status": "logged_out"}

    return router
