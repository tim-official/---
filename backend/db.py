"""Small DB abstraction: PostgreSQL (DATABASE_URL, psycopg3 + pool) or SQLite fallback.

SQL is written with ``?`` placeholders; for Postgres they are translated to ``%s``.
Rows support ``row["col"]`` and ``dict(row)`` on both backends.
"""
import logging
import os
import re
import sqlite3
import threading
from contextlib import contextmanager

log = logging.getLogger(__name__)

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

_lock = threading.Lock()
_state = {"dialect": None, "pool": None, "sqlite_path": None}

try:  # optional dependency – only needed when DATABASE_URL is set
    import psycopg
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool
except ImportError:  # pragma: no cover
    psycopg = None
    dict_row = None
    ConnectionPool = None

if psycopg is not None:
    IntegrityError = (sqlite3.IntegrityError, psycopg.IntegrityError)
    OperationalError = (sqlite3.OperationalError, psycopg.OperationalError)
else:
    IntegrityError = (sqlite3.IntegrityError,)
    OperationalError = (sqlite3.OperationalError,)


def _database_url() -> str:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url


def _default_sqlite_path() -> str:
    return os.getenv("SQLITE_PATH") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "site.db")


def _init_backend():
    if _state["dialect"]:
        return
    with _lock:
        if _state["dialect"]:
            return
        url = _database_url()
        if url:
            if psycopg is None or ConnectionPool is None:
                raise RuntimeError("DATABASE_URL is set but psycopg/psycopg_pool are not installed")
            pool = ConnectionPool(
                conninfo=url,
                min_size=int(os.getenv("DB_POOL_MIN", "1")),
                max_size=int(os.getenv("DB_POOL_MAX", "10")),
                timeout=10,
                max_idle=300,
                max_lifetime=1800,
                check=ConnectionPool.check_connection,
                # prepare_threshold=None keeps it compatible with Neon's PgBouncer pooler.
                kwargs={"row_factory": dict_row, "autocommit": False, "prepare_threshold": None, "connect_timeout": 10},
                open=False,
                name="app-pool",
            )
            pool.open(wait=False)
            _state["pool"] = pool
            _state["dialect"] = "postgres"
        else:
            if os.getenv("REQUIRE_DATABASE_URL", "false").strip().lower() == "true":
                raise RuntimeError("DATABASE_URL is required; refusing to use ephemeral SQLite storage")
            path = _default_sqlite_path()
            _state["sqlite_path"] = path
            conn = sqlite3.connect(path, timeout=5)
            try:
                conn.execute("PRAGMA journal_mode=WAL")
            finally:
                conn.close()
            _state["dialect"] = "sqlite"


def dialect() -> str:
    _init_backend()
    return _state["dialect"]


def translate_sql(sql: str, target: str) -> str:
    """Translate ``?`` placeholders to ``%s`` (escaping literal ``%``) outside string literals."""
    if target != "postgres":
        return sql
    out = []
    in_str = False
    for ch in sql:
        if in_str:
            if ch == "'":
                in_str = False
            out.append("%%" if ch == "%" else ch)
            continue
        if ch == "'":
            in_str = True
            out.append(ch)
        elif ch == "?":
            out.append("%s")
        elif ch == "%":
            out.append("%%")
        else:
            out.append(ch)
    return "".join(out)


def render_ddl(sql: str, target: str) -> str:
    pk = "BIGSERIAL PRIMARY KEY" if target == "postgres" else "INTEGER PRIMARY KEY AUTOINCREMENT"
    return sql.replace("{pk}", pk)


class Connection:
    def __init__(self, raw, dialect_name: str):
        self.raw = raw
        self.dialect = dialect_name

    def execute(self, sql: str, params=()):
        return self.raw.execute(translate_sql(sql, self.dialect), tuple(params or ()))

    def insert(self, sql: str, params=()) -> int:
        """Run an INSERT and return the new ``id`` (uses RETURNING on both backends)."""
        row = self.execute(sql.rstrip().rstrip(";") + " RETURNING id", params).fetchone()
        return int(row["id"]) if row else 0

    def lock(self, name: str):
        """Serialize writers inside the current transaction (released on commit/rollback)."""
        if self.dialect == "postgres":
            self.raw.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (name,))
        elif not self.raw.in_transaction:
            self.raw.execute("BEGIN IMMEDIATE")

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def column_exists(self, table: str, column: str) -> bool:
        if self.dialect == "postgres":
            row = self.execute(
                "SELECT 1 AS x FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?",
                (table, column),
            ).fetchone()
            return row is not None
        rows = self.execute("SELECT name FROM pragma_table_info(?)", (table,)).fetchall()
        return any(r["name"] == column for r in rows)

    def add_column_if_missing(self, table: str, column: str, ddl: str):
        if not (_IDENT_RE.match(table) and _IDENT_RE.match(column)):
            raise ValueError("Invalid SQL identifier")
        if self.dialect == "postgres":
            self.raw.execute(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "{column}" {ddl}')
            return
        if not self.column_exists(table, column):
            self.raw.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}')


@contextmanager
def connect():
    """Yield a :class:`Connection`; commits on success, rolls back on exception."""
    _init_backend()
    if _state["dialect"] == "postgres":
        with _state["pool"].connection() as raw:  # pool commits/rolls back itself
            yield Connection(raw, "postgres")
        return
    raw = sqlite3.connect(_state["sqlite_path"], timeout=5, check_same_thread=False)
    raw.row_factory = sqlite3.Row
    try:
        raw.execute("PRAGMA busy_timeout=5000")
        raw.execute("PRAGMA foreign_keys=ON")
        conn = Connection(raw, "sqlite")
        try:
            yield conn
        except BaseException:
            raw.rollback()
            raise
        else:
            raw.commit()
    finally:
        raw.close()


def ping() -> bool:
    try:
        with connect() as conn:
            conn.execute("SELECT 1 AS ok").fetchone()
        return True
    except Exception as exc:
        log.warning("DB ping failed: %s", exc)
        return False


def close():
    pool = _state.get("pool")
    if pool is not None:
        pool.close()
    _state.update({"dialect": None, "pool": None, "sqlite_path": None})
