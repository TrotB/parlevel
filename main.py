import os
import json
from datetime import datetime, timezone
from typing import Annotated, Literal, Optional

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from auth import (
    COOKIE_NAME,
    REMEMBER_COOKIE,
    REMEMBER_DAYS,
    hash_pin,
    new_remember_token,
    new_session_token,
    normalize_store_code,
    session_expiry,
    verify_pin,
)
from database import get_db, init_db, utc_now
from security import audit_log, check_login_rate_limit, client_ip, record_login_attempt, user_agent
from seed import seed_demo_store

app = FastAPI(title="Inventi", docs_url=None if os.getenv("ENV") == "production" else "/docs")
app.add_middleware(GZipMiddleware, minimum_size=500)

_origins = os.getenv("ALLOWED_ORIGINS", "")
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Accept"],
    )

STATIC = __import__("pathlib").Path(__file__).parent / "static"
IS_PRODUCTION = os.getenv("RENDER") == "true" or os.getenv("ENV") == "production"


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://unpkg.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )
    if IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    return response


class LoginRequest(BaseModel):
    store_code: str = Field(min_length=3, max_length=40)
    pin: str = Field(min_length=4, max_length=12)
    remember_me: bool = False


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    store_code: str = Field(min_length=3, max_length=40)
    pin: str = Field(min_length=4, max_length=12)
    type: Literal["convenience", "restaurant", "other"] = "convenience"
    currency: str = "CAD"
    privacy_consent: bool = Field(description="Required PIPEDA consent")


class DeleteAccountRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=12)
    confirm: Literal["DELETE"] = "DELETE"


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=80)
    aisle: Optional[str] = None
    barcode: Optional[str] = None
    unit: Literal["each", "case", "pack"] = "each"
    on_hand: float = Field(ge=0, default=0)
    par: float = Field(ge=0, default=0)


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    aisle: Optional[str] = None
    barcode: Optional[str] = None
    unit: Optional[Literal["each", "case", "pack"]] = None
    on_hand: Optional[float] = Field(default=None, ge=0)
    par: Optional[float] = Field(default=None, ge=0)


class SettingsUpdate(BaseModel):
    organize_by: Optional[Literal["category", "aisle"]] = None
    alerts: Optional["AlertSettingsModel"] = None


class AlertSettingsModel(BaseModel):
    enabled: bool = False
    low_stock_count: int = Field(ge=1, le=500, default=5)
    browser_push: bool = True
    daily_digest: bool = False
    digest_hour: int = Field(ge=0, le=23, default=8)
    overstock_enabled: bool = False
    overstock_ratio: float = Field(ge=1.1, le=5.0, default=1.5)
    overstock_alert_count: int = Field(ge=1, le=500, default=3)


DEFAULT_ALERTS = {
    "enabled": False,
    "low_stock_count": 5,
    "browser_push": True,
    "daily_digest": False,
    "digest_hour": 8,
    "overstock_enabled": False,
    "overstock_ratio": 1.5,
    "overstock_alert_count": 3,
}


class BulkAisleUpdate(BaseModel):
    item_id: int
    aisle: Optional[str] = None


class BulkAisleRequest(BaseModel):
    updates: list[BulkAisleUpdate] = Field(min_length=1, max_length=500)


def parse_alerts(raw: str | None) -> dict:
    if not raw:
        return DEFAULT_ALERTS.copy()
    try:
        data = json.loads(raw)
        return {**DEFAULT_ALERTS, **data}
    except (json.JSONDecodeError, TypeError):
        return DEFAULT_ALERTS.copy()


class AdjustRequest(BaseModel):
    delta: Optional[float] = None
    set_to: Optional[float] = Field(default=None, ge=0)
    reason: Literal["count", "delivery", "sale", "manual"] = "manual"


def business_public(row) -> dict:
    data = dict(row)
    data.pop("pin_hash", None)
    if "alert_settings" in data:
        data["alert_settings"] = parse_alerts(data.get("alert_settings"))
    return data


