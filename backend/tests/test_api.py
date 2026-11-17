"""API regression tests on a disposable SQLite database.

Run from the repository root:  python -m unittest discover -s backend/tests -v
No real notifications, payments or network calls are made.
"""
import os
import secrets
import shutil
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from unittest import mock

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TMP_DIR = tempfile.mkdtemp(prefix="matrix-api-tests-")
TASK_SECRET = secrets.token_hex(16)
os.environ.update({
    "DATABASE_URL": "",
    "REQUIRE_DATABASE_URL": "false",
    "SQLITE_PATH": os.path.join(_TMP_DIR, "test.sqlite"),
    "REMINDER_JOB_ENABLED": "false",
    "TASK_SECRET": TASK_SECRET,
    "APP_SECRET_KEY": secrets.token_hex(16),
    "ADMIN_PASSWORD": "",
    "OPENAI_API_KEY": "",
    "PASSWORD_HASH_ITERATIONS": "100000",
    "BOOKING_START_HOUR": "9",
    "BOOKING_END_HOUR": "21",
    "SLOT_STEP_MINUTES": "60",
    "TRAINING_PRICE_KZT": "75000",
})
for _key in ("PAYMENT_CARD_NUMBER", "PAYMENT_CARD_HOLDER", "PAYMENT_BANK_NAME", "SMTP_HOST",
             "TELEGRAM_BOT_TOKEN", "WHATSAPP_API_URL"):
    os.environ.pop(_key, None)
sys.path.insert(0, BACKEND_DIR)

with mock.patch("dotenv.load_dotenv", return_value=False):
    import app as app_module  # noqa: E402
import db  # noqa: E402

PAYMENT_ENV = {
    "PAYMENT_CARD_NUMBER": "4000000000000002",
    "PAYMENT_CARD_HOLDER": "TEST HOLDER",
    "PAYMENT_BANK_NAME": "Test Bank",
}


def tearDownModule():
    db.close()
    shutil.rmtree(_TMP_DIR, ignore_errors=True)


