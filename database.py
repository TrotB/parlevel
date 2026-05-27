import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "inventory.db"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(businesses)").fetchall()}
    if "store_code" not in cols:
        conn.execute("ALTER TABLE businesses ADD COLUMN store_code TEXT")
    if "pin_hash" not in cols:
        conn.execute("ALTER TABLE businesses ADD COLUMN pin_hash TEXT")
    if "organize_by" not in cols:
        conn.execute("ALTER TABLE businesses ADD COLUMN organize_by TEXT NOT NULL DEFAULT 'category'")
    if "privacy_consent_at" not in cols:
        conn.execute("ALTER TABLE businesses ADD COLUMN privacy_consent_at TEXT")
    if "alert_settings" not in cols:
        conn.execute("ALTER TABLE businesses ADD COLUMN alert_settings TEXT")

    item_cols = {r[1] for r in conn.execute("PRAGMA table_info(items)").fetchall()}
    if "aisle" not in item_cols:
        conn.execute("ALTER TABLE items ADD COLUMN aisle TEXT")
    _ensure_aisle_index(conn)

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            business_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            ip TEXT,
            user_agent TEXT,
            remember INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (business_id) REFERENCES businesses(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS remember_tokens (
            token TEXT PRIMARY KEY,
            business_id INTEGER NOT NULL,
            session_token TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (business_id) REFERENCES businesses(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            store_code TEXT,
            success INTEGER NOT NULL,
            attempted_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER,
            action TEXT NOT NULL,
            ip TEXT,
            detail TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    session_cols = {r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()}
    if session_cols and "remember" not in session_cols:
        conn.execute("ALTER TABLE sessions ADD COLUMN remember INTEGER NOT NULL DEFAULT 0")
    if session_cols and "ip" not in session_cols:
        conn.execute("ALTER TABLE sessions ADD COLUMN ip TEXT")
    if session_cols and "user_agent" not in session_cols:
        conn.execute("ALTER TABLE sessions ADD COLUMN user_agent TEXT")

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_store_code ON businesses(store_code)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_business ON sessions(business_id)"
    )


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS businesses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'convenience',
                currency TEXT NOT NULL DEFAULT 'CAD',
                store_code TEXT,
                pin_hash TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                business_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                aisle TEXT,
                barcode TEXT,
                unit TEXT NOT NULL DEFAULT 'each',
                on_hand REAL NOT NULL DEFAULT 0,
                par REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (business_id) REFERENCES businesses(id)
            );

            CREATE TABLE IF NOT EXISTS adjustments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL,
                delta REAL NOT NULL,
                new_qty REAL NOT NULL,
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (item_id) REFERENCES items(id)
            );

            CREATE INDEX IF NOT EXISTS idx_items_business ON items(business_id);
            CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(business_id, barcode);
            CREATE INDEX IF NOT EXISTS idx_items_low ON items(business_id, on_hand, par);
            """
        )
        _migrate(conn)


def _ensure_aisle_index(conn: sqlite3.Connection) -> None:
    item_cols = {r[1] for r in conn.execute("PRAGMA table_info(items)").fetchall()}
    if "aisle" in item_cols:
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_items_aisle ON items(business_id, aisle)"
        )


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
