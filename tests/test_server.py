"""Server tests: Google sign-in (against a stub token endpoint), access control, accounts, admin actions.

Run: python3 -m unittest discover -s tests
"""
import base64
import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402

CLIENT_ID = "test-client.apps.googleusercontent.com"
NEXT_CLAIMS = {}  # claims the stub token endpoint returns next


def fake_jwt(claims):
    enc = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b"=").decode()
    return enc({"alg": "RS256"}) + "." + enc(claims) + ".sig"


class StubGoogle(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        body = json.dumps({"id_token": fake_jwt(NEXT_CLAIMS)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **kw):
        return None


class Client:
    """A browser stand-in with its own cookie jar."""

    def __init__(self, base):
        self.base = base
        self.jar = {}
        self.opener = urllib.request.build_opener(NoRedirect)

    def req(self, method, path, body=None, csrf=True, headers=None):
        h = dict(headers or {})
        if self.jar:
            h["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.jar.items())
        if csrf and method != "GET":
            h["X-Requested-With"] = "tour-schedule"
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        r = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            resp = self.opener.open(r)
        except urllib.error.HTTPError as e:
            resp = e
        for c in resp.headers.get_all("Set-Cookie") or []:
            name, _, rest = c.partition("=")
            value = rest.split(";")[0]
            if "Max-Age=0" in c:
                self.jar.pop(name, None)
            else:
                self.jar[name] = value
        raw = resp.read()
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = raw
        return resp.status, payload, resp.headers

    def google_login(self, email, sub=None, **overrides):
        status, _, headers = self.req("GET", "/auth/login")
        assert status == 302, status
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(headers["Location"]).query)
        claims = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "exp": time.time() + 300,
                  "nonce": q["nonce"][0], "email": email, "email_verified": True, "sub": sub or "sub-" + email,
                  "name": email.split("@")[0].title()}
        state = overrides.pop("_state", None) or q["state"][0]
        claims.update(overrides)
        NEXT_CLAIMS.clear()
        NEXT_CLAIMS.update(claims)
        status, _, headers = self.req("GET", "/auth/callback?" + urllib.parse.urlencode({"code": "c", "state": state}))
        return headers["Location"]


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stub = ThreadingHTTPServer(("127.0.0.1", 0), StubGoogle)
        threading.Thread(target=cls.stub.serve_forever, daemon=True).start()
        cls.tmp = tempfile.mkdtemp()
        env = {"GOOGLE_CLIENT_ID": CLIENT_ID, "GOOGLE_CLIENT_SECRET": "s", "ADMIN_EMAILS": "chief@example.org",
               "ALLOWED_DOMAINS": "example.org", "GOOGLE_TOKEN_URL": f"http://127.0.0.1:{cls.stub.server_port}/token"}
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), None)
        port = httpd.server_port
        cfg = server.Config(env, "127.0.0.1", port)
        cls.app = server.App(os.path.join(cls.tmp, "t.db"), cfg)
        httpd.RequestHandlerClass = server.make_handler(cls.app)
        cls.httpd = httpd
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.stub.shutdown()

    def client(self):
        return Client(self.base)

    # ---------- sign-in ----------
    def test_rejected_tokens(self):
        cases = {"aud": {"aud": "someone-else"}, "iss": {"iss": "https://evil.example"},
                 "unverified": {"email_verified": False}, "nonce": {"nonce": "wrong"}, "expired": {"exp": 1}}
        for label, override in cases.items():
            with self.subTest(label):
                c = self.client()
                self.assertEqual(c.google_login(f"{label}@example.org", **override), "/?auth_error=google")
                self.assertNotIn("ts_session", c.jar)
        c = self.client()
        self.assertEqual(c.google_login("someone@gmail.com"), "/?auth_error=domain")
        c = self.client()
        self.assertEqual(c.google_login("x@example.org", _state="tampered"), "/?auth_error=state")

    def test_signup_pending_and_session_hash(self):
        c = self.client()
        self.assertEqual(c.google_login("newbie@example.org"), "/")
        token = c.jar["ts_session"]
        _, me, _ = c.req("GET", "/api/me")
        self.assertEqual((me["status"], me["role"]), ("pending", "member"))
        rows = self.app.all("SELECT token_hash FROM sessions")
        self.assertNotIn(token, [r["token_hash"] for r in rows])
        self.assertIn(server.hash_token(token), [r["token_hash"] for r in rows])

    def test_gating(self):
        anon = self.client()
        for path in ("/data/positions.json", "/api/records", "/api/contacts", "/api/admin/users"):
            self.assertEqual(anon.req("GET", path)[0], 401, path)
        self.assertEqual(anon.req("GET", "/")[0], 200)
        self.assertEqual(anon.req("GET", "/server.py")[0], 404)
        p = self.client()
        p.google_login("pending@example.org")
        for path in ("/data/positions.json", "/api/records", "/api/contacts"):
            self.assertEqual(p.req("GET", path)[0], 403, path)
        self.assertEqual(p.req("GET", "/api/roster-names")[0], 200)

    def test_flow_claim_approve_contact_roles(self):
        admin = self.client()
        admin.google_login("chief@example.org")
        _, me, _ = admin.req("GET", "/api/me")
        self.assertEqual((me["role"], me["status"]), ("admin", "active"))

        a = self.client()
        a.google_login("pereira@example.org")
        self.assertEqual(a.req("POST", "/api/me/claim", {"pos": "02BO207M"}, csrf=False)[0], 403)
        st, me, _ = a.req("POST", "/api/me/claim", {"pos": "02BO207M", "note": "BC B02"})
        self.assertEqual((st, me["claimPos"], me["claimName"]), (200, "02BO207M", "Pereira,J"))

        _, users, _ = admin.req("GET", "/api/admin/users")
        uid = next(u["id"] for u in users if u["googleEmail"] == "pereira@example.org")
        st, u, _ = admin.req("POST", f"/api/admin/users/{uid}", {"action": "approve"})
        self.assertEqual((st, u["status"], u["pos"]), (200, "active", "02BO207M"))
        self.assertEqual(a.req("GET", "/data/positions.json")[0], 200)

        # someone else can't claim or be linked to a taken position
        b = self.client()
        b.google_login("other@example.org")
        self.assertEqual(b.req("POST", "/api/me/claim", {"pos": "02BO207M"})[0], 409)
        _, users, _ = admin.req("GET", "/api/admin/users")
        bid = next(u["id"] for u in users if u["googleEmail"] == "other@example.org")
        self.assertEqual(admin.req("POST", f"/api/admin/users/{bid}", {"action": "link", "pos": "02BO207M"})[0], 409)
        admin.req("POST", f"/api/admin/users/{bid}", {"action": "approve"})

        # contact info and sharing
        self.assertEqual(a.req("PUT", "/api/me/contact", {"contactEmail": "nope", "phoneMobile": "", "phoneOther": "", "shareContact": True})[0], 400)
        self.assertEqual(a.req("PUT", "/api/me/contact", {"contactEmail": "", "phoneMobile": "call me", "phoneOther": "", "shareContact": True})[0], 400)
        st, me, _ = a.req("PUT", "/api/me/contact", {"contactEmail": "jp@example.org", "phoneMobile": "(415) 555-0100",
                                                     "phoneOther": "415.555.0101 x12", "shareContact": False})
        self.assertEqual((st, me["contactEmail"], me["shareContact"]), (200, "jp@example.org", False))
        self.assertNotIn("02BO207M", b.req("GET", "/api/contacts")[1])
        self.assertIn("02BO207M", admin.req("GET", "/api/contacts")[1])
        a.req("PUT", "/api/me/contact", {"contactEmail": "jp2@example.org", "phoneMobile": "(415) 555-0100", "phoneOther": "", "shareContact": True})
        self.assertEqual(b.req("GET", "/api/contacts")[1]["02BO207M"]["email"], "jp2@example.org")

        # members can't write schedule records or use admin routes
        rec = {"pos": "02BO207M", "code": "VA", "start": "2026-10-14"}
        self.assertEqual(a.req("POST", "/api/statuses", rec)[0], 403)
        self.assertEqual(a.req("GET", "/api/admin/users")[0], 403)
        admin.req("POST", f"/api/admin/users/{u['id']}", {"action": "role", "role": "editor"})
        st, created, _ = a.req("POST", "/api/statuses", rec)
        self.assertEqual((st, created["createdBy"]), (201, "Pereira"))
        self.assertEqual(a.req("DELETE", f"/api/statuses/{created['id']}", csrf=False)[0], 403)
        self.assertEqual(a.req("DELETE", f"/api/statuses/{created['id']}")[0], 200)
        self.assertEqual(a.req("POST", "/api/statuses", rec, headers={"Origin": "https://evil.example"})[0], 403)

        # disabling ends sessions; the only admin can't be demoted or disabled
        admin.req("POST", f"/api/admin/users/{bid}", {"action": "disable"})
        self.assertEqual(b.req("GET", "/api/me")[1]["signedIn"], False)
        self.assertEqual(b.google_login("other@example.org"), "/?auth_error=disabled")
        _, me, _ = admin.req("GET", "/api/me")
        self.assertEqual(admin.req("POST", f"/api/admin/users/{me['id']}", {"action": "role", "role": "member"})[0], 409)
        self.assertEqual(admin.req("POST", f"/api/admin/users/{me['id']}", {"action": "disable"})[0], 409)

        # logout
        self.assertEqual(a.req("POST", "/auth/logout")[0], 200)
        self.assertEqual(a.req("GET", "/api/me")[1]["signedIn"], False)
        self.assertGreater(len(self.app.all("SELECT * FROM audit")), 5)


if __name__ == "__main__":
    unittest.main()