def row_to_item(row, overstock_ratio: float = 1.5) -> dict:
    on_hand = float(row["on_hand"])
    par = float(row["par"])
    low = par > 0 and on_hand <= par
    overstock = par > 0 and on_hand > par * overstock_ratio
    return {
        "id": row["id"],
        "business_id": row["business_id"],
        "name": row["name"],
        "category": row["category"],
        "aisle": row["aisle"],
        "barcode": row["barcode"],
        "unit": row["unit"],
        "on_hand": on_hand,
        "par": par,
        "low": low,
        "overstock": overstock,
        "need": max(par - on_hand, 0) if low else 0,
        "excess": round(on_hand - par * overstock_ratio, 1) if overstock else 0,
        "updated_at": row["updated_at"],
    }


def _alert_ratio(business: dict) -> float:
    alerts = business.get("alert_settings") or DEFAULT_ALERTS
    if isinstance(alerts, dict):
        return float(alerts.get("overstock_ratio") or 1.5)
    return 1.5


def rows_to_items(rows, business: dict) -> list:
    ratio = _alert_ratio(business)
    return [row_to_item(r, ratio) for r in rows]


def _item_stats(conn, business_id: int, overstock_ratio: float) -> dict:
    total = conn.execute(
        "SELECT COUNT(*) AS c FROM items WHERE business_id = ?", (business_id,)
    ).fetchone()["c"]
    low = conn.execute(
        """
        SELECT COUNT(*) AS c FROM items
        WHERE business_id = ? AND par > 0 AND on_hand <= par
        """,
        (business_id,),
    ).fetchone()["c"]
    overstock = conn.execute(
        """
        SELECT COUNT(*) AS c FROM items
        WHERE business_id = ? AND par > 0 AND on_hand > par * ?
        """,
        (business_id, overstock_ratio),
    ).fetchone()["c"]
    ok = max(total - low - overstock, 0)
    stock_health = round((ok / total * 100) if total else 100, 1)
    categories = conn.execute(
        "SELECT COUNT(DISTINCT category) AS c FROM items WHERE business_id = ?",
        (business_id,),
    ).fetchone()["c"]
    return {
        "total_items": total,
        "low_count": low,
        "overstock_count": overstock,
        "ok_count": ok,
        "stock_health": stock_health,
        "category_count": categories,
    }


def _cookie_opts(max_age: int) -> dict:
    return {
        "httponly": True,
        "secure": IS_PRODUCTION,
        "samesite": "lax",
        "max_age": max_age,
        "path": "/",
    }


def set_session_cookie(response: Response, token: str, remember: bool = False) -> None:
    days = REMEMBER_DAYS if remember else 30
    response.set_cookie(key=COOKIE_NAME, value=token, **_cookie_opts(60 * 60 * 24 * days))


def set_remember_cookie(response: Response, token: str) -> None:
    response.set_cookie(key=REMEMBER_COOKIE, value=token, **_cookie_opts(60 * 60 * 24 * REMEMBER_DAYS))


def clear_auth_cookies(response: Response) -> None:
    for name in (COOKIE_NAME, REMEMBER_COOKIE):
        response.delete_cookie(name, path="/", secure=IS_PRODUCTION, samesite="lax")


