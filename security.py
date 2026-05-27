"""Security utilities: rate limiting, audit logging, request metadata."""
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from fastapi import HTTPException, Request

from database import get_db, utc_now

if TYPE_CHECKING:
    import sqlite3

MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    if request.client:
        return request.client.host[:64]
    return "unknown"


def user_agent(request: Request) -> str:
    return (request.headers.get("user-agent") or "unknown")[:256]


def check_login_rate_limit(ip: str) -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
    with get_db() as conn:
        fails = conn.execute(
            """
            SELECT COUNT(*) AS c FROM login_attempts
            WHERE ip = ? AND success = 0 AND attempted_at > ?
            """,
            (ip, cutoff),
        ).fetchone()["c"]
        if fails >= MAX_LOGIN_ATTEMPTS:
            raise HTTPException(
                429,
                f"Too many attempts. Wait {LOCKOUT_MINUTES} minutes and try again.",
            )


def record_login_attempt(
    ip: str,
    store_code: str,
    success: bool,
    conn: "sqlite3.Connection | None" = None,
) -> None:
    sql = """
        INSERT INTO login_attempts (ip, store_code, success, attempted_at)
        VALUES (?, ?, ?, ?)
    """
    params = (ip, store_code[:40], 1 if success else 0, utc_now())
    if conn is not None:
        conn.execute(sql, params)
        return
    with get_db() as c:
        c.execute(sql, params)


def audit_log(
    business_id: int | None,
    action: str,
    ip: str,
    detail: str = "",
    conn: "sqlite3.Connection | None" = None,
) -> None:
    sql = """
        INSERT INTO audit_log (business_id, action, ip, detail, created_at)
        VALUES (?, ?, ?, ?, ?)
    """
    params = (business_id, action[:80], ip[:64], detail[:500], utc_now())
    if conn is not None:
        conn.execute(sql, params)
        return
    with get_db() as c:
        c.execute(sql, params)
