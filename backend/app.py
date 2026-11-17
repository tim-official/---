import os
import re
import secrets
import hashlib
import hmac
import logging
from collections import Counter, defaultdict
from io import StringIO
from datetime import datetime, timedelta
from email.message import EmailMessage
import smtplib
import csv
import threading
import time

import requests
import db
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.exceptions import HTTPException

try:
    from openai import OpenAI as _OpenAIClient
except ImportError:
    _OpenAIClient = None  # type: ignore

load_dotenv()

TIME_GAP_MINUTES = 60
TRAINING_CAPACITY = 25
TRAINING_PRICE_KZT = int(os.getenv("TRAINING_PRICE_KZT", "75000"))
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
ADMIN_SESSION_MINUTES = int(os.getenv("ADMIN_SESSION_MINUTES", "720"))
BOOKING_START_HOUR = max(0, min(22, int(os.getenv("BOOKING_START_HOUR", "9"))))
BOOKING_END_HOUR = max(BOOKING_START_HOUR + 1, min(23, int(os.getenv("BOOKING_END_HOUR", "21"))))
SLOT_STEP_MINUTES = max(15, min(240, int(os.getenv("SLOT_STEP_MINUTES", "60"))))
REMINDER_JOB_ENABLED = os.getenv("REMINDER_JOB_ENABLED", "true").lower() == "true"
REMINDER_JOB_INTERVAL_SECONDS = int(os.getenv("REMINDER_JOB_INTERVAL_SECONDS", "60"))
TASK_SECRET = os.getenv("TASK_SECRET", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
SESSION_TOKEN_PREFIX = "ms_"
CUSTOMER_SESSION_DAYS = max(1, int(os.getenv("CUSTOMER_SESSION_DAYS", "30")))
CUSTOMER_SHORT_SESSION_HOURS = max(1, int(os.getenv("CUSTOMER_SHORT_SESSION_HOURS", "12")))
PASSWORD_HASH_ITERATIONS = max(100_000, int(os.getenv("PASSWORD_HASH_ITERATIONS", "600000")))
SUPPORT_WHATSAPP = os.getenv("SUPPORT_WHATSAPP", "+7 707 286 77 77")

_openai_client = None
_CHAT_SESSIONS: dict = {}  # session_id → {ts, messages}
_CHAT_SESSION_TTL = 1800  # 30 минут

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = Flask(__name__)
APP_SECRET_KEY = os.getenv("APP_SECRET_KEY", "")
app.config["SECRET_KEY"] = APP_SECRET_KEY or secrets.token_hex(32)

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://127.0.0.1:5500,http://localhost:5500,https://abdramanovtimur71-ux.github.io",
    ).split(",")
    if origin.strip()
]

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["120 per hour"],
    storage_uri=os.getenv("RATELIMIT_STORAGE_URI", "memory://"),
)
limiter.init_app(app)

ADMIN_SESSIONS = {}
_REMINDER_THREAD_STARTED = False


_ALLOWED_TABLES = {"bookings", "training_enrollments", "payments", "purchases", "client_messages", "orders"}
_ALLOWED_COLUMNS_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')

def ensure_column(conn, table: str, column: str, ddl: str):
    if table not in _ALLOWED_TABLES:
        raise ValueError(f"Unknown table: {table}")
    if not _ALLOWED_COLUMNS_RE.match(column):
        raise ValueError(f"Invalid column name: {column}")
    conn.add_column_if_missing(table, column, ddl)


def create_table(conn, ddl: str):
    conn.execute(db.render_ddl(ddl, db.dialect()))