def future_day(days: int) -> str:
    return (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        app_module.app.config["TESTING"] = True
        app_module.limiter.enabled = False
        self.notify = mock.patch.object(app_module, "send_notifications_async").start()
        mock.patch.object(app_module.requests, "post", side_effect=AssertionError("network disabled")).start()
        mock.patch.object(app_module.smtplib, "SMTP", side_effect=AssertionError("smtp disabled")).start()
        self.addCleanup(mock.patch.stopall)
        self.client = app_module.app.test_client()

    def unique_email(self) -> str:
        return f"user-{secrets.token_hex(6)}@example.com"

    def register(self, email=None, password="Secret123", name="Тест Клиент", remember=True):
        email = email or self.unique_email()
        resp = self.client.post("/api/auth/register", json={
            "name": name, "email": email, "password": password, "remember": remember,
        })
        self.assertEqual(resp.status_code, 201, resp.get_json())
        data = resp.get_json()
        return email, data["token"], data

    @staticmethod
    def auth(token, capability=None):
        headers = {"Authorization": f"Bearer {token}"}
        if capability:
            headers["X-Client-Key"] = capability
        return headers

    def create_order(self, token, kind="consultation", title="Онлайн встреча"):
        with mock.patch.dict(os.environ, PAYMENT_ENV):
            return self.client.post("/api/orders", json={"kind": kind, "title": title}, headers=self.auth(token))

    def review(self, code, action="confirm"):
        return self.client.post(
            f"/api/orders/{code}/review", json={"action": action}, headers={"X-Task-Token": TASK_SECRET}
        )


class HealthAndValidationTests(ApiTestCase):
    def test_health_reports_database_state(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["database"], "ok")
        with mock.patch.object(app_module.db, "ping", return_value=False):
            failed = self.client.get("/api/health")
        self.assertEqual(failed.status_code, 503)
        self.assertFalse(failed.get_json()["ok"])

    def test_malformed_json_shapes_return_400(self):
        _, token, _ = self.register()
        cases = [
            ("/api/bookings", [1], {}),
            ("/api/bookings", {"email": 123}, {}),
            ("/api/orders", [1], self.auth(token)),
            ("/api/orders", {"kind": 5, "title": "Онлайн встреча"}, self.auth(token)),
            ("/api/auth/login", ["x"], {}),
            ("/api/auth/register", {"email": {"a": 1}}, {}),
            ("/api/contact", {"email": 1, "message": "hi"}, {}),
        ]
        for path, body, headers in cases:
            with self.subTest(path=path, body=body):
                resp = self.client.post(path, json=body, headers=headers)
                self.assertEqual(resp.status_code, 400, resp.get_json())
                self.assertFalse(resp.get_json()["ok"])
        raw = self.client.post("/api/bookings", data="{broken", content_type="application/json")
        self.assertEqual(raw.status_code, 400)

    def test_unknown_route_is_json_404(self):
        resp = self.client.get("/api/does-not-exist")
        self.assertEqual(resp.status_code, 404)
        self.assertFalse(resp.get_json()["ok"])

    def test_legacy_fake_payment_endpoints_stay_disabled(self):
        for path in ("/api/payments/verify", "/api/purchases/confirm", "/api/training/enroll"):
            with self.subTest(path=path):
                self.assertEqual(self.client.post(path, json={}).status_code, 410)


class AuthTests(ApiTestCase):
    def test_register_login_and_me(self):
        email, token, data = self.register(name="Анна")
        self.assertTrue(token.startswith("ms_"))
        self.assertEqual(data["account"]["email"], email)
        self.assertFalse(data["account"]["emailVerified"])

        me = self.client.get("/api/auth/me", headers=self.auth(token))
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.get_json()["account"]["name"], "Анна")

        login = self.client.post("/api/auth/login", json={"email": email.upper(), "password": "Secret123"})
        self.assertEqual(login.status_code, 200)
        self.assertNotEqual(login.get_json()["token"], token)

    def test_password_is_stored_hashed(self):
        email, _, _ = self.register(password="Хранение42")
        with db.connect() as conn:
            stored = conn.execute("SELECT password_hash FROM customer_accounts WHERE email=?", (email,)).fetchone()
        self.assertTrue(stored["password_hash"].startswith("pbkdf2_sha256$"))
        self.assertNotIn("Хранение42", stored["password_hash"])

    def test_wrong_or_unknown_credentials_are_rejected(self):
        email, _, _ = self.register()
        wrong = self.client.post("/api/auth/login", json={"email": email, "password": "Wrong1234"})
        unknown = self.client.post("/api/auth/login", json={"email": self.unique_email(), "password": "Secret123"})
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.get_json()["message"], unknown.get_json()["message"])

    def test_registration_rules(self):
        email, _, _ = self.register()
        duplicate = self.client.post("/api/auth/register", json={"name": "Иван", "email": email, "password": "Secret123"})
        self.assertEqual(duplicate.status_code, 409)
        for password in ("short1", "onlyletters", "12345678"):
            with self.subTest(password=password):
                resp = self.client.post("/api/auth/register", json={
                    "name": "Иван", "email": self.unique_email(), "password": password,
                })
                self.assertEqual(resp.status_code, 400)

    def test_forged_or_missing_session_is_rejected(self):
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        forged = self.client.get("/api/auth/me", headers=self.auth("ms_" + secrets.token_urlsafe(32)))
        self.assertEqual(forged.status_code, 401)
        self.assertTrue(forged.get_json()["sessionExpired"])

    def test_short_session_when_not_remembered(self):
        email, _, _ = self.register()
        resp = self.client.post("/api/auth/login", json={"email": email, "password": "Secret123", "remember": False})
        expires = datetime.fromisoformat(resp.get_json()["expiresAt"])
        self.assertLess(expires - datetime.now(), timedelta(hours=13))

    def test_expired_session_is_rejected(self):
        _, token, _ = self.register()
        with db.connect() as conn:
            conn.execute(
                "UPDATE customer_sessions SET expires_at=? WHERE token_hash=?",
                ((datetime.now() - timedelta(minutes=1)).isoformat(), app_module.access_token_hash(token)),
            )
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth(token)).status_code, 401)

    def test_logout_revokes_only_current_session(self):
        email, first, _ = self.register()
        second = self.client.post("/api/auth/login", json={"email": email, "password": "Secret123"}).get_json()["token"]
        self.assertEqual(self.client.post("/api/auth/logout", headers=self.auth(first)).status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth(first)).status_code, 401)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth(second)).status_code, 200)

    def test_logout_all_revokes_every_session(self):
        email, first, _ = self.register()
        second = self.client.post("/api/auth/login", json={"email": email, "password": "Secret123"}).get_json()["token"]
        resp = self.client.post("/api/auth/logout-all", headers=self.auth(first))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["revokedSessions"], 2)
        for token in (first, second):
            self.assertEqual(self.client.get("/api/auth/me", headers=self.auth(token)).status_code, 401)

    def test_password_change(self):
        email, current, _ = self.register()
        other = self.client.post("/api/auth/login", json={"email": email, "password": "Secret123"}).get_json()["token"]

        wrong = self.client.post("/api/auth/password", headers=self.auth(current),
                                 json={"currentPassword": "Nope12345", "newPassword": "Fresh2026"})
        self.assertEqual(wrong.status_code, 400)
        weak = self.client.post("/api/auth/password", headers=self.auth(current),
                                json={"currentPassword": "Secret123", "newPassword": "short"})
        self.assertEqual(weak.status_code, 400)
        unauthenticated = self.client.post("/api/auth/password",
                                           json={"currentPassword": "Secret123", "newPassword": "Fresh2026"})
        self.assertEqual(unauthenticated.status_code, 401)

        ok = self.client.post("/api/auth/password", headers=self.auth(current),
                              json={"currentPassword": "Secret123", "newPassword": "Fresh2026"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.get_json()["revokedSessions"], 1)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth(current)).status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth(other)).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": email, "password": "Secret123"}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": email, "password": "Fresh2026"}).status_code, 200)

    def test_profile_update(self):
        _, token, _ = self.register()
        resp = self.client.post("/api/auth/profile", headers=self.auth(token),
                                json={"name": "Новое Имя", "phone": "+7 700 000 00 00"})
        self.assertEqual(resp.status_code, 200)
        me = self.client.get("/api/auth/me", headers=self.auth(token)).get_json()["account"]
        self.assertEqual((me["name"], me["phone"]), ("Новое Имя", "+7 700 000 00 00"))

    def test_password_recovery_is_honestly_unavailable(self):
        for path in ("/api/auth/password/forgot", "/api/auth/password/reset"):
            with self.subTest(path=path):
                resp = self.client.post(path, json={"email": "a@example.com"})
                self.assertEqual(resp.status_code, 503)
                self.assertFalse(resp.get_json()["recoveryAvailable"])