def create_session(
    conn,
    business_id: int,
    ip: str,
    ua: str,
    remember: bool = False,
) -> str:
    token = new_session_token()
    days = REMEMBER_DAYS if remember else 30
    now = utc_now()
    conn.execute(
        """
        INSERT INTO sessions (token, business_id, created_at, expires_at, ip, user_agent, remember)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (token, business_id, now, session_expiry(days), ip, ua, 1 if remember else 0),
    )
    return token


def try_remember_login(conn, remember_token: str | None) -> str | None:
    if not remember_token:
        return None
    now = utc_now()
    row = conn.execute(
        """
        SELECT * FROM remember_tokens
        WHERE token = ? AND expires_at > ?
        """,
        (remember_token, now),
    ).fetchone()
    if not row:
        return None
    return create_session(conn, row["business_id"], "remember", "auto-login", remember=True)


def get_session_business(conn, token: str | None) -> dict | None:
    if not token:
        return None
    now = utc_now()
    session = conn.execute(
        "SELECT * FROM sessions WHERE token = ? AND expires_at > ?",
        (token, now),
    ).fetchone()
    if not session:
        return None
    row = conn.execute(
        "SELECT * FROM businesses WHERE id = ?", (session["business_id"],)
    ).fetchone()
    return business_public(row) if row else None


def resolve_business(
    session_token: str | None,
    remember_token: str | None,
) -> tuple[dict | None, str | None]:
    with get_db() as conn:
        business = get_session_business(conn, session_token)
        if business:
            return business, session_token
        new_session = try_remember_login(conn, remember_token)
        if new_session:
            return get_session_business(conn, new_session), new_session
        return None, None


def require_business(
    request: Request,
    response: Response,
    parlevel_session: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
    parlevel_remember: Annotated[str | None, Cookie(alias=REMEMBER_COOKIE)] = None,
) -> dict:
    business, new_token = resolve_business(parlevel_session, parlevel_remember)
    if not business:
        raise HTTPException(401, "Please sign in to your store")
    if new_token and new_token != parlevel_session:
        set_session_cookie(response, new_token, remember=True)
    return business


def ensure_item_owned(conn, item_id: int, business_id: int):
    row = conn.execute(
        "SELECT * FROM items WHERE id = ? AND business_id = ?",
        (item_id, business_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Item not found")
    return row


@app.on_event("startup")
def startup() -> None:
    init_db()
    seed_demo_store()


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "inventi", "auth": True}


@app.get("/api/auth/me")
def auth_me(
    response: Response,
    parlevel_session: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
    parlevel_remember: Annotated[str | None, Cookie(alias=REMEMBER_COOKIE)] = None,
):
    business, new_token = resolve_business(parlevel_session, parlevel_remember)
    if not business:
        return {"authenticated": False, "business": None, "auto_login": False}
    if new_token and new_token != parlevel_session:
        set_session_cookie(response, new_token, remember=True)
    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM items WHERE business_id = ?",
            (business["id"],),
        ).fetchone()["c"]
        low = conn.execute(
            "SELECT COUNT(*) AS c FROM items WHERE business_id = ? AND on_hand <= par",
            (business["id"],),
        ).fetchone()["c"]
        return {
            "authenticated": True,
            "business": business,
            "item_count": count,
            "low_count": low,
            "auto_login": bool(new_token and new_token != parlevel_session),
        }


@app.post("/api/auth/login")
def auth_login(body: LoginRequest, request: Request, response: Response):
    ip = client_ip(request)
    code = normalize_store_code(body.store_code)
    check_login_rate_limit(ip)

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM businesses WHERE store_code = ?", (code,)
        ).fetchone()
        valid, needs_rehash = verify_pin(body.pin, row["pin_hash"] if row else None)

        if not row or not valid:
            record_login_attempt(ip, code, False, conn)
            audit_log(None, "login_failed", ip, code, conn)
            raise HTTPException(401, "Invalid store code or PIN")

        if needs_rehash:
            conn.execute(
                "UPDATE businesses SET pin_hash = ? WHERE id = ?",
                (hash_pin(body.pin), row["id"]),
            )

        conn.execute("DELETE FROM sessions WHERE business_id = ?", (row["id"],))
        token = create_session(
            conn, row["id"], ip, user_agent(request), remember=body.remember_me
        )
        set_session_cookie(response, token, remember=body.remember_me)

        if body.remember_me:
            conn.execute(
                "DELETE FROM remember_tokens WHERE business_id = ?", (row["id"],)
            )
            rt = new_remember_token()
            now = utc_now()
            conn.execute(
                """
                INSERT INTO remember_tokens (token, business_id, session_token, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (rt, row["id"], token, now, session_expiry(REMEMBER_DAYS)),
            )
            set_remember_cookie(response, rt)

        record_login_attempt(ip, code, True, conn)
        audit_log(row["id"], "login_success", ip, conn=conn)
        return {"ok": True, "business": business_public(row)}


@app.post("/api/auth/register")
def auth_register(body: RegisterRequest, request: Request, response: Response):
    if not body.privacy_consent:
        raise HTTPException(400, "Privacy consent is required under Canadian law (PIPEDA)")

    code = normalize_store_code(body.store_code)
    if not code.isalnum():
        raise HTTPException(400, "Store code must be letters and numbers only")

    ip = client_ip(request)
    with get_db() as conn:
        taken = conn.execute(
            "SELECT id FROM businesses WHERE store_code = ?", (code,)
        ).fetchone()
        if taken:
            raise HTTPException(409, "Store code already taken")

        now = utc_now()
        cur = conn.execute(
            """
            INSERT INTO businesses (name, type, currency, store_code, pin_hash, created_at, privacy_consent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                body.name.strip(),
                body.type,
                body.currency,
                code,
                hash_pin(body.pin),
                now,
                now,
            ),
        )
        business_id = cur.lastrowid
        token = create_session(conn, business_id, ip, user_agent(request))
        set_session_cookie(response, token)
        row = conn.execute(
            "SELECT * FROM businesses WHERE id = ?", (business_id,)
        ).fetchone()
        audit_log(business_id, "register", ip, conn=conn)
        return {"ok": True, "business": business_public(row)}


@app.post("/api/auth/logout")
def auth_logout(
    request: Request,
    response: Response,
    parlevel_session: Annotated[str | None, Cookie(alias=COOKIE_NAME)] = None,
    parlevel_remember: Annotated[str | None, Cookie(alias=REMEMBER_COOKIE)] = None,
):
    ip = client_ip(request)
    with get_db() as conn:
        if parlevel_session:
            sess = conn.execute(
                "SELECT business_id FROM sessions WHERE token = ?", (parlevel_session,)
            ).fetchone()
            if sess:
                audit_log(sess["business_id"], "logout", ip, conn=conn)
            conn.execute("DELETE FROM sessions WHERE token = ?", (parlevel_session,))
        if parlevel_remember:
            conn.execute("DELETE FROM remember_tokens WHERE token = ?", (parlevel_remember,))
    clear_auth_cookies(response)
    return {"ok": True}


@app.post("/api/auth/forget-device")
def forget_device(
    request: Request,
    response: Response,
    parlevel_remember: Annotated[str | None, Cookie(alias=REMEMBER_COOKIE)] = None,
):
    ip = client_ip(request)
    with get_db() as conn:
        if parlevel_remember:
            rt = conn.execute(
                "SELECT business_id FROM remember_tokens WHERE token = ?", (parlevel_remember,)
            ).fetchone()
            if rt:
                audit_log(rt["business_id"], "forget_device", ip, conn=conn)
            conn.execute("DELETE FROM remember_tokens WHERE token = ?", (parlevel_remember,))
    response.delete_cookie(REMEMBER_COOKIE, path="/", secure=IS_PRODUCTION, samesite="lax")
    return {"ok": True}


@app.get("/api/privacy/export")
def export_data(business: dict = Depends(require_business)):
    bid = business["id"]
    with get_db() as conn:
        items = [
            dict(r)
            for r in conn.execute(
                """
                SELECT id, name, category, aisle, barcode, unit, on_hand, par, updated_at
                FROM items WHERE business_id = ?
                """,
                (bid,),
            ).fetchall()
        ]
        return JSONResponse(
            {
                "exported_at": utc_now(),
                "business": business,
                "items": items,
                "regulation_note": "PIPEDA — right of access to personal information",
            }
        )


@app.post("/api/privacy/delete-account")
def delete_account(
    body: DeleteAccountRequest,
    request: Request,
    response: Response,
    business: dict = Depends(require_business),
):
    with get_db() as conn:
        row = conn.execute(
            "SELECT pin_hash FROM businesses WHERE id = ?", (business["id"],)
        ).fetchone()
        valid, _ = verify_pin(body.pin, row["pin_hash"] if row else None)
        if not valid:
            raise HTTPException(401, "Incorrect PIN")

        bid = business["id"]
        audit_log(bid, "account_deleted", client_ip(request), conn=conn)
        conn.execute(
            "DELETE FROM adjustments WHERE item_id IN (SELECT id FROM items WHERE business_id = ?)",
            (bid,),
        )
        conn.execute("DELETE FROM items WHERE business_id = ?", (bid,))
        conn.execute("DELETE FROM sessions WHERE business_id = ?", (bid,))
        conn.execute("DELETE FROM remember_tokens WHERE business_id = ?", (bid,))
        conn.execute("DELETE FROM businesses WHERE id = ?", (bid,))

    clear_auth_cookies(response)
    return {"ok": True, "message": "Account and all inventory data permanently deleted"}


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/privacy")
def privacy_page():
    return FileResponse(STATIC / "privacy.html")


@app.get("/terms")
def terms_page():
    return FileResponse(STATIC / "terms.html")


@app.get("/api/business")
def get_business(business: dict = Depends(require_business)):
    ratio = _alert_ratio(business)
    with get_db() as conn:
        stats = _item_stats(conn, business["id"], ratio)
        return {
            "business": business,
            "item_count": stats["total_items"],
            "low_count": stats["low_count"],
            "overstock_count": stats["overstock_count"],
        }


@app.get("/api/stats")
def stats(business: dict = Depends(require_business)):
    ratio = _alert_ratio(business)
    with get_db() as conn:
        return _item_stats(conn, business["id"], ratio)


@app.get("/api/items/barcode/{code}")
def lookup_barcode(code: str, business: dict = Depends(require_business)):
    code = code.strip()
    if not code:
        raise HTTPException(400, "Barcode required")
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM items WHERE business_id = ? AND barcode = ?",
            (business["id"], code),
        ).fetchone()
        if not row:
            raise HTTPException(404, "No item with this barcode")
        return {"item": row_to_item(row, _alert_ratio(business))}


@app.get("/api/settings")
def get_settings(business: dict = Depends(require_business)):
    organize = business.get("organize_by") or "category"
    alerts = business.get("alert_settings") or DEFAULT_ALERTS.copy()
    return {"organize_by": organize, "alerts": alerts}


@app.patch("/api/settings")
def update_settings(body: SettingsUpdate, business: dict = Depends(require_business)):
    with get_db() as conn:
        if body.organize_by is not None:
            conn.execute(
                "UPDATE businesses SET organize_by = ? WHERE id = ?",
                (body.organize_by, business["id"]),
            )
        if body.alerts is not None:
            conn.execute(
                "UPDATE businesses SET alert_settings = ? WHERE id = ?",
                (json.dumps(body.alerts.model_dump()), business["id"]),
            )
        row = conn.execute(
            "SELECT * FROM businesses WHERE id = ?", (business["id"],)
        ).fetchone()
        pub = business_public(row)
        return {
            "organize_by": pub.get("organize_by") or "category",
            "alerts": pub.get("alert_settings") or DEFAULT_ALERTS.copy(),
            "business": pub,
        }


@app.get("/api/items")
def list_items(
    business: dict = Depends(require_business),
    category: Optional[str] = None,
    aisle: Optional[str] = None,
    q: Optional[str] = None,
):
    sql = "SELECT * FROM items WHERE business_id = ?"
    params: list = [business["id"]]
    if category:
        sql += " AND category = ?"
        params.append(category)
    if aisle:
        sql += " AND aisle = ?"
        params.append(aisle)
    if q:
        sql += " AND (name LIKE ? OR barcode LIKE ? OR category LIKE ? OR aisle LIKE ?)"
        like = f"%{q}%"
        params.extend([like, like, like, like])
    organize = business.get("organize_by") or "category"
    order_col = "aisle" if organize == "aisle" else "category"
    sql += f" ORDER BY {order_col}, name"
    with get_db() as conn:
        rows = conn.execute(sql, params).fetchall()
        return {"items": rows_to_items(rows, business)}


@app.get("/api/categories")
def list_categories(business: dict = Depends(require_business)):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT category, COUNT(*) AS count
            FROM items WHERE business_id = ?
            GROUP BY category ORDER BY category
            """,
            (business["id"],),
        ).fetchall()
        return {"categories": [dict(r) for r in rows]}


@app.get("/api/aisles")
def list_aisles(business: dict = Depends(require_business)):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT aisle, COUNT(*) AS count
            FROM items WHERE business_id = ? AND aisle IS NOT NULL AND aisle != ''
            GROUP BY aisle ORDER BY aisle
            """,
            (business["id"],),
        ).fetchall()
        return {"aisles": [dict(r) for r in rows]}


@app.post("/api/items")
def create_item(body: ItemCreate, business: dict = Depends(require_business)):
    now = utc_now()
    aisle = body.aisle.strip() if body.aisle else None
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO items
            (business_id, name, category, aisle, barcode, unit, on_hand, par, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                business["id"],
                body.name.strip(),
                body.category.strip(),
                aisle,
                body.barcode.strip() if body.barcode else None,
                body.unit,
                body.on_hand,
                body.par,
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM items WHERE id = ?", (cur.lastrowid,)).fetchone()
        return {"item": row_to_item(row, _alert_ratio(business))}


@app.put("/api/items/{item_id}")
def update_item(item_id: int, body: ItemUpdate, business: dict = Depends(require_business)):
    with get_db() as conn:
        row = ensure_item_owned(conn, item_id, business["id"])
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            return {"item": row_to_item(row, _alert_ratio(business))}
        if "name" in fields and fields["name"]:
            fields["name"] = fields["name"].strip()
        if "category" in fields and fields["category"]:
            fields["category"] = fields["category"].strip()
        if "aisle" in fields:
            fields["aisle"] = fields["aisle"].strip() if fields["aisle"] else None
        if "barcode" in fields and fields["barcode"]:
            fields["barcode"] = fields["barcode"].strip()
        fields["updated_at"] = utc_now()
        cols = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE items SET {cols} WHERE id = ?", [*fields.values(), item_id])
        updated = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        return {"item": row_to_item(updated, _alert_ratio(business))}


@app.delete("/api/items/{item_id}")
def delete_item(item_id: int, business: dict = Depends(require_business)):
    with get_db() as conn:
        ensure_item_owned(conn, item_id, business["id"])
        conn.execute("DELETE FROM adjustments WHERE item_id = ?", (item_id,))
        conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
        return {"ok": True}


@app.post("/api/items/{item_id}/adjust")
def adjust_item(
    item_id: int, body: AdjustRequest, business: dict = Depends(require_business)
):
    with get_db() as conn:
        row = ensure_item_owned(conn, item_id, business["id"])
        current = float(row["on_hand"])
        if body.set_to is not None:
            new_qty = body.set_to
            delta = new_qty - current
        elif body.delta is not None:
            delta = body.delta
            new_qty = max(current + delta, 0)
        else:
            raise HTTPException(400, "Provide delta or set_to")
        now = utc_now()
        conn.execute(
            "UPDATE items SET on_hand = ?, updated_at = ? WHERE id = ?",
            (new_qty, now, item_id),
        )
        conn.execute(
            """
            INSERT INTO adjustments (item_id, delta, new_qty, reason, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (item_id, delta, new_qty, body.reason, now),
        )
        updated = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        return {"item": row_to_item(updated, _alert_ratio(business))}


@app.get("/api/low-stock")
def low_stock(business: dict = Depends(require_business)):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM items
            WHERE business_id = ? AND on_hand <= par
            ORDER BY (par - on_hand) DESC, name
            """,
            (business["id"],),
        ).fetchall()
        items = rows_to_items(rows, business)
        return {"items": items, "count": len(items)}


@app.post("/api/items/bulk-aisle")
def bulk_aisle(body: BulkAisleRequest, business: dict = Depends(require_business)):
    now = utc_now()
    with get_db() as conn:
        for upd in body.updates:
            ensure_item_owned(conn, upd.item_id, business["id"])
            aisle = upd.aisle.strip() if upd.aisle else None
            conn.execute(
                "UPDATE items SET aisle = ?, updated_at = ? WHERE id = ?",
                (aisle, now, upd.item_id),
            )
        rows = conn.execute(
            "SELECT * FROM items WHERE business_id = ? ORDER BY name",
            (business["id"],),
        ).fetchall()
        return {"items": rows_to_items(rows, business), "updated": len(body.updates)}


@app.get("/api/reorder")
def reorder_sheet(business: dict = Depends(require_business)):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM items
            WHERE business_id = ? AND on_hand <= par
            ORDER BY category, name
            """,
            (business["id"],),
        ).fetchall()
        items = rows_to_items(rows, business)
        return {"business": business, "items": items, "generated_at": utc_now()}


app.mount("/static", StaticFiles(directory=STATIC), name="static")
