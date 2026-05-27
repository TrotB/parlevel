import bcrypt
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

SESSION_DAYS = 30
REMEMBER_DAYS = 90
COOKIE_NAME = "parlevel_session"
REMEMBER_COOKIE = "parlevel_remember"

_BCRYPT_ROUNDS = 12


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode("utf-8")


def _legacy_hash(pin: str, salt: str) -> str:
    digest = hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest()
    return f"{salt}${digest}"


def verify_pin(pin: str, stored: str | None) -> tuple[bool, bool]:
    """Returns (valid, needs_rehash)."""
    if not stored:
        return False, False
    if stored.startswith("$2"):
        try:
            ok = bcrypt.checkpw(pin.encode("utf-8"), stored.encode("utf-8"))
            return ok, False
        except ValueError:
            return False, False
    if "$" in stored:
        salt, _ = stored.split("$", 1)
        ok = secrets.compare_digest(_legacy_hash(pin, salt), stored)
        return ok, ok
    return False, False


def new_session_token() -> str:
    return secrets.token_urlsafe(48)


def new_remember_token() -> str:
    return secrets.token_urlsafe(48)


def session_expiry(days: int = SESSION_DAYS) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def normalize_store_code(code: str) -> str:
    return code.strip().lower().replace(" ", "")