def init_db():
    with db.connect() as conn:
        create_table(conn,
            """
            CREATE TABLE IF NOT EXISTS bookings (
                id {pk},
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                access_token_hash TEXT,
                phone TEXT,
                service TEXT NOT NULL,
                format TEXT,
                note TEXT,
                booking_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                reminder_24h_sent INTEGER NOT NULL DEFAULT 0,
                reminder_2h_sent INTEGER NOT NULL DEFAULT 0,
                reminder_24h_sent_at TEXT,
                reminder_2h_sent_at TEXT,
                status TEXT NOT NULL DEFAULT 'confirmed',
                cancelled_at TEXT
            )
            """
        )
        create_table(conn,
            """
            CREATE TABLE IF NOT EXISTS training_enrollments (
                id {pk},
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT,
                payment_verified INTEGER NOT NULL,
                payment_id TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        create_table(conn,
            """
            CREATE TABLE IF NOT EXISTS payments (
                id {pk},
                payment_id TEXT NOT NULL UNIQUE,
                amount INTEGER NOT NULL,
                currency TEXT NOT NULL,
                card_last4 TEXT,
                holder TEXT,
                status TEXT NOT NULL,
                consumed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )
        create_table(conn,
            """
            CREATE TABLE IF NOT EXISTS purchases (
                id {pk},
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                unit_price INTEGER NOT NULL DEFAULT 0,
                quantity INTEGER NOT NULL DEFAULT 1,
                amount INTEGER NOT NULL,
                currency TEXT NOT NULL,
                customer_name TEXT NOT NULL,
                customer_email TEXT NOT NULL,
                customer_phone TEXT,
                payment_id TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        create_table(conn,
            """
            CREATE TABLE IF NOT EXISTS content_items (
                id {pk},
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                media_url TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        create_table(conn,
            """
            CREATE TABLE IF NOT EXISTS client_messages (
                id {pk},
                from_email TEXT NOT NULL,
                to_email TEXT NOT NULL,
                subject TEXT,
                text TEXT NOT NULL,
                sender_role TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        create_table(conn,
            """
            CREATE TABLE IF NOT EXISTS orders (
                id {pk},
                code TEXT NOT NULL UNIQUE,
                access_token_hash TEXT,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                amount INTEGER NOT NULL,
                currency TEXT NOT NULL DEFAULT 'KZT',
                customer_name TEXT NOT NULL,
                customer_email TEXT NOT NULL,
                customer_phone TEXT,
                status TEXT NOT NULL,
                enrollment_status TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        create_table(conn,
            """
            CREATE TABLE IF NOT EXISTS customer_accounts (
                id {pk},
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                phone TEXT,
                password_hash TEXT NOT NULL,
                email_verified INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                password_changed_at TEXT
            )
            """
        )
        create_table(conn,
            """
            CREATE TABLE IF NOT EXISTS customer_sessions (
                id {pk},
                account_id BIGINT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
                token_hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked_at TEXT,
                user_agent TEXT
            )
            """
        )
        ensure_column(conn, "purchases", "unit_price", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "purchases", "quantity", "INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "bookings", "status", "TEXT NOT NULL DEFAULT 'confirmed'")
        ensure_column(conn, "bookings", "cancelled_at", "TEXT")
        ensure_column(conn, "bookings", "access_token_hash", "TEXT")
        ensure_column(conn, "bookings", "account_id", "BIGINT")
        ensure_column(conn, "orders", "access_token_hash", "TEXT")
        ensure_column(conn, "orders", "account_id", "BIGINT")
        ensure_column(conn, "client_messages", "account_id", "BIGINT")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bookings_owner ON bookings(email, access_token_hash, booking_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bookings_account ON bookings(account_id, booking_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bookings_active_slot ON bookings(status, booking_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(customer_email, access_token_hash, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_account ON client_messages(account_id, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_account ON customer_sessions(account_id, revoked_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_training_capacity ON training_enrollments(status, email)")
        conn.commit()


def cleanup_admin_sessions():
    now = datetime.now()
    expired = [token for token, exp in ADMIN_SESSIONS.items() if exp < now]
    for token in expired:
        ADMIN_SESSIONS.pop(token, None)


def issue_admin_token() -> str:
    cleanup_admin_sessions()
    token = secrets.token_urlsafe(32)
    ADMIN_SESSIONS[token] = datetime.now() + timedelta(minutes=ADMIN_SESSION_MINUTES)
    return token


def is_admin_request() -> bool:
    cleanup_admin_sessions()
    token = request.headers.get("X-Admin-Token", "").strip()
    return bool(token and token in ADMIN_SESSIONS)


def require_admin_or_401():
    if not is_admin_request():
        return jsonify({"ok": False, "message": "Требуется спецвход администратора"}), 401
    return None


def parse_iso(dt_str: str):
    try:
        return datetime.fromisoformat(dt_str)
    except Exception:
        return None


def parse_ymd(date_str: str):
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except Exception:
        return None


def month_start(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def shift_month(dt: datetime, delta: int) -> datetime:
    month = dt.month - 1 + delta
    year = dt.year + month // 12
    month = month % 12 + 1
    return dt.replace(year=year, month=month, day=1)


def notification_any_success(notify_result: dict) -> bool:
    for channel in (notify_result or {}).values():
        if isinstance(channel, tuple) and channel and channel[0] is True:
            return True
    return False


def ensure_task_secret(req) -> bool:
    if is_admin_request():
        return True
    if not TASK_SECRET:
        return False
    token = (req.headers.get("X-Task-Token") or req.args.get("token") or "").strip()
    return bool(token and hmac.compare_digest(token, TASK_SECRET))


def access_token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def valid_access_token(value: str) -> bool:
    return bool(re.fullmatch(r"[a-fA-F0-9]{64}", value or ""))


def request_access_token(payload=None) -> str:
    """Browser capability key for legacy guest records (not an account session)."""
    header_key = (request.headers.get("X-Client-Key") or "").strip()
    if header_key:
        return header_key
    body_key = (payload or {}).get("accessToken") if isinstance(payload, dict) else None
    if isinstance(body_key, str) and body_key.strip():
        return body_key.strip()
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        bearer = authorization[7:].strip()
        if not bearer.startswith(SESSION_TOKEN_PREFIX):
            return bearer
    return ""


def capability_hash_or_sentinel(token: str) -> str:
    return access_token_hash(token) if valid_access_token(token) else "-"


def validate_email(email: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email or ""))


def validate_phone(phone: str) -> bool:
    if not phone:
        return True
    return bool(re.match(r"^\+?[0-9\-\s\(\)]{7,20}$", phone))


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, **extra):
        super().__init__(message)
        self.message = message
        self.status = status
        self.extra = extra


def json_body() -> dict:
    if not request.get_data(cache=True):
        return {}
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ApiError("Некорректный формат запроса: ожидается JSON-объект", 400)
    return payload


def text_field(payload: dict, key: str, max_len: int = 2000, lower: bool = False) -> str:
    value = payload.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ApiError("Некорректный формат поля", 400, field=key)
    value = value.strip()
    if len(value) > max_len:
        raise ApiError("Слишком длинное значение", 400, field=key)
    return value.lower() if lower else value


def password_field(payload: dict, key: str) -> str:
    value = payload.get(key)
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > 256:
        raise ApiError("Некорректный формат пароля", 400, field=key)
    return value


def password_problem(password: str) -> str | None:
    if len(password) < 8:
        return "Пароль должен быть не короче 8 символов"
    if len(password) > 128:
        return "Пароль должен быть не длиннее 128 символов"
    if not any(ch.isalpha() for ch in password) or not any(ch.isdigit() for ch in password):
        return "Пароль должен содержать буквы и цифры"
    return None


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = (stored or "").split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


_DUMMY_PASSWORD_HASH: list[str] = []


def burn_password_check(password: str):
    # Keeps login timing similar for unknown emails and wrong passwords.
    if not _DUMMY_PASSWORD_HASH:
        _DUMMY_PASSWORD_HASH.append(hash_password(secrets.token_hex(16)))
    verify_password(password, _DUMMY_PASSWORD_HASH[0])


def serialize_account(row) -> dict:
    return {
        "id": int(row["account_id"]),
        "email": row["email"],
        "name": row["name"],
        "phone": row["phone"] or "",
        "emailVerified": bool(row["email_verified"]),
        "createdAt": row["created_at"],
    }


_ACCOUNT_SESSION_SQL = """
    SELECT s.id AS session_id, s.expires_at, s.revoked_at,
           a.id AS account_id, a.email, a.name, a.phone, a.email_verified, a.created_at
    FROM customer_sessions s
    JOIN customer_accounts a ON a.id = s.account_id
    WHERE s.token_hash=?
"""


def issue_customer_session(conn, account_id: int, remember: bool) -> tuple[str, str]:
    now = datetime.now()
    lifetime = timedelta(days=CUSTOMER_SESSION_DAYS) if remember else timedelta(hours=CUSTOMER_SHORT_SESSION_HOURS)
    expires_at = (now + lifetime).isoformat(timespec="seconds")
    token = SESSION_TOKEN_PREFIX + secrets.token_urlsafe(32)
    conn.execute(
        "DELETE FROM customer_sessions WHERE account_id=? AND (expires_at < ? OR revoked_at IS NOT NULL)",
        (account_id, now.isoformat(timespec="seconds")),
    )
    conn.execute(
        """
        INSERT INTO customer_sessions (account_id, token_hash, created_at, expires_at, user_agent)
        VALUES (?, ?, ?, ?, ?)
        """,
        (account_id, access_token_hash(token), now.isoformat(timespec="seconds"), expires_at,
         (request.headers.get("User-Agent") or "")[:200]),
    )
    return token, expires_at


def bearer_session_token() -> str:
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        return ""
    token = authorization[7:].strip()
    return token if token.startswith(SESSION_TOKEN_PREFIX) else ""


def optional_customer():
    """Return the signed-in account, None for guests; reject stale or forged session tokens."""
    token = bearer_session_token()
    if not token:
        return None
    if len(token) > 200:
        raise ApiError("Сессия недействительна. Войдите снова.", 401, sessionExpired=True)
    with db.connect() as conn:
        row = conn.execute(_ACCOUNT_SESSION_SQL, (access_token_hash(token),)).fetchone()
    expires_at = parse_iso(row["expires_at"]) if row else None
    if not row or row["revoked_at"] or not expires_at or expires_at <= datetime.now():
        raise ApiError("Сессия истекла. Войдите снова.", 401, sessionExpired=True)
    return dict(row)


def require_customer():
    customer = optional_customer()
    if customer is None:
        raise ApiError("Войдите в личный кабинет", 401, authRequired=True)
    return customer


def login_rate_key() -> str:
    payload = request.get_json(silent=True)
    email = payload.get("email") if isinstance(payload, dict) else None
    if isinstance(email, str) and email.strip():
        return "login:" + email.strip().lower()[:254]
    return get_remote_address()


def send_email_notification(subject: str, text: str):
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    to_email = os.getenv("ADMIN_NOTIFY_EMAIL")
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

    if not (smtp_host and smtp_user and smtp_pass and to_email):
        return False, "email-not-configured"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = to_email
    msg.set_content(text)

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
            if use_tls:
                server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        return True, "email-sent"
    except Exception as exc:
        return False, f"email-error: {exc}"


def send_telegram_notification(text: str):
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not (token and chat_id):
        return False, "telegram-not-configured"

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        resp = requests.post(url, json={"chat_id": chat_id, "text": text}, timeout=20)
        resp.raise_for_status()
        return True, "telegram-sent"
    except Exception as exc:
        return False, f"telegram-error: {exc}"


def send_whatsapp_notification(text: str):
    api_url = os.getenv("WHATSAPP_API_URL")
    api_token = os.getenv("WHATSAPP_API_TOKEN")
    if not (api_url and api_token):
        return False, "whatsapp-not-configured"

    try:
        resp = requests.post(
            api_url,
            json={"message": text, "to": "87072867777"},
            headers={"Authorization": f"Bearer {api_token}"},
            timeout=20,
        )
        resp.raise_for_status()
        return True, "whatsapp-sent"
    except Exception as exc:
        return False, f"whatsapp-error: {exc}"


def send_all_notifications(subject: str, text: str):
    results = {"email": None, "telegram": None, "whatsapp": None}

    try:
        results["email"] = send_email_notification(subject, text)
    except Exception as ex:
        results["email"] = (False, f"email-error:{ex}")

    try:
        results["telegram"] = send_telegram_notification(text)
    except Exception as ex:
        results["telegram"] = (False, f"telegram-error:{ex}")

    try:
        results["whatsapp"] = send_whatsapp_notification(text)
    except Exception as ex:
        results["whatsapp"] = (False, f"whatsapp-error:{ex}")

    return results


def send_notifications_async(subject: str, text: str):
    def notify():
        try:
            results = send_all_notifications(subject, text)
            for channel, result in results.items():
                if isinstance(result, tuple) and result and result[0] is False:
                    log.warning("Notification channel %s failed: %s", channel, result[1])
        except Exception:
            log.exception("Background notification failed")

    threading.Thread(target=notify, daemon=True, name="site-notification").start()


@app.after_request
def add_security_headers(resp):
    origin = request.headers.get("Origin")
    if origin and origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Admin-Token, X-Client-Key"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Vary"] = "Origin"

    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    resp.headers["Content-Security-Policy"] = "default-src 'self'; connect-src 'self' https://api.openai.com https://api.telegram.org; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline';"
    return resp


@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        return ("", 204)


@app.errorhandler(ApiError)
def handle_api_error(exc: ApiError):
    return jsonify({"ok": False, "message": exc.message, **exc.extra}), exc.status


_HTTP_ERROR_MESSAGES = {
    404: "Ресурс не найден",
    405: "Метод не поддерживается",
    413: "Слишком большой запрос",
    429: "Слишком много запросов. Подождите немного и повторите.",
}


@app.errorhandler(HTTPException)
def handle_http_error(exc: HTTPException):
    message = _HTTP_ERROR_MESSAGES.get(exc.code or 500, exc.description or "Ошибка запроса")
    return jsonify({"ok": False, "message": message}), exc.code or 500


@app.errorhandler(Exception)
def handle_unexpected_error(exc: Exception):
    log.exception("Unhandled API error on %s %s", request.method, request.path)
    return jsonify({"ok": False, "message": "Внутренняя ошибка сервера. Попробуйте позже."}), 500


@app.route("/api/bookings/<int:booking_id>/cancel", methods=["POST"])
@limiter.limit("20 per hour")
def cancel_booking(booking_id):
    payload = json_body()
    customer = optional_customer()
    email = text_field(payload, "email", 254, lower=True)
    token = request_access_token(payload)
    if customer is None and (not validate_email(email) or not valid_access_token(token)):
        return jsonify({"ok": False, "message": "Не удалось подтвердить доступ к записи"}), 401
    now = datetime.now().isoformat()

    with db.connect() as conn:
        if customer:
            row = conn.execute(
                """
                SELECT id, email, booking_at, service, status FROM bookings
                WHERE id=? AND (account_id=? OR (account_id IS NULL AND email=? AND access_token_hash=?))
                """,
                (booking_id, customer["account_id"], customer["email"], capability_hash_or_sentinel(token)),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT id, email, booking_at, service, status FROM bookings
                WHERE id=? AND email=? AND access_token_hash=?
                """,
                (booking_id, email, access_token_hash(token)),
            ).fetchone()
        if not row:
            return jsonify({"ok": False, "message": "Запись не найдена"}), 404
        booking_at = parse_iso(row["booking_at"])
        if row["status"] == "cancelled" or not booking_at or booking_at <= datetime.now():
            return jsonify({"ok": False, "message": "Эту запись уже нельзя отменить"}), 409
        conn.execute(
            """
            UPDATE bookings SET status='cancelled', cancelled_at=?
            WHERE id=? AND status <> 'cancelled'
            """,
            (now, booking_id),
        )

    send_notifications_async(
        f"Отмена записи #{booking_id}",
        f"Клиент отменил запись:\n{row['service']} / {row['booking_at']}\nEmail: {row['email']}"
    )
    return jsonify({"ok": True, "message": "Запись отменена"})


_AI_SYSTEM_PROMPT = (
    "Ты — консультант Матрицы Судьбы, специалист с 15-летним опытом в нумерологии, матрицах судьбы и духовных практиках. "
    "Ты работаешь на сайте «Матрицы Судьбы» и помогаешь клиентам. "
    "Услуги: Расчёт матрицы судьбы (5 000 ₸), Нумерология (3 500 ₸), Духовные практики (8 000 ₸), "
    "Чистка энергетики (6 000 ₸), Таро-расклад (4 000 ₸). "
    "Правила: отвечай по-русски тепло и заботливо, кратко (2-4 предложения), "
    "для записи направляй на форму на сайте, используй мягкий мистический тон, "
    "при вопросе о нумерологии просить дату рождения."
)


@app.route("/api/chat", methods=["POST"])
@limiter.limit("30 per hour")
def chat_ai():
    global _openai_client
    if not OPENAI_API_KEY:
        return jsonify({"ok": False, "message": "ИИ-консультант временно недоступен"}), 503

    if _OpenAIClient and _openai_client is None:
        _openai_client = _OpenAIClient(api_key=OPENAI_API_KEY)

    payload = json_body()
    user_msg = text_field(payload, "message", 4000)
    session_id = text_field(payload, "session_id", 64) or "anon"

    if not user_msg:
        return jsonify({"ok": False, "message": "Введите сообщение"}), 400
    if len(user_msg) > 1000:
        return jsonify({"ok": False, "message": "Сообщение слишком длинное"}), 400

    now = time.time()
    if session_id not in _CHAT_SESSIONS or now - _CHAT_SESSIONS[session_id]["ts"] > _CHAT_SESSION_TTL:
        _CHAT_SESSIONS[session_id] = {"ts": now, "messages": []}
    sess = _CHAT_SESSIONS[session_id]
    sess["ts"] = now
    sess["messages"].append({"role": "user", "content": user_msg})
    if len(sess["messages"]) > 12:
        sess["messages"] = sess["messages"][-12:]

    messages = [{"role": "system", "content": _AI_SYSTEM_PROMPT}] + sess["messages"]

    try:
        resp = _openai_client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            max_tokens=400,
            temperature=0.75,
        )
        reply = resp.choices[0].message.content.strip()
        sess["messages"].append({"role": "assistant", "content": reply})
        return jsonify({"ok": True, "reply": reply})
    except Exception as e:
        log.error("OpenAI error: %s", e)
        return jsonify({"ok": False, "message": "Ошибка ИИ-консультанта. Попробуйте позже."}), 500


@app.route("/api/contact", methods=["POST"])
@limiter.limit("10 per hour")
def contact_form():
    payload = json_body()
    name    = text_field(payload, "name", 120)
    email   = text_field(payload, "email", 254, lower=True)
    message = text_field(payload, "message", 4000)

    if not email or not message:
        return jsonify({"ok": False, "message": "Укажите email и сообщение"}), 400
    if not validate_email(email):
        return jsonify({"ok": False, "message": "Некорректный email"}), 400

    subject = f"Сообщение с сайта от {name or email}"
    text    = f"Имя: {name}\nEmail: {email}\n\nСообщение:\n{message}"

    send_notifications_async(subject, text)
    return jsonify({"ok": True, "message": "Сообщение получено"})


@app.route("/api/health", methods=["GET"])
def health():
    if not db.ping():
        log.error("Health check failed: database is unavailable")
        return jsonify({"ok": False, "database": "unavailable"}), 503
    return jsonify({"ok": True, "database": "ok"})


@app.route("/api/auth/register", methods=["POST"])
@limiter.limit("5 per minute;20 per hour")
def auth_register():
    payload = json_body()
    name = text_field(payload, "name", 80)
    email = text_field(payload, "email", 254, lower=True)
    phone = text_field(payload, "phone", 32)
    password = password_field(payload, "password")
    remember = payload.get("remember", True) is True

    if len(name) < 2:
        raise ApiError("Укажите имя (минимум 2 символа)", 400, field="name")
    if not validate_email(email):
        raise ApiError("Некорректный email", 400, field="email")
    if not validate_phone(phone):
        raise ApiError("Некорректный номер телефона", 400, field="phone")
    problem = password_problem(password)
    if problem:
        raise ApiError(problem, 400, field="password")

    password_hash = hash_password(password)
    now = datetime.now().isoformat(timespec="seconds")
    try:
        with db.connect() as conn:
            conn.lock(f"account:{email}")
            if conn.execute("SELECT id FROM customer_accounts WHERE email=?", (email,)).fetchone():
                raise ApiError("Аккаунт с таким email уже существует. Войдите в кабинет.", 409, field="email")
            account_id = conn.insert(
                """
                INSERT INTO customer_accounts
                (email, name, phone, password_hash, email_verified, created_at, updated_at, password_changed_at)
                VALUES (?, ?, ?, ?, 0, ?, ?, ?)
                """,
                (email, name, phone, password_hash, now, now, now),
            )
            token, expires_at = issue_customer_session(conn, account_id, remember)
            account = conn.execute(_ACCOUNT_SESSION_SQL, (access_token_hash(token),)).fetchone()
    except db.IntegrityError:
        raise ApiError("Аккаунт с таким email уже существует. Войдите в кабинет.", 409, field="email")
    return jsonify({"ok": True, "token": token, "expiresAt": expires_at, "account": serialize_account(account)}), 201


@app.route("/api/auth/login", methods=["POST"])
@limiter.limit("10 per minute;60 per hour")
@limiter.limit("20 per hour", key_func=login_rate_key)
def auth_login():
    payload = json_body()
    email = text_field(payload, "email", 254, lower=True)
    password = password_field(payload, "password")
    remember = payload.get("remember") is True
    if not validate_email(email) or not password:
        raise ApiError("Введите email и пароль", 400)

    with db.connect() as conn:
        row = conn.execute("SELECT id, password_hash FROM customer_accounts WHERE email=?", (email,)).fetchone()
    if not row:
        burn_password_check(password)
        raise ApiError("Неверный email или пароль", 401)
    if not verify_password(password, row["password_hash"]):
        raise ApiError("Неверный email или пароль", 401)

    with db.connect() as conn:
        token, expires_at = issue_customer_session(conn, int(row["id"]), remember)
        account = conn.execute(_ACCOUNT_SESSION_SQL, (access_token_hash(token),)).fetchone()
    return jsonify({"ok": True, "token": token, "expiresAt": expires_at, "account": serialize_account(account)})


@app.route("/api/auth/me", methods=["GET"])
@limiter.limit("120 per minute")
def auth_me():
    customer = require_customer()
    return jsonify({"ok": True, "account": serialize_account(customer), "expiresAt": customer["expires_at"]})


@app.route("/api/auth/profile", methods=["POST"])
@limiter.limit("20 per minute")
def auth_update_profile():
    customer = require_customer()
    payload = json_body()
    name = text_field(payload, "name", 80)
    phone = text_field(payload, "phone", 32)
    if len(name) < 2:
        raise ApiError("Укажите имя (минимум 2 символа)", 400, field="name")
    if not validate_phone(phone):
        raise ApiError("Некорректный номер телефона", 400, field="phone")
    with db.connect() as conn:
        conn.execute(
            "UPDATE customer_accounts SET name=?, phone=?, updated_at=? WHERE id=?",
            (name, phone, datetime.now().isoformat(timespec="seconds"), customer["account_id"]),
        )
    return jsonify({"ok": True, "account": serialize_account({**customer, "name": name, "phone": phone})})


@app.route("/api/auth/logout", methods=["POST"])
@limiter.limit("30 per minute")
def auth_logout():
    token = bearer_session_token()
    if token:
        with db.connect() as conn:
            conn.execute(
                "UPDATE customer_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",
                (datetime.now().isoformat(timespec="seconds"), access_token_hash(token)),
            )
    return jsonify({"ok": True, "message": "Вы вышли из аккаунта"})


@app.route("/api/auth/logout-all", methods=["POST"])
@limiter.limit("10 per minute")
def auth_logout_all():
    customer = require_customer()
    with db.connect() as conn:
        result = conn.execute(
            "UPDATE customer_sessions SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL",
            (datetime.now().isoformat(timespec="seconds"), customer["account_id"]),
        )
        revoked = max(0, result.rowcount or 0)
    return jsonify({"ok": True, "revokedSessions": revoked, "message": "Все сессии аккаунта завершены"})


@app.route("/api/auth/password", methods=["POST"])
@limiter.limit("5 per minute;20 per hour")
def auth_change_password():
    customer = require_customer()
    payload = json_body()
    current_password = password_field(payload, "currentPassword")
    new_password = password_field(payload, "newPassword")
    if not current_password:
        raise ApiError("Введите текущий пароль", 400, field="currentPassword")
    problem = password_problem(new_password)
    if problem:
        raise ApiError(problem, 400, field="newPassword")
    if new_password == current_password:
        raise ApiError("Новый пароль должен отличаться от текущего", 400, field="newPassword")

    with db.connect() as conn:
        row = conn.execute(
            "SELECT password_hash FROM customer_accounts WHERE id=?", (customer["account_id"],)
        ).fetchone()
    if not row or not verify_password(current_password, row["password_hash"]):
        raise ApiError("Текущий пароль указан неверно", 400, field="currentPassword")

    new_hash = hash_password(new_password)
    now = datetime.now().isoformat(timespec="seconds")
    with db.connect() as conn:
        conn.execute(
            "UPDATE customer_accounts SET password_hash=?, password_changed_at=?, updated_at=? WHERE id=?",
            (new_hash, now, now, customer["account_id"]),
        )
        result = conn.execute(
            "UPDATE customer_sessions SET revoked_at=? WHERE account_id=? AND id<>? AND revoked_at IS NULL",
            (now, customer["account_id"], customer["session_id"]),
        )
        revoked = max(0, result.rowcount or 0)
    return jsonify({
        "ok": True,
        "revokedSessions": revoked,
        "message": "Пароль изменён. Другие устройства вышли из аккаунта.",
    })


@app.route("/api/auth/password/forgot", methods=["POST"])
@app.route("/api/auth/password/reset", methods=["POST"])
@limiter.limit("10 per hour")
def auth_password_recovery_unavailable():
    return jsonify({
        "ok": False,
        "recoveryAvailable": False,
        "message": (
            "Автоматическое восстановление пароля пока не подключено. "
            f"Напишите в WhatsApp {SUPPORT_WHATSAPP} — администратор поможет восстановить доступ."
        ),
    }), 503


@app.route("/api/admin/login", methods=["POST"])
@limiter.limit("20 per minute")
def admin_login():
    payload = json_body()
    password = text_field(payload, "password", 256)
    if not ADMIN_PASSWORD:
        return jsonify({"ok": False, "message": "Спецвход отключен: пароль администратора не настроен"}), 503
    if not hmac.compare_digest(password, ADMIN_PASSWORD):
        return jsonify({"ok": False, "message": "Неверный пароль спецвхода"}), 401
    token = issue_admin_token()
    return jsonify({"ok": True, "token": token, "expiresInMinutes": ADMIN_SESSION_MINUTES})


@app.route("/api/admin/content", methods=["GET", "POST"])
def admin_content():
    auth_error = require_admin_or_401()
    if auth_error:
        return auth_error

    if request.method == "GET":
        with db.connect() as conn:
            rows = conn.execute(
                "SELECT id, kind, title, body, media_url, created_at FROM content_items ORDER BY id DESC"
            ).fetchall()
        return jsonify({"ok": True, "items": [dict(r) for r in rows]})

    payload = json_body()
    kind = text_field(payload, "kind", 20, lower=True)
    title = text_field(payload, "title", 200)
    body = text_field(payload, "body", 20000)
    media_url = text_field(payload, "mediaUrl", 2000)

    if kind not in {"story", "doc", "photo", "video"}:
        return jsonify({"ok": False, "message": "Тип должен быть: story/doc/photo/video"}), 400
    if not title:
        return jsonify({"ok": False, "message": "Укажите заголовок"}), 400

    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO content_items (kind, title, body, media_url, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (kind, title, body, media_url, datetime.now().isoformat()),
        )
        conn.commit()

    return jsonify({"ok": True, "message": "Контент добавлен"})


@app.route("/api/content", methods=["GET"])
def public_content():
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, kind, title, body, media_url, created_at FROM content_items ORDER BY id DESC LIMIT 50"
        ).fetchall()
    return jsonify({"ok": True, "items": [dict(r) for r in rows]})


@app.route("/api/admin/participants", methods=["GET"])
def admin_participants():
    auth_error = require_admin_or_401()
    if auth_error:
        return auth_error

    with db.connect() as conn:
        bookings = conn.execute(
            """
            SELECT name, email, phone, booking_at, created_at
            FROM bookings
            ORDER BY id DESC
            LIMIT 500
            """
        ).fetchall()
        learners = conn.execute(
            """
            SELECT name, email, phone, status, created_at
            FROM training_enrollments
            ORDER BY id DESC
            LIMIT 500
            """
        ).fetchall()

    return jsonify(
        {
            "ok": True,
            "bookings": [dict(r) for r in bookings],
            "learners": [dict(r) for r in learners],
        }
    )


@app.route("/api/admin/messages", methods=["GET"])
def admin_messages():
    auth_error = require_admin_or_401()
    if auth_error:
        return auth_error

    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT id, from_email, to_email, subject, text, sender_role, created_at
            FROM client_messages
            ORDER BY id DESC
            LIMIT 500
            """
        ).fetchall()
    return jsonify({"ok": True, "messages": [dict(r) for r in rows]})


def build_analytics(start_dt: datetime | None = None, end_dt: datetime | None = None):
    now = datetime.now()
    this_month_start = month_start(now)
    prev_month_start = shift_month(this_month_start, -1)
    next_month_start = shift_month(this_month_start, 1)

    with db.connect() as conn:
        payments = conn.execute(
            """
            SELECT amount, status, currency, consumed, created_at
            FROM payments
            ORDER BY id DESC
            """
        ).fetchall()
        bookings = conn.execute(
            """
            SELECT email, service, created_at
            FROM bookings
            ORDER BY id DESC
            """
        ).fetchall()
        learners = conn.execute(
            """
            SELECT email, status, created_at
            FROM training_enrollments
            ORDER BY id DESC
            """
        ).fetchall()
        messages = conn.execute(
            """
            SELECT from_email, sender_role, created_at
            FROM client_messages
            ORDER BY id DESC
            """
        ).fetchall()

    def in_range(created_at: datetime | None):
        if not created_at:
            return False
        if start_dt and created_at < start_dt:
            return False
        if end_dt and created_at >= end_dt:
            return False
        return True

    paid_payments = []
    for p in payments:
        if p["status"] != "paid":
            continue
        created_at = parse_iso(p["created_at"])
        if not created_at or not in_range(created_at):
            continue
        paid_payments.append(
            {
                "amount": int(p["amount"] or 0),
                "currency": p["currency"] or "KZT",
                "consumed": int(p["consumed"] or 0),
                "created_at": created_at,
            }
        )

    filtered_bookings = [b for b in bookings if in_range(parse_iso(b["created_at"]))]
    filtered_learners = [l for l in learners if in_range(parse_iso(l["created_at"]))]
    filtered_messages = [m for m in messages if in_range(parse_iso(m["created_at"]))]

    total_revenue = sum(p["amount"] for p in paid_payments)
    this_month_revenue = sum(
        p["amount"]
        for p in paid_payments
        if this_month_start <= p["created_at"] < next_month_start
    )
    prev_month_revenue = sum(
        p["amount"]
        for p in paid_payments
        if prev_month_start <= p["created_at"] < this_month_start
    )
    growth_pct = 0
    if prev_month_revenue > 0:
        growth_pct = round(((this_month_revenue - prev_month_revenue) / prev_month_revenue) * 100)

    labels = []
    values = []
    for i in range(5, -1, -1):
        ms = shift_month(this_month_start, -i)
        me = shift_month(ms, 1)
        labels.append(ms.strftime("%Y-%m"))
        values.append(sum(p["amount"] for p in paid_payments if ms <= p["created_at"] < me))

    services_counter = Counter()
    for b in filtered_bookings:
        service = (b["service"] or "Не указано").strip() or "Не указано"
        services_counter[service] += 1

    first_seen = {}
    unique_clients = set()

    def touch_client(email_value, when):
        email = (email_value or "").strip().lower()
        if not validate_email(email):
            return
        unique_clients.add(email)
        if when:
            old = first_seen.get(email)
            if not old or when < old:
                first_seen[email] = when

    for b in filtered_bookings:
        touch_client(b["email"], parse_iso(b["created_at"]))

    for l in filtered_learners:
        touch_client(l["email"], parse_iso(l["created_at"]))

    for m in filtered_messages:
        if (m["sender_role"] or "").strip() == "client":
            touch_client(m["from_email"], parse_iso(m["created_at"]))

    new_clients_30 = 0
    threshold = now - timedelta(days=30)
    for seen in first_seen.values():
        if seen and seen >= threshold:
            new_clients_30 += 1

    activity = defaultdict(lambda: {"bookings": 0, "messages": 0, "enrollments": 0, "lastAt": None})

    for b in filtered_bookings:
        email = (b["email"] or "").strip().lower()
        if not validate_email(email):
            continue
        activity[email]["bookings"] += 1
        created = parse_iso(b["created_at"])
        if created and (not activity[email]["lastAt"] or created > activity[email]["lastAt"]):
            activity[email]["lastAt"] = created

    for l in filtered_learners:
        email = (l["email"] or "").strip().lower()
        if not validate_email(email):
            continue
        activity[email]["enrollments"] += 1
        created = parse_iso(l["created_at"])
        if created and (not activity[email]["lastAt"] or created > activity[email]["lastAt"]):
            activity[email]["lastAt"] = created

    for m in filtered_messages:
        if (m["sender_role"] or "").strip() != "client":
            continue
        email = (m["from_email"] or "").strip().lower()
        if not validate_email(email):
            continue
        activity[email]["messages"] += 1
        created = parse_iso(m["created_at"])
        if created and (not activity[email]["lastAt"] or created > activity[email]["lastAt"]):
            activity[email]["lastAt"] = created

    top_clients = sorted(
        [
            {
                "email": email,
                "bookings": stats["bookings"],
                "messages": stats["messages"],
                "enrollments": stats["enrollments"],
                "score": stats["bookings"] * 2 + stats["messages"] + stats["enrollments"] * 3,
                "lastAt": stats["lastAt"].isoformat() if stats["lastAt"] else None,
            }
            for email, stats in activity.items()
        ],
        key=lambda x: (x["score"], x["lastAt"] or ""),
        reverse=True,
    )[:10]

    accepted = sum(1 for l in filtered_learners if (l["status"] or "") == "accepted")
    waitlist = sum(1 for l in filtered_learners if (l["status"] or "") == "waitlist")

    return {
        "ok": True,
        "metrics": {
            "totalRevenue": total_revenue,
            "monthRevenue": this_month_revenue,
            "previousMonthRevenue": prev_month_revenue,
            "monthGrowthPct": growth_pct,
            "paidPayments": len(paid_payments),
            "bookingsTotal": len(filtered_bookings),
            "acceptedLearners": accepted,
            "waitlistLearners": waitlist,
            "totalClients": len(unique_clients),
            "newClients30": new_clients_30,
        },
        "revenueSeries": {"labels": labels, "values": values},
        "topServices": [
            {"name": name, "count": count}
            for name, count in services_counter.most_common(6)
        ],
        "topClients": top_clients,
    }


@app.route("/api/admin/analytics", methods=["GET"])
def admin_analytics():
    auth_error = require_admin_or_401()
    if auth_error:
        return auth_error

    start = (request.args.get("start") or "").strip()
    end = (request.args.get("end") or "").strip()
    start_dt = parse_ymd(start) if start else None
    end_dt = parse_ymd(end) + timedelta(days=1) if end else None
    if start and not start_dt:
        return jsonify({"ok": False, "message": "Некорректная дата start"}), 400
    if end and not parse_ymd(end):
        return jsonify({"ok": False, "message": "Некорректная дата end"}), 400
    if start_dt and end_dt and start_dt >= end_dt:
        return jsonify({"ok": False, "message": "Период задан некорректно"}), 400

    return jsonify(build_analytics(start_dt, end_dt))


@app.route("/api/admin/analytics/export.csv", methods=["GET"])
def admin_analytics_export_csv():
    auth_error = require_admin_or_401()
    if auth_error:
        return auth_error

    start = (request.args.get("start") or "").strip()
    end = (request.args.get("end") or "").strip()
    start_dt = parse_ymd(start) if start else None
    end_dt = parse_ymd(end) + timedelta(days=1) if end else None
    data = build_analytics(start_dt, end_dt)

    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(["metric", "value"])
    for key, value in data["metrics"].items():
        writer.writerow([key, value])

    writer.writerow([])
    writer.writerow(["top_service", "count"])
    for item in data["topServices"]:
        writer.writerow([item["name"], item["count"]])

    writer.writerow([])
    writer.writerow(["client_email", "bookings", "enrollments", "messages", "score", "last_at"])
    for row in data["topClients"]:
        writer.writerow([row["email"], row["bookings"], row["enrollments"], row["messages"], row["score"], row["lastAt"] or ""])

    csv_data = buf.getvalue()
    filename = f"analytics-{datetime.now().strftime('%Y%m%d-%H%M')}.csv"
    return Response(
        csv_data,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.route("/api/admin/messages/send", methods=["POST"])
def admin_send_message():
    auth_error = require_admin_or_401()
    if auth_error:
        return auth_error

    payload = json_body()
    to_email = text_field(payload, "toEmail", 254, lower=True)
    subject = text_field(payload, "subject", 200)
    text = text_field(payload, "text", 4000)

    if not validate_email(to_email):
        return jsonify({"ok": False, "message": "Некорректный email клиента"}), 400
    if len(text) < 2:
        return jsonify({"ok": False, "message": "Введите текст сообщения"}), 400

    with db.connect() as conn:
        # Private inbox delivery is only allowed to accounts whose email ownership is verified.
        account = conn.execute(
            "SELECT id FROM customer_accounts WHERE email=? AND email_verified=1", (to_email,)
        ).fetchone()
        conn.execute(
            """
            INSERT INTO client_messages (from_email, to_email, subject, text, sender_role, created_at, account_id)
            VALUES (?, ?, ?, ?, 'admin', ?, ?)
            """,
            ("admin@roza-ogly.local", to_email, subject, text, datetime.now().isoformat(),
             int(account["id"]) if account else None),
        )
        conn.commit()

    return jsonify({
        "ok": True,
        "deliveredToInbox": bool(account),
        "message": "Сообщение отправлено клиенту" if account else "Сообщение сохранено: у клиента нет подтверждённого аккаунта",
    })


@app.route("/api/messages/inbox", methods=["GET"])
@limiter.limit("60 per minute")
def client_inbox():
    customer = require_customer()
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT id, from_email, to_email, subject, text, sender_role, created_at
            FROM client_messages
            WHERE account_id=?
            ORDER BY id DESC
            LIMIT 300
            """,
            (customer["account_id"],),
        ).fetchall()

    return jsonify({"ok": True, "messages": [dict(r) for r in rows]})


@app.route("/api/messages/reply", methods=["POST"])
@limiter.limit("30 per hour")
def client_reply():
    customer = require_customer()
    payload = json_body()
    text = text_field(payload, "text", 4000)
    if len(text) < 2:
        return jsonify({"ok": False, "message": "Введите текст сообщения"}), 400

    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO client_messages (from_email, to_email, subject, text, sender_role, created_at, account_id)
            VALUES (?, ?, ?, ?, 'client', ?, ?)
            """,
            (customer["email"], "admin@roza-ogly.local", "Ответ клиента", text,
             datetime.now().isoformat(), customer["account_id"]),
        )
        conn.commit()

    return jsonify({"ok": True, "message": "Ответ отправлен администратору"})


def serialize_order(row):
    return {
        "code": row["code"],
        "kind": row["kind"],
        "title": row["title"],
        "amount": int(row["amount"]),
        "currency": row["currency"],
        "status": row["status"],
        "enrollmentStatus": row["enrollment_status"],
        "createdAt": row["created_at"],
    }


def payment_card_config():
    number = re.sub(r"\s+", "", os.getenv("PAYMENT_CARD_NUMBER", ""))
    holder = os.getenv("PAYMENT_CARD_HOLDER", "").strip()
    bank = os.getenv("PAYMENT_BANK_NAME", "").strip()
    configured = bool(re.fullmatch(r"\d{16,19}", number) and holder and bank)
    return {
        "configured": configured,
        "card": {"number": number, "holder": holder, "bank": bank} if configured else None,
    }


@app.route("/api/payments/config", methods=["GET"])
def get_payment_config():
    return jsonify({"ok": True, **payment_card_config()})


def account_owner_clause(customer: dict, token: str, email_column: str) -> tuple[str, tuple]:
    """Records owned by the account, plus legacy guest records created in this browser for the same email."""
    return (
        f"(account_id=? OR (account_id IS NULL AND {email_column}=? AND access_token_hash=?))",
        (customer["account_id"], customer["email"], capability_hash_or_sentinel(token)),
    )


ORDER_COLUMNS = "code, kind, title, amount, currency, status, enrollment_status, created_at"
ORDER_PRICES = {
    ("consultation", "Личная встреча"): 50000,
    ("consultation", "Онлайн встреча"): 35000,
}


@app.route("/api/orders", methods=["POST"])
@limiter.limit("10 per minute")
def create_order():
    customer = require_customer()
    payload = json_body()
    kind = text_field(payload, "kind", 40, lower=True)
    title = text_field(payload, "title", 200)
    name = text_field(payload, "name", 120) or customer["name"]
    phone = text_field(payload, "phone", 32) or (customer["phone"] or "")
    email = customer["email"]
    token = request_access_token(payload)

    prices = {("training", "Программа «Практик Матрицы»"): TRAINING_PRICE_KZT, **ORDER_PRICES}
    amount = prices.get((kind, title))
    if not amount or len(name) < 2:
        return jsonify({"ok": False, "message": "Некорректные данные заказа"}), 400
    if not validate_phone(phone):
        return jsonify({"ok": False, "message": "Некорректный номер телефона"}), 400
    card_config = payment_card_config()
    if not card_config["configured"]:
        return jsonify({"ok": False, "message": "Оплата временно недоступна: реквизиты не настроены"}), 503

    owner_sql, owner_params = account_owner_clause(customer, token, "customer_email")
    now = datetime.now().isoformat()
    reused = False
    with db.connect() as conn:
        conn.lock(f"orders:account:{customer['account_id']}")
        if kind == "training":
            already_paid = conn.execute(
                f"SELECT code FROM orders WHERE {owner_sql} AND kind='training' AND status='paid' LIMIT 1",
                owner_params,
            ).fetchone()
            if already_paid:
                raise ApiError("Обучение уже оплачено — повторная оплата не нужна", 409, alreadyPaid=True)
        # Only unfinished orders are reused, so retries never duplicate a transfer,
        # while a new consultation after a paid one gets its own order.
        existing = conn.execute(
            f"""
            SELECT {ORDER_COLUMNS} FROM orders
            WHERE {owner_sql} AND kind=? AND title=? AND status IN ('awaiting_payment', 'pending_review')
            ORDER BY id DESC LIMIT 1
            """,
            (*owner_params, kind, title),
        ).fetchone()
        if existing:
            order = serialize_order(existing)
            reused = True
        else:
            code = "ORD-" + secrets.token_hex(5).upper()
            conn.execute(
                """
                INSERT INTO orders (
                    code, access_token_hash, account_id, kind, title, amount, currency, customer_name,
                    customer_email, customer_phone, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'KZT', ?, ?, ?, 'awaiting_payment', ?, ?)
                """,
                (
                    code, access_token_hash(token) if valid_access_token(token) else None,
                    customer["account_id"], kind, title, amount, name, email, phone, now, now,
                ),
            )
            order = {
                "code": code,
                "kind": kind,
                "title": title,
                "amount": amount,
                "currency": "KZT",
                "status": "awaiting_payment",
                "enrollmentStatus": None,
                "createdAt": now,
            }

    return jsonify({"ok": True, "order": order, "reused": reused, **card_config})


@app.route("/api/orders", methods=["GET"])
@limiter.limit("30 per minute")
def list_orders():
    customer = require_customer()
    owner_sql, owner_params = account_owner_clause(customer, request_access_token(), "customer_email")
    with db.connect() as conn:
        rows = conn.execute(
            f"SELECT {ORDER_COLUMNS} FROM orders WHERE {owner_sql} ORDER BY id DESC LIMIT 50",
            owner_params,
        ).fetchall()
    return jsonify({"ok": True, "orders": [serialize_order(row) for row in rows]})


@app.route("/api/orders/<code>", methods=["GET"])
@limiter.limit("30 per minute")
def get_order(code):
    customer = require_customer()
    owner_sql, owner_params = account_owner_clause(customer, request_access_token(), "customer_email")
    with db.connect() as conn:
        row = conn.execute(
            f"SELECT {ORDER_COLUMNS} FROM orders WHERE code=? AND {owner_sql}",
            (code, *owner_params),
        ).fetchone()
    if not row:
        return jsonify({"ok": False, "message": "Заказ не найден"}), 404
    return jsonify({"ok": True, "order": serialize_order(row)})


@app.route("/api/orders/<code>/paid", methods=["POST"])
@limiter.limit("10 per minute")
def mark_order_paid(code):
    customer = require_customer()
    payload = json_body()
    owner_sql, owner_params = account_owner_clause(customer, request_access_token(payload), "customer_email")

    reported_payment = False
    with db.connect() as conn:
        conn.lock(f"order:{code}")
        row = conn.execute(
            f"SELECT {ORDER_COLUMNS} FROM orders WHERE code=? AND {owner_sql}",
            (code, *owner_params),
        ).fetchone()
        if not row:
            return jsonify({"ok": False, "message": "Заказ не найден"}), 404
        if row["status"] not in {"awaiting_payment", "pending_review", "paid"}:
            return jsonify({"ok": False, "message": "Заказ больше не ожидает подтверждения"}), 409
        if row["status"] == "awaiting_payment":
            conn.execute(
                "UPDATE orders SET status='pending_review', updated_at=? WHERE code=?",
                (datetime.now().isoformat(), code),
            )
            row = {**dict(row), "status": "pending_review"}
            reported_payment = True
    if reported_payment:
        send_notifications_async(
            "Перевод ожидает проверки",
            f"Клиент сообщил об оплате заказа {code}: {row['amount']} {row['currency']}, {customer['email']}.",
        )
    return jsonify({"ok": True, "order": serialize_order(row)})


@app.route("/api/orders/<code>/review", methods=["POST"])
@limiter.limit("30 per minute")
def review_order(code):
    if not ensure_task_secret(request):
        return jsonify({"ok": False, "message": "Неверный task token"}), 401
    payload = json_body()
    action = text_field(payload, "action", 20, lower=True)
    if action not in {"confirm", "reject"}:
        return jsonify({"ok": False, "message": "Укажите действие confirm или reject"}), 400

    notification = None
    with db.connect() as conn:
        conn.lock(f"order:{code}")
        row = conn.execute("SELECT * FROM orders WHERE code=?", (code,)).fetchone()
        if not row:
            return jsonify({"ok": False, "message": "Заказ не найден"}), 404
        if row["status"] != "pending_review":
            return jsonify({"ok": False, "message": "Заказ не ожидает проверки"}), 409
        now = datetime.now().isoformat()
        if action == "reject":
            conn.execute(
                "UPDATE orders SET status='rejected', updated_at=? WHERE code=?",
                (now, code),
            )
        else:
            enrollment_status = None
            if row["kind"] == "training":
                conn.lock("training-capacity")
                duplicate = conn.execute(
                    "SELECT id FROM training_enrollments WHERE LOWER(email)=? LIMIT 1",
                    (row["customer_email"].lower(),),
                ).fetchone()
                if duplicate:
                    return jsonify({"ok": False, "message": "Для клиента уже создана заявка на обучение"}), 409
                accepted = conn.execute(
                    "SELECT COUNT(*) AS c FROM training_enrollments WHERE status='accepted'"
                ).fetchone()["c"]
                enrollment_status = "accepted" if accepted < TRAINING_CAPACITY else "waitlist"
                conn.execute(
                    """
                    INSERT INTO training_enrollments
                    (name, email, phone, payment_verified, payment_id, status, created_at)
                    VALUES (?, ?, ?, 1, ?, ?, ?)
                    """,
                    (
                        row["customer_name"], row["customer_email"], row["customer_phone"],
                        code, enrollment_status, now,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO purchases
                    (kind, title, unit_price, quantity, amount, currency, customer_name,
                     customer_email, customer_phone, payment_id, status, created_at)
                    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'paid', ?)
                    """,
                    (
                        row["kind"], row["title"], row["amount"], row["amount"], row["currency"],
                        row["customer_name"], row["customer_email"], row["customer_phone"], code, now,
                    ),
                )
            conn.execute(
                "UPDATE orders SET status='paid', enrollment_status=?, updated_at=? WHERE code=?",
                (enrollment_status, now, code),
            )
            notification = (
                "Оплата подтверждена",
                f"Заказ {code} подтвержден для {row['customer_name']} ({row['customer_email']}).",
            )
        updated = conn.execute(
            """
            SELECT code, kind, title, amount, currency, status, enrollment_status, created_at
            FROM orders WHERE code=?
            """,
            (code,),
        ).fetchone()

    if notification:
        send_notifications_async(*notification)
    return jsonify({"ok": True, "order": serialize_order(updated)})


@app.route("/api/payments/verify", methods=["POST"])
@limiter.limit("20 per minute")
def verify_payment():
    return jsonify({"ok": False, "message": "Самостоятельное подтверждение картой отключено"}), 410


@app.route("/api/purchases/confirm", methods=["POST"])
@limiter.limit("15 per minute")
def confirm_purchase():
    return jsonify({"ok": False, "message": "Старый способ подтверждения оплаты отключён"}), 410


@app.route("/api/bookings", methods=["GET"])
@limiter.limit("60 per minute")
def get_user_bookings():
    """Возвращает записи аккаунта (и гостевые записи этого браузера с тем же email)."""
    customer = optional_customer()
    token = request_access_token()
    now = datetime.now()
    with db.connect() as conn:
        if customer:
            owner_sql, owner_params = account_owner_clause(customer, token, "email")
            rows = conn.execute(
                f"""
                SELECT id, name, service, format, booking_at, created_at
                FROM bookings
                WHERE {owner_sql} AND status <> 'cancelled'
                ORDER BY booking_at DESC
                LIMIT 50
                """,
                owner_params,
            ).fetchall()
        else:
            email = (request.args.get("email") or "").strip().lower()
            if not validate_email(email) or not valid_access_token(token):
                return jsonify({"ok": False, "message": "Не удалось подтвердить доступ к записям"}), 401
            rows = conn.execute(
                """
                SELECT id, name, service, format, booking_at, created_at
                FROM bookings
                WHERE email=? AND access_token_hash=? AND status <> 'cancelled'
                ORDER BY booking_at DESC
                LIMIT 50
                """,
                (email, access_token_hash(token)),
            ).fetchall()

    upcoming = []
    past = []
    for row in rows:
        booking_at = parse_iso(row["booking_at"])
        if not booking_at:
            continue
        item = {
            "id": row["id"],
            "service": row["service"],
            "format": row["format"] or "",
            "booking_at": booking_at.strftime("%d.%m.%Y %H:%M"),
            "booking_iso": row["booking_at"],
        }
        if booking_at >= now:
            upcoming.append(item)
        else:
            past.append(item)

    # upcoming по возрастанию (ближайший первый)
    upcoming.sort(key=lambda x: x["booking_iso"])
    return jsonify({"ok": True, "upcoming": upcoming, "past": past})


@app.route("/api/bookings/slots", methods=["GET"])
def booking_slots():
    date = (request.args.get("date") or "").strip()
    requested_time = (request.args.get("time") or "").strip()
    target_day = parse_ymd(date)
    if not target_day:
        return jsonify({"ok": False, "message": "Укажите дату в формате YYYY-MM-DD"}), 400

    target_start = target_day.replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = target_start - timedelta(days=1)
    day_end = target_start + timedelta(days=2)

    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT booking_at FROM bookings
            WHERE status <> 'cancelled' AND booking_at >= ? AND booking_at < ?
            """,
            (day_start.isoformat(), day_end.isoformat()),
        ).fetchall()

    booked = [parse_iso(r["booking_at"]) for r in rows]
    booked = [x for x in booked if x]

    slots = []
    t = target_start.replace(hour=BOOKING_START_HOUR, minute=0)
    while t < target_start.replace(hour=BOOKING_END_HOUR, minute=0):
        slots.append(t)
        t += timedelta(minutes=SLOT_STEP_MINUTES)

    available = []
    busy = []
    now = datetime.now()
    for slot in slots:
        if slot < now + timedelta(minutes=30):
            continue
        conflict = any(abs((b - slot).total_seconds()) / 60 < TIME_GAP_MINUTES for b in booked)
        if conflict:
            busy.append(slot.strftime("%H:%M"))
        else:
            available.append(slot.strftime("%H:%M"))

    suggested = None
    if requested_time and re.match(r"^\d{2}:\d{2}$", requested_time):
        requested_dt = parse_iso(f"{date}T{requested_time}:00")
        if requested_dt:
            ordered = sorted(
                available,
                key=lambda s: abs((parse_iso(f"{date}T{s}:00") - requested_dt).total_seconds()),
            )
            if ordered:
                suggested = ordered[0]

    return jsonify(
        {
            "ok": True,
            "date": date,
            "available": available,
            "busy": busy,
            "suggestedTime": suggested,
        }
    )


def process_reminders_once():
    now = datetime.now()
    window_24h_start = now + timedelta(hours=23, minutes=30)
    window_24h_end = now + timedelta(hours=24, minutes=30)
    window_2h_start = now + timedelta(hours=1, minutes=30)
    window_2h_end = now + timedelta(hours=2, minutes=30)

    sent_24h = 0
    sent_2h = 0

    with db.connect() as conn:
        rows_24h = conn.execute(
            """
            SELECT id, name, email, phone, service, booking_at, format
            FROM bookings
            WHERE reminder_24h_sent=0 AND status <> 'cancelled'
            """
        ).fetchall()
        rows_2h = conn.execute(
            """
            SELECT id, name, email, phone, service, booking_at, format
            FROM bookings
            WHERE reminder_2h_sent=0 AND status <> 'cancelled'
            """
        ).fetchall()

    for row in rows_24h:
        booking_at = parse_iso(row["booking_at"])
        if not booking_at or not (window_24h_start <= booking_at <= window_24h_end):
            continue
        text = (
            "Напоминание за 24 часа\n"
            f"Клиент: {row['name']}\n"
            f"Email: {row['email']}\n"
            f"Телефон: {row['phone'] or '—'}\n"
            f"Услуга: {row['service']}\n"
            f"Формат: {row['format'] or '—'}\n"
            f"Время: {booking_at.strftime('%d.%m.%Y %H:%M')}"
        )
        notify = send_all_notifications("Напоминание клиенту за 24 часа", text)
        if notification_any_success(notify):
            with db.connect() as conn:
                conn.execute(
                    "UPDATE bookings SET reminder_24h_sent=1, reminder_24h_sent_at=? WHERE id=? AND reminder_24h_sent=0",
                    (now.isoformat(), row["id"]),
                )
                conn.commit()
            sent_24h += 1

    for row in rows_2h:
        booking_at = parse_iso(row["booking_at"])
        if not booking_at or not (window_2h_start <= booking_at <= window_2h_end):
            continue
        text = (
            "Напоминание за 2 часа\n"
            f"Клиент: {row['name']}\n"
            f"Email: {row['email']}\n"
            f"Телефон: {row['phone'] or '—'}\n"
            f"Услуга: {row['service']}\n"
            f"Формат: {row['format'] or '—'}\n"
            f"Время: {booking_at.strftime('%d.%m.%Y %H:%M')}"
        )
        notify = send_all_notifications("Напоминание клиенту за 2 часа", text)
        if notification_any_success(notify):
            with db.connect() as conn:
                conn.execute(
                    "UPDATE bookings SET reminder_2h_sent=1, reminder_2h_sent_at=? WHERE id=? AND reminder_2h_sent=0",
                    (now.isoformat(), row["id"]),
                )
                conn.commit()
            sent_2h += 1

    return {"sent24h": sent_24h, "sent2h": sent_2h}


@app.route("/api/tasks/reminders/run", methods=["POST"])
def run_reminders_task():
    if not ensure_task_secret(request):
        return jsonify({"ok": False, "message": "Неверный task token"}), 401
    stats = process_reminders_once()
    return jsonify({"ok": True, **stats})


def start_reminder_worker_once():
    global _REMINDER_THREAD_STARTED
    if _REMINDER_THREAD_STARTED or not REMINDER_JOB_ENABLED:
        return
    _REMINDER_THREAD_STARTED = True

    def worker():
        while True:
            try:
                process_reminders_once()
            except Exception:
                log.exception("Reminder worker failed")
            time.sleep(max(30, REMINDER_JOB_INTERVAL_SECONDS))

    thread = threading.Thread(target=worker, daemon=True, name="reminder-worker")
    thread.start()


@app.route("/api/bookings", methods=["POST"])
@limiter.limit("20 per minute")
def create_booking():
    payload = json_body()
    customer = optional_customer()
    name = text_field(payload, "name", 120) or (customer["name"] if customer else "")
    email = text_field(payload, "email", 254, lower=True) or (customer["email"] if customer else "")
    phone = text_field(payload, "phone", 32) or ((customer["phone"] or "") if customer else "")
    service = text_field(payload, "service", 120)
    token = request_access_token(payload)
    date = text_field(payload, "date", 10)
    time = text_field(payload, "time", 5)
    form = text_field(payload, "format", 60)
    note = text_field(payload, "note", 2000)

    if not all([name, email, service, date, time]):
        return jsonify({"ok": False, "message": "Заполните обязательные поля"}), 400
    if not validate_email(email):
        return jsonify({"ok": False, "message": "Некорректный email"}), 400
    if not validate_phone(phone):
        return jsonify({"ok": False, "message": "Некорректный номер телефона"}), 400
    if customer is None and not valid_access_token(token):
        return jsonify({"ok": False, "message": "Не удалось подтвердить доступ к записи"}), 400
    email = email.lower()

    booking_at = parse_iso(f"{date}T{time}:00")
    if not booking_at:
        return jsonify({"ok": False, "message": "Некорректная дата или время"}), 400
    minutes_from_open = (booking_at.hour - BOOKING_START_HOUR) * 60 + booking_at.minute
    if minutes_from_open < 0 or booking_at.hour >= BOOKING_END_HOUR or minutes_from_open % SLOT_STEP_MINUTES != 0:
        return jsonify({"ok": False, "message": "Выберите время из доступных интервалов"}), 400

    now = datetime.now()
    if booking_at < now + timedelta(minutes=30):
        return jsonify({"ok": False, "message": "Нельзя записаться на прошедшее или слишком близкое время"}), 400

    day_start = booking_at.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    day_end = day_start + timedelta(days=3)
    with db.connect() as conn:
        conn.lock("bookings")
        rows = conn.execute(
            """
            SELECT booking_at FROM bookings
            WHERE status <> 'cancelled' AND booking_at >= ? AND booking_at < ?
            """,
            (day_start.isoformat(), day_end.isoformat()),
        ).fetchall()
        for row in rows:
            existing = parse_iso(row["booking_at"])
            if not existing:
                continue
            diff = abs((existing - booking_at).total_seconds()) / 60
            if diff < TIME_GAP_MINUTES:
                next_available = existing + timedelta(minutes=TIME_GAP_MINUTES)
                return jsonify(
                    {
                        "ok": False,
                        "conflict": True,
                        "message": "К сожалению, это время занято. Выберите минимум через 1 час.",
                        "suggestedTime": next_available.strftime("%H:%M"),
                    }
                ), 409

        conn.execute(
            """
            INSERT INTO bookings (
                name, email, access_token_hash, account_id, phone, service, format, note, booking_at, created_at,
                reminder_24h_sent, reminder_2h_sent
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
            """,
            (
                name,
                email,
                access_token_hash(token) if valid_access_token(token) else None,
                customer["account_id"] if customer else None,
                phone,
                service,
                form,
                note,
                booking_at.isoformat(),
                now.isoformat(),
            ),
        )
        conn.commit()

    msg = (
        "Новая запись на приём\n"
        f"Имя: {name}\n"
        f"Email: {email}\n"
        f"Телефон: {phone or '—'}\n"
        f"Услуга: {service}\n"
        f"Дата/время: {booking_at.strftime('%d.%m.%Y %H:%M')}\n"
        f"Формат: {form or '—'}\n"
        f"Комментарий: {note or '—'}"
    )
    send_notifications_async("Новая запись на прием", msg)

    return jsonify({"ok": True, "message": "Вы успешно записаны", "notificationQueued": True})


@app.route("/api/training/status", methods=["GET"])
def training_status():
    with db.connect() as conn:
        accepted = conn.execute("SELECT COUNT(*) c FROM training_enrollments WHERE status='accepted'").fetchone()["c"]
        waiting = conn.execute("SELECT COUNT(*) c FROM training_enrollments WHERE status='waitlist'").fetchone()["c"]
    return jsonify({"ok": True, "capacity": TRAINING_CAPACITY, "accepted": accepted, "waiting": waiting})


@app.route("/api/training/enroll", methods=["POST"])
@limiter.limit("15 per minute")
def enroll_training():
    return jsonify({"ok": False, "message": "Старый способ зачисления отключён"}), 410


@app.route("/api/support", methods=["POST"])
@limiter.limit("20 per minute")
def support_ai():
    payload = json_body()
    question = text_field(payload, "question", 2000)
    if len(question) < 4:
        return jsonify({"ok": False, "message": "Опишите проблему подробнее"}), 400

    api_key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    if not api_key:
        return jsonify({"ok": False, "message": "AI техподдержка временно недоступна"}), 503

    system_prompt = (
        "Ты техническая поддержка сайта Матрица Судьбы. "
        "Отвечай только по техническим проблемам: запись, оплата, вход, ошибки на сайте, обучение, личный кабинет. "
        "Если вопрос не про техподдержку — вежливо откажись и предложи написать в WhatsApp 87072867777. "
        "Не задавай лишние вопросы. Дай короткие пошаговые инструкции."
    )

    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question},
            ],
            "temperature": 0.2,
            "max_tokens": 350,
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        return jsonify({"ok": False, "message": "AI сервис временно недоступен"}), 502

    data = resp.json()
    answer = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    return jsonify({"ok": True, "answer": answer})


init_db()
start_reminder_worker_once()


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
