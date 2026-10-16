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
        self.assertEqual(a.req("POST", "/api/statuses", dict(rec, code="WE", note="Admin assignment"))[0], 201)
        self.assertEqual(a.req("POST", "/api/statuses", dict(rec, code="XX"))[0], 400)
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

    def test_covers_and_people(self):
        admin = self.client()
        admin.google_login("chief@example.org")
        m = self.client()
        m.google_login("member2@example.org")
        _, users, _ = admin.req("GET", "/api/admin/users")
        mid = next(u["id"] for u in users if u["googleEmail"] == "member2@example.org")
        admin.req("POST", f"/api/admin/users/{mid}", {"action": "approve"})

        cover = {"coverKey": "10ENL31M", "targetPos": "10EOC03M", "start": "2026-10-14"}
        self.assertEqual(m.req("POST", "/api/covers", cover)[0], 403)
        bad = [dict(cover, targetPos="10ENL31M"), dict(cover, targetPos="NOPE"), dict(cover, coverKey="person:abc"),
               dict(cover, end="2026-10-01"), dict(cover, start="2026-13-01")]
        for b in bad:
            self.assertEqual(admin.req("POST", "/api/covers", b)[0], 400, b)
        st, rec, _ = admin.req("POST", "/api/covers", cover)
        self.assertEqual((st, rec["coverName"], rec["end"]), (201, "Lester,D", None))
        self.assertEqual(admin.req("PATCH", f"/api/covers/{rec['id']}", {"end": "2026-10-01"})[0], 400)
        st, ended, _ = admin.req("PATCH", f"/api/covers/{rec['id']}", {"end": "2026-11-30"})
        self.assertEqual((st, ended["end"]), (200, "2026-11-30"))

        self.assertEqual(admin.req("POST", "/api/people", {"name": "X", "rank": "Captain"})[0], 400)
        self.assertEqual(admin.req("POST", "/api/people", {"name": "Relief,A", "rank": "Chief"})[0], 400)
        taken = json.load(open(os.path.join(server.ROOT, "data", "employee-ids.json")))["ids"]["16EOC12M"]["id"]
        for empl in ("LE123", "1234LE", taken):  # bad format, or already on a roster position
            self.assertEqual(admin.req("POST", "/api/people", {"name": "Relief,A", "rank": "Lieutenant", "emplId": empl})[0], 400, empl)
        st, person, _ = admin.req("POST", "/api/people", {"name": "Relief,A", "rank": "Lieutenant", "emplId": "zz9999"})
        self.assertEqual((st, person["emplId"]), (201, "ZZ9999"))
        self.assertEqual(admin.req("POST", "/api/people", {"name": "Relief,B", "rank": "Lieutenant", "emplId": "ZZ9999"})[0], 400)
        key = "person:" + person["id"]
        st, pc, _ = admin.req("POST", "/api/covers", {"coverKey": key, "targetPos": "10ENL31M", "start": "2026-10-14"})
        self.assertEqual((st, pc["coverName"]), (201, "Relief,A"))
        self.assertEqual(admin.req("POST", "/api/statuses", {"pos": key, "code": "S", "start": "2026-10-20"})[0], 201)
        _, recs, _ = m.req("GET", "/api/records")
        self.assertEqual(len(recs["covers"]), 2)
        self.assertIn("Relief,A", [x["name"] for x in recs["people"]])
        self.assertIn(key, [r["pos"] for r in m.req("GET", "/api/roster-names")[1]])
        self.assertEqual(admin.req("DELETE", f"/api/people/{person['id']}")[0], 200)
        _, recs, _ = m.req("GET", "/api/records")
        self.assertEqual([c["coverKey"] for c in recs["covers"]], ["10ENL31M"])
        self.assertFalse([x for x in recs["statuses"] if x["pos"] == key])


    def test_request_staffing_profiles_docs(self):
        admin = self.client()
        admin.google_login("chief@example.org")
        n = self.client()
        n.google_login("newhire@example.org")
        self.assertEqual(n.req("GET", "/docs/2026-watch-calendar.pdf")[0], 403)
        bad = [{"name": "Smith,J", "rank": "Lieutenant", "company": "E10", "tour": 32},
               {"name": "Smith,J", "rank": "Lieutenant", "company": "X99", "tour": 12},
               {"name": "", "rank": "Lieutenant", "company": "E10", "tour": 12},
               {"name": "Smith,J", "rank": "Lieutenant", "company": "E10"}]
        for b in bad:
            self.assertEqual(n.req("POST", "/api/me/claim", {"request": b})[0], 400, b)
        st, me, _ = n.req("POST", "/api/me/claim", {"request": {"name": "Smith,J", "rank": "Lieutenant", "company": "e10", "tour": 12}})
        self.assertEqual((st, me["claimRequest"]["company"], me["claimRequest"]["tour"]), (200, "E10", 12))
        _, users, _ = admin.req("GET", "/api/admin/users")
        nid = next(u["id"] for u in users if u["googleEmail"] == "newhire@example.org")
        st, u, _ = admin.req("POST", f"/api/admin/users/{nid}", {"action": "approve"})
        self.assertEqual((st, u["status"], u["posName"]), (200, "active", "Smith,J"))
        self.assertTrue(u["pos"].startswith("person:"))
        _, recs, _ = n.req("GET", "/api/records")
        smith = next(x for x in recs["people"] if x["name"] == "Smith,J")
        self.assertEqual((smith["company"], smith["tour"]), ("E10", 12))

        # documents: allowlisted only, PDFs for active users
        st, body, headers = n.req("GET", "/docs/2026-watch-calendar.pdf")
        self.assertEqual((st, headers["Content-Type"], body[:5]), (200, "application/pdf", b"%PDF-"))
        self.assertEqual(n.req("GET", "/docs/secret.pdf")[0], 404)

        # staffing overrides: admin only
        self.assertEqual(n.req("PUT", "/api/staffing/E10", {"required": 5})[0], 403)
        self.assertEqual(admin.req("PUT", "/api/staffing/E10", {"required": 99})[0], 400)
        self.assertEqual(admin.req("PUT", "/api/staffing/ZZ9", {"required": 5})[0], 400)
        self.assertEqual(admin.req("PUT", "/api/staffing/E10", {"required": 5})[0], 200)
        self.assertIn({"company": "E10", "required": 5}, n.req("GET", "/api/records")[1]["staffing"])
        admin.req("PUT", "/api/staffing/E10", {"required": None})
        self.assertEqual(n.req("GET", "/api/records")[1]["staffing"], [])

        # profiles: self or admin, validated, private; stats are averages only
        key = u["pos"]
        self.assertEqual(n.req("PUT", "/api/profiles/10EOC03M", {"birthDate": "1980-01-01"})[0], 403)
        self.assertEqual(n.req("PUT", f"/api/profiles/{key}", {"birthDate": "2020-01-01"})[0], 400)
        self.assertEqual(n.req("PUT", f"/api/profiles/{key}", {"birthDate": "1980-01-01", "hireDate": "1979-01-01"})[0], 400)
        self.assertEqual(n.req("PUT", f"/api/profiles/{key}", {"hireDate": "2999-01-01"})[0], 400)
        self.assertEqual(n.req("PUT", f"/api/profiles/{key}", {"birthDate": "1980-01-01", "hireDate": "2005-01-01"})[0], 200)
        self.assertEqual(admin.req("PUT", "/api/profiles/10EOC03M", {"birthDate": "1970-01-01", "hireDate": "1995-01-01"})[0], 200)
        self.assertEqual(n.req("GET", "/api/admin/profiles")[0], 403)
        self.assertEqual(len(admin.req("GET", "/api/admin/profiles")[1]), 2)
        self.assertEqual(n.req("GET", "/api/me")[1]["profile"]["hireDate"], "2005-01-01")
        st, stats, _ = n.req("GET", "/api/stats?date=2026-10-14")
        self.assertEqual((st, stats["nAge"], stats["nYos"]), (200, 2, 2))
        self.assertAlmostEqual(stats["avgAge"], 51.8, delta=0.1)
        self.assertNotIn("birthDate", json.dumps(stats))