class MessageTests(ApiTestCase):
    def test_inbox_requires_session_and_does_not_leak_by_email(self):
        victim = self.unique_email()
        with db.connect() as conn:
            conn.execute(
                """
                INSERT INTO client_messages (from_email, to_email, subject, text, sender_role, created_at)
                VALUES ('admin@roza-ogly.local', ?, 'private', 'secret text', 'admin', ?)
                """,
                (victim, datetime.now().isoformat()),
            )
        self.assertEqual(self.client.get(f"/api/messages/inbox?email={victim}").status_code, 401)
        _, token, _ = self.register(email=victim)
        inbox = self.client.get("/api/messages/inbox", headers=self.auth(token)).get_json()
        self.assertEqual(inbox["messages"], [])

        self.assertEqual(self.client.post("/api/messages/reply", json={"text": "hello"}).status_code, 401)
        reply = self.client.post("/api/messages/reply", json={"text": "hello"}, headers=self.auth(token))
        self.assertEqual(reply.status_code, 200)
        inbox = self.client.get("/api/messages/inbox", headers=self.auth(token)).get_json()
        self.assertEqual([m["text"] for m in inbox["messages"]], ["hello"])


class OrderTests(ApiTestCase):
    def test_orders_require_session(self):
        with mock.patch.dict(os.environ, PAYMENT_ENV):
            resp = self.client.post("/api/orders", json={"kind": "consultation", "title": "Онлайн встреча"})
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(self.client.get("/api/orders").status_code, 401)

    def test_missing_payment_details_create_nothing(self):
        email, token, _ = self.register()
        resp = self.client.post("/api/orders", json={"kind": "consultation", "title": "Онлайн встреча"},
                                headers=self.auth(token))
        self.assertEqual(resp.status_code, 503)
        with db.connect() as conn:
            count = conn.execute("SELECT COUNT(*) AS c FROM orders WHERE customer_email=?", (email,)).fetchone()["c"]
        self.assertEqual(count, 0)

    def test_server_price_and_retry_reuse(self):
        _, token, _ = self.register()
        with mock.patch.dict(os.environ, PAYMENT_ENV):
            first = self.client.post("/api/orders", headers=self.auth(token), json={
                "kind": "consultation", "title": "Личная встреча", "amount": 1,
            }).get_json()
        self.assertEqual(first["order"]["amount"], 50000)
        self.assertTrue(first["configured"])
        retry = self.create_order(token, title="Личная встреча").get_json()
        self.assertEqual(retry["order"]["code"], first["order"]["code"])
        self.assertTrue(retry["reused"])

    def test_unknown_product_rejected(self):
        _, token, _ = self.register()
        self.assertEqual(self.create_order(token, title="Бесплатно").status_code, 400)

    def test_repeat_consultation_after_payment_gets_new_order(self):
        _, token, _ = self.register()
        first = self.create_order(token).get_json()["order"]["code"]
        self.assertEqual(self.client.post(f"/api/orders/{first}/paid", json={}, headers=self.auth(token)).status_code, 200)
        self.assertEqual(self.review(first).status_code, 200)
        second = self.create_order(token)
        self.assertEqual(second.status_code, 200)
        self.assertNotEqual(second.get_json()["order"]["code"], first)
        self.assertFalse(second.get_json()["reused"])

    def test_paid_training_cannot_be_bought_twice(self):
        _, token, _ = self.register()
        title = "Программа «Практик Матрицы»"
        code = self.create_order(token, kind="training", title=title).get_json()["order"]["code"]
        self.client.post(f"/api/orders/{code}/paid", json={}, headers=self.auth(token))
        self.assertEqual(self.review(code).status_code, 200)
        again = self.create_order(token, kind="training", title=title)
        self.assertEqual(again.status_code, 409)
        self.assertTrue(again.get_json()["alreadyPaid"])

    def test_review_requires_reported_transfer_and_task_token(self):
        _, token, _ = self.register()
        code = self.create_order(token).get_json()["order"]["code"]
        self.assertEqual(self.review(code).status_code, 409)
        denied = self.client.post(f"/api/orders/{code}/review", json={"action": "confirm"})
        self.assertEqual(denied.status_code, 401)

    def test_orders_are_isolated_between_accounts(self):
        _, owner, _ = self.register()
        _, stranger, _ = self.register()
        code = self.create_order(owner).get_json()["order"]["code"]
        self.assertEqual(self.client.get(f"/api/orders/{code}", headers=self.auth(stranger)).status_code, 404)
        self.assertEqual(
            self.client.post(f"/api/orders/{code}/paid", json={}, headers=self.auth(stranger)).status_code, 404
        )
        self.assertEqual(self.client.get("/api/orders", headers=self.auth(stranger)).get_json()["orders"], [])
        self.assertEqual(len(self.client.get("/api/orders", headers=self.auth(owner)).get_json()["orders"]), 1)

    def test_concurrent_order_creation_yields_single_order(self):
        _, token, _ = self.register()

        def worker(_):
            client = app_module.app.test_client()
            resp = client.post("/api/orders", json={"kind": "consultation", "title": "Онлайн встреча"},
                               headers=self.auth(token))
            return resp.status_code, resp.get_json()["order"]["code"]

        with mock.patch.dict(os.environ, PAYMENT_ENV):
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(worker, range(8)))
        self.assertTrue(all(status == 200 for status, _ in results))
        self.assertEqual(len({code for _, code in results}), 1)