if __name__ == "__main__":
    unittest.main()


class TradeTest(unittest.TestCase):
    """Shift trades: post, reply, pick (cover + TR), swap, cancel, rank groups and who sees what."""
    setUpClass = classmethod(ServerTest.setUpClass.__func__)
    tearDownClass = classmethod(ServerTest.tearDownClass.__func__)
    client = ServerTest.client

    def member(self, email, pos):
        admin = self.client()
        admin.google_login("chief@example.org")
        c = self.client()
        c.google_login(email)
        _, users, _ = admin.req("GET", "/api/admin/users")
        uid = next(u["id"] for u in users if u["googleEmail"] == email)
        admin.req("POST", f"/api/admin/users/{uid}", {"action": "approve"})
        self.assertEqual(admin.req("POST", f"/api/admin/users/{uid}", {"action": "link", "pos": pos})[0], 200)
        return c

    def pick(self, rank, works, off=(), skip=()):
        """A filled position of `rank` that works every day in `works` and is off on every day in `off`."""
        for pos, p in sorted(self.app.positions.items()):
            if p["rank"] == rank and p.get("name") and pos not in skip and all(self.app.seat_on(pos, d) for d in works) \
                    and not any(self.app.seat_on(pos, d) for d in off):
                return pos
        self.fail(f"no {rank} for {works} / {off}")

    def test_trades(self):
        import datetime as dt
        days = [(dt.date.today() + dt.timedelta(days=n)).isoformat() for n in range(5, 40)]
        day = days[0]
        lt = self.pick("Lieutenant", [day])
        swap = next(d for d in days[1:] if not self.app.seat_on(lt, d))
        capt = self.pick("Captain", [swap], off=[day])
        other = self.pick("Lieutenant", [], off=[day], skip={lt})
        ff = self.pick("Firefighter", [], off=[day])
        poster, taker = self.member("lt@example.org", lt), self.member("capt@example.org", capt)
        bystander, firefighter = self.member("lt2@example.org", other), self.member("ff@example.org", ff)

        # a day the poster doesn't work, and an empty audience, are refused
        self.assertEqual(poster.req("POST", "/api/trades", {"date": swap, "audience": {"board": True}})[0], 400)
        self.assertEqual(poster.req("POST", "/api/trades", {"date": day, "audience": {"board": False, "to": []}})[0], 400)
        # sent only to the captain: the other lieutenant doesn't see it
        st, t, _ = poster.req("POST", "/api/trades", {"date": day, "note": "Wedding", "audience": {"board": False, "to": [capt]}})
        self.assertEqual((st, t["status"], t["seatPos"]), (201, "open", lt))
        self.assertEqual([x["id"] for x in taker.req("GET", "/api/trades")[1]["trades"]], [t["id"]])
        self.assertEqual(bystander.req("GET", "/api/trades")[1]["trades"], [])
        self.assertEqual(bystander.req("POST", f"/api/trades/{t['id']}/replies", {"proposal": {"later": True}})[0], 404)
        # widening to the board shows it to eligible officers, never to a firefighter (cross-group)
        poster.req("PATCH", f"/api/trades/{t['id']}", {"audience": {"board": True, "to": []}})
        self.assertEqual(len(bystander.req("GET", "/api/trades")[1]["trades"]), 1)
        self.assertEqual(firefighter.req("GET", "/api/trades")[1]["trades"], [])
        self.assertEqual(firefighter.req("POST", f"/api/trades/{t['id']}/replies", {"proposal": {"later": True}})[0], 404)
        # even when sent to them directly, a firefighter can't take a lieutenant's shift
        poster.req("PATCH", f"/api/trades/{t['id']}", {"audience": {"board": False, "to": [ff]}})
        st, err, _ = firefighter.req("POST", f"/api/trades/{t['id']}/replies", {"proposal": {"later": True}})
        self.assertEqual(st, 400)
        self.assertIn("same rank group", err["error"])

        # the captain proposes a swap; the bystander offers to be paid back later
        st, r1, _ = taker.req("POST", f"/api/trades/{t['id']}/replies", {"proposal": {"swapDate": swap}, "note": "Swap?"})
        self.assertEqual((st, r1["proposal"]), (201, {"swapDate": swap}))
        st, r2, _ = bystander.req("POST", f"/api/trades/{t['id']}/replies", {"proposal": {"later": True}})
        self.assertEqual(st, 201)
        self.assertEqual(len(poster.req("GET", "/api/trades")[1]["replies"]), 2)
        self.assertEqual(len(bystander.req("GET", "/api/trades")[1]["replies"]), 1)  # only their own
        self.assertEqual(taker.req("POST", f"/api/trades/{t['id']}/pick", {"replyId": r1["id"]})[0], 403)

        # picking the swap writes both directions: covers and TR
        st, t2, _ = poster.req("POST", f"/api/trades/{t['id']}/pick", {"replyId": r1["id"]})
        self.assertEqual((st, t2["status"], t2["takerKey"]), (200, "set", capt))
        recs = poster.req("GET", "/api/records")[1]
        covers = {(c["coverKey"], c["targetPos"], c["start"], c["end"]) for c in recs["covers"] if c["tradeId"] == t["id"]}
        self.assertEqual(covers, {(capt, lt, day, day), (lt, capt, swap, swap)})
        trs = {(s["pos"], s["code"], s["start"]) for s in recs["statuses"] if s["tradeId"] == t["id"]}
        self.assertEqual(trs, {(lt, "TR", day), (capt, "TR", swap)})
        self.assertEqual(self.app.seat_on(capt, day), lt)
        self.assertEqual(self.app.status_on(lt, day), "TR")
        # set trades leave the board, and nobody can respond any more
        self.assertEqual(bystander.req("GET", "/api/trades")[1]["trades"], [])
        self.assertEqual(bystander.req("POST", f"/api/trades/{t['id']}/replies", {"proposal": {"later": True}})[0], 409)
        # TR can't be entered by hand
        with self.assertRaises(server.BadRequest):
            self.app.add_status({"pos": lt, "code": "TR", "start": day}, "x")

        # cancelling the set trade removes what it wrote
        self.assertEqual(taker.req("POST", f"/api/trades/{t['id']}/cancel")[0], 403)
        st, t3, _ = poster.req("POST", f"/api/trades/{t['id']}/cancel")
        self.assertEqual((st, t3["status"]), (200, "cancelled"))
        recs = poster.req("GET", "/api/records")[1]
        self.assertFalse([c for c in recs["covers"] if c["tradeId"] == t["id"]])
        self.assertFalse([s for s in recs["statuses"] if s["tradeId"] == t["id"]])
        self.assertIsNone(self.app.seat_on(capt, day))

        # pay back later: one cover and one TR
        st, t4, _ = poster.req("POST", "/api/trades", {"date": day, "audience": {"board": True, "to": []}})
        self.assertEqual(st, 201)
        _, r3, _ = bystander.req("POST", f"/api/trades/{t4['id']}/replies", {"proposal": {"later": True}})
        st, t5, _ = poster.req("POST", f"/api/trades/{t4['id']}/pick", {"replyId": r3["id"]})
        self.assertEqual((st, t5["proposal"]), (200, {"later": True}))
        self.assertEqual(len([c for c in poster.req("GET", "/api/records")[1]["covers"] if c["tradeId"] == t4["id"]]), 1)

        # alerts opt-in is stored on the account
        st, me, _ = taker.req("PUT", "/api/me/alerts", {"text": True, "app": False, "email": True})
        self.assertEqual((st, me["alerts"]), (200, {"text": True, "app": False, "email": True}))

        # an expired trade is closed to responses
        self.app.write("UPDATE trades SET date = '2020-01-01', status = 'open' WHERE id = ?", (t["id"],))
        poster.req("GET", "/api/trades")
        self.assertEqual(self.app.get_trade(t["id"])["status"], "expired")
        self.assertEqual(taker.req("POST", f"/api/trades/{t['id']}/replies", {"proposal": {"later": True}})[0], 409)