class BookingTests(ApiTestCase):
    def test_account_booking_lifecycle(self):
        _, token, _ = self.register()
        day = future_day(5)
        create = self.client.post("/api/bookings", headers=self.auth(token), json={
            "service": "Матрица судьбы", "date": day, "time": "10:00", "format": "Онлайн",
        })
        self.assertEqual(create.status_code, 200, create.get_json())
        listing = self.client.get("/api/bookings", headers=self.auth(token)).get_json()
        self.assertEqual(len(listing["upcoming"]), 1)
        booking_id = listing["upcoming"][0]["id"]

        _, stranger, _ = self.register()
        self.assertEqual(self.client.get("/api/bookings", headers=self.auth(stranger)).get_json()["upcoming"], [])
        self.assertEqual(
            self.client.post(f"/api/bookings/{booking_id}/cancel", json={}, headers=self.auth(stranger)).status_code, 404
        )
        self.assertEqual(
            self.client.post(f"/api/bookings/{booking_id}/cancel", json={}, headers=self.auth(token)).status_code, 200
        )
        slots = self.client.get(f"/api/bookings/slots?date={day}").get_json()
        self.assertIn("10:00", slots["available"])

    def test_guest_booking_visible_only_with_same_browser_key_and_email(self):
        email = self.unique_email()
        capability = secrets.token_hex(32)
        resp = self.client.post("/api/bookings", json={
            "name": "Гость", "email": email, "service": "Нумерология",
            "date": future_day(6), "time": "11:00", "accessToken": capability,
        })
        self.assertEqual(resp.status_code, 200, resp.get_json())

        _, impostor, _ = self.register(email=email)
        without_key = self.client.get("/api/bookings", headers=self.auth(impostor)).get_json()
        self.assertEqual(without_key["upcoming"], [])
        with_key = self.client.get("/api/bookings", headers=self.auth(impostor, capability)).get_json()
        self.assertEqual(len(with_key["upcoming"]), 1)

    def test_invalid_slots_rejected(self):
        _, token, _ = self.register()
        for date, time in ((future_day(-1), "10:00"), (future_day(7), "10:30"), (future_day(7), "23:00")):
            with self.subTest(date=date, time=time):
                resp = self.client.post("/api/bookings", headers=self.auth(token), json={
                    "service": "Матрица судьбы", "date": date, "time": time,
                })
                self.assertEqual(resp.status_code, 400)

    def test_concurrent_bookings_for_same_slot(self):
        day = future_day(8)

        def worker(index):
            client = app_module.app.test_client()
            return client.post("/api/bookings", json={
                "name": "Клиент", "email": f"race{index}@example.com", "service": "Матрица судьбы",
                "date": day, "time": "12:00", "accessToken": secrets.token_hex(32),
            }).status_code

        with ThreadPoolExecutor(max_workers=8) as pool:
            statuses = list(pool.map(worker, range(8)))
        self.assertEqual(statuses.count(200), 1)
        self.assertEqual(statuses.count(409), 7)


if __name__ == "__main__":
    unittest.main()
