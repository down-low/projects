#!/usr/bin/env python3
"""Tour Schedule server: Google sign-in, user accounts, tour changes and work statuses in SQLite.

Usage:
    GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... BASE_URL=https://schedule.example.org \\
    ADMIN_EMAILS=chief@example.org python3 server.py [--port 8000] [--host 127.0.0.1] [--db data/schedule.db]

Environment:
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  OAuth "Web application" client from Google Cloud Console
    BASE_URL         public URL of this server; Google redirects to BASE_URL/auth/callback
    ADMIN_EMAILS     comma-separated Google emails that become admins when they sign in
    ALLOWED_DOMAINS  optional comma-separated email domains allowed to sign in (e.g. sfgov.org)
    DEV_LOGIN=1      local testing only: /auth/dev?email=... signs in without Google (127.0.0.1 only)

Roles: member (schedule + own page), editor (also records tour changes and leave), admin (also manages users).
New sign-ins are pending until an admin approves their claim to a roster position.
Python standard library only.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/schedule.js": "schedule.js",
          "/store.js": "store.js", "/admin.js": "admin.js", "/style.css": "style.css"}
CODES = {"VA", "D", "S"}
ROLES = ("member", "editor", "admin")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[0-9+()\-. ]{3,25}(\s*(x|ext\.?)\s*\d{1,6})?$", re.I)
MAX_BODY = 16 * 1024
KINDS = {"statuses": "statuses", "tour-changes": "tour_changes", "covers": "covers", "people": "people"}
RANKS = ("Battalion Chief", "Rescue Captain", "Captain", "Lieutenant", "ISS", "FF/Paramedic", "Firefighter",
         "Pilot", "Marine Engineer")
PERSON_PREFIX = "person:"
SESSION_COOKIE = "ts_session"
OAUTH_COOKIE = "ts_oauth"
SESSION_DAYS = 30
CSRF_HEADER = "tour-schedule"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS statuses (
  id TEXT PRIMARY KEY, pos TEXT NOT NULL, name TEXT, code TEXT NOT NULL,
  start TEXT NOT NULL, "end" TEXT, note TEXT, createdAt TEXT NOT NULL, createdBy TEXT
);
CREATE TABLE IF NOT EXISTS tour_changes (
  id TEXT PRIMARY KEY, pos TEXT NOT NULL, name TEXT, tour INTEGER NOT NULL,
  effective TEXT NOT NULL, note TEXT, createdAt TEXT NOT NULL, createdBy TEXT
);
CREATE INDEX IF NOT EXISTS statuses_pos ON statuses(pos);
CREATE INDEX IF NOT EXISTS tour_changes_pos ON tour_changes(pos);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE, google_email TEXT NOT NULL, display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'pending', pos TEXT,
  claim_pos TEXT, claim_note TEXT,
  contact_email TEXT, phone_mobile TEXT, phone_other TEXT, share_contact INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_login TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_pos ON users(pos) WHERE pos IS NOT NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS covers (
  id TEXT PRIMARY KEY, coverKey TEXT NOT NULL, coverName TEXT, targetPos TEXT NOT NULL,
  start TEXT NOT NULL, "end" TEXT, note TEXT, createdAt TEXT NOT NULL, createdBy TEXT
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, rank TEXT NOT NULL, note TEXT, createdAt TEXT NOT NULL, createdBy TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  at TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, detail TEXT
);
"""


class BadRequest(Exception):
    pass


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def valid_date(value, field, required=True):
    if value in (None, ""):
        if required:
            raise BadRequest(f"{field} is required (YYYY-MM-DD)")
        return None
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise BadRequest(f"{field} must be a date in YYYY-MM-DD form")
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        raise BadRequest(f"{field} is not a real date: {value}")
    return value


def clean_text(value, field, limit=500):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise BadRequest(f"{field} must be text")
    return value.strip()[:limit]


def clean_email(value):
    v = clean_text(value, "Contact email", 254)
    if v and not EMAIL_RE.match(v):
        raise BadRequest("Contact email doesn't look like an email address")
    return v or None


def clean_phone(value, field):
    v = clean_text(value, field, 40)
    if v and not PHONE_RE.match(v):
        raise BadRequest(f"{field} can only contain digits, spaces, + - ( ) . and an extension like x123")
    return v or None


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def split_csv(raw):
    return {p.strip().lower() for p in (raw or "").split(",") if p.strip()}


def decode_jwt_claims(token):
    """Claims of a JWT. The signature is not checked: only call this on an id_token received
    directly from Google's token endpoint over HTTPS (Google's docs allow this), never one from a browser."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except (IndexError, ValueError):
        raise BadRequest("Google returned an unreadable sign-in token")


class Config:
    def __init__(self, env, host, port):
        self.client_id = env.get("GOOGLE_CLIENT_ID", "")
        self.client_secret = env.get("GOOGLE_CLIENT_SECRET", "")
        self.base_url = (env.get("BASE_URL") or f"http://{host}:{port}").rstrip("/")
        self.admin_emails = split_csv(env.get("ADMIN_EMAILS"))
        self.allowed_domains = split_csv(env.get("ALLOWED_DOMAINS"))
        self.token_url = env.get("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
        self.dev_login = env.get("DEV_LOGIN") == "1"
        if self.dev_login and host not in ("127.0.0.1", "localhost", "::1"):
            raise SystemExit("DEV_LOGIN only works when the server is bound to 127.0.0.1")
        self.secure = self.base_url.startswith("https://")
        parsed = urllib.parse.urlsplit(self.base_url)
        self.origin = f"{parsed.scheme}://{parsed.netloc}"

    @property
    def google_enabled(self):
        return bool(self.client_id and self.client_secret)

    @property
    def redirect_uri(self):
        return self.base_url + "/auth/callback"


class App:
    def __init__(self, db_path, config):
        self.cfg = config
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        with open(os.path.join(ROOT, "data", "positions.json")) as f:
            self.positions = {p["pos"]: p for p in json.load(f)}

    # ---------- db helpers ----------
    def all(self, sql, params=()):
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params)]

    def one(self, sql, params=()):
        rows = self.all(sql, params)
        return rows[0] if rows else None

    def write(self, sql, params=()):
        with self.lock, self.conn:
            return self.conn.execute(sql, params).rowcount

    def audit(self, actor, action, detail):
        self.write("INSERT INTO audit (at, actor_id, action, detail) VALUES (?,?,?,?)",
                   (now(), actor["id"] if actor else None, action, json.dumps(detail)))

    # ---------- users and sessions ----------
    def sign_in(self, sub, email, name):
        """Create or update the user for a verified Google identity; return (user, error)."""
        email = email.lower()
        is_admin = email in self.cfg.admin_emails
        user = self.one("SELECT * FROM users WHERE google_sub = ?", (sub,))
        if not user:
            uid = uuid.uuid4().hex
            self.write("INSERT INTO users (id, google_sub, google_email, display_name, role, status, created_at, last_login) "
                       "VALUES (?,?,?,?,?,?,?,?)", (uid, sub, email, name, "admin" if is_admin else "member",
                                                     "active" if is_admin else "pending", now(), now()))
            user = self.one("SELECT * FROM users WHERE id = ?", (uid,))
            self.audit(user, "signup", {"email": email})
        else:
            if user["status"] == "disabled":
                return None, "disabled"
            self.write("UPDATE users SET google_email = ?, display_name = ?, last_login = ? WHERE id = ?",
                       (email, name, now(), user["id"]))
            if is_admin and (user["role"] != "admin" or user["status"] != "active"):
                self.write("UPDATE users SET role = 'admin', status = 'active' WHERE id = ?", (user["id"],))
            user = self.one("SELECT * FROM users WHERE id = ?", (user["id"],))
        return user, None

    def new_session(self, user_id):
        token = secrets.token_urlsafe(32)
        self.write("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)",
                   (hash_token(token), user_id, time.time() + SESSION_DAYS * 86400))
        return token

    def session_user(self, token):
        if not token:
            return None
        h = hash_token(token)
        row = self.one("SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?", (h,))
        if not row:
            return None
        if row["expires_at"] < time.time() or row["status"] == "disabled":
            self.write("DELETE FROM sessions WHERE token_hash = ?", (h,))
            return None
        if row["expires_at"] - time.time() < (SESSION_DAYS - 1) * 86400:  # slide at most once a day
            self.write("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", (time.time() + SESSION_DAYS * 86400, h))
        row.pop("expires_at")
        return row

    def end_session(self, token):
        if token:
            self.write("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))

    def lookup(self, key):
        """A roster position, or an added person ("person:<id>") shaped like one; None if unknown."""
        if not key:
            return None
        if key.startswith(PERSON_PREFIX):
            row = self.one("SELECT * FROM people WHERE id = ?", (key[len(PERSON_PREFIX):],))
            return row and {"pos": key, "name": row["name"], "title": row["rank"] + " (added)"}
        return self.positions.get(key)

    def me_json(self, u):
        pos = self.lookup(u["pos"])
        claim = self.lookup(u["claim_pos"])
        return {
            "signedIn": True, "id": u["id"], "name": u["display_name"], "googleEmail": u["google_email"],
            "role": u["role"], "status": u["status"], "pos": u["pos"], "posName": pos and pos.get("name"),
            "claimPos": u["claim_pos"], "claimName": claim and claim.get("name"), "claimNote": u["claim_note"],
            "contactEmail": u["contact_email"], "phoneMobile": u["phone_mobile"], "phoneOther": u["phone_other"],
            "shareContact": bool(u["share_contact"]),
        }

    def claim(self, u, body):
        pos = body.get("pos")
        entry = self.lookup(pos) if isinstance(pos, str) else None
        if not entry or not entry.get("name"):
            raise BadRequest("Pick your name from the roster")
        if self.one("SELECT id FROM users WHERE pos = ? AND id != ?", (pos, u["id"])):
            raise HttpError(409, "That roster entry is already linked to another account. Ask an admin for help.")
        note = clean_text(body.get("note"), "Note", 300)
        self.write("UPDATE users SET claim_pos = ?, claim_note = ? WHERE id = ?", (pos, note, u["id"]))
        self.audit(u, "claim", {"pos": pos})

    def save_contact(self, u, body):
        share = body.get("shareContact")
        if not isinstance(share, bool):
            raise BadRequest("shareContact must be true or false")
        vals = (clean_email(body.get("contactEmail")), clean_phone(body.get("phoneMobile"), "Mobile phone"),
                clean_phone(body.get("phoneOther"), "Other phone"), 1 if share else 0, u["id"])
        self.write("UPDATE users SET contact_email = ?, phone_mobile = ?, phone_other = ?, share_contact = ? WHERE id = ?", vals)

    def contacts(self, viewer):
        rows = self.all("SELECT pos, display_name, google_email, contact_email, phone_mobile, phone_other, share_contact "
                        "FROM users WHERE pos IS NOT NULL AND status = 'active'" +
                        ("" if viewer["role"] == "admin" else " AND share_contact = 1"))
        return {r["pos"]: {"email": r["contact_email"], "phoneMobile": r["phone_mobile"], "phoneOther": r["phone_other"],
                           "shared": bool(r["share_contact"])} for r in rows}

    def roster_names(self):
        taken = {r["pos"] for r in self.all("SELECT pos FROM users WHERE pos IS NOT NULL")}
        out = [{"pos": p["pos"], "name": p["name"], "title": p["title"]}
               for p in self.positions.values() if p.get("name") and p["pos"] not in taken]
        out += [{"pos": PERSON_PREFIX + r["id"], "name": r["name"], "title": r["rank"] + " (added)"}
                for r in self.all("SELECT * FROM people") if PERSON_PREFIX + r["id"] not in taken]
        return out

    # ---------- admin ----------
    def admin_users(self):
        rows = self.all("SELECT * FROM users ORDER BY (status = 'pending' AND claim_pos IS NOT NULL) DESC, status, display_name")
        out = []
        for r in rows:
            j = self.me_json(r)
            j.update({"createdAt": r["created_at"], "lastLogin": r["last_login"]})
            out.append(j)
        return out

    def active_admins(self):
        return self.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'")["n"]

    def admin_action(self, actor, user_id, body):
        target = self.one("SELECT * FROM users WHERE id = ?", (user_id,))
        if not target:
            raise HttpError(404, "No such user")
        action = body.get("action")
        last_admin = target["role"] == "admin" and target["status"] == "active" and self.active_admins() <= 1
        if action == "approve":
            pos = target["claim_pos"]
            if pos and self.one("SELECT id FROM users WHERE pos = ? AND id != ?", (pos, user_id)):
                raise HttpError(409, "That roster entry is already linked to another account")
            if pos:
                self.write("UPDATE users SET pos = ?, claim_pos = NULL, claim_note = NULL, status = 'active' WHERE id = ?", (pos, user_id))
            else:
                self.write("UPDATE users SET status = 'active' WHERE id = ?", (user_id,))
        elif action == "reject":
            self.write("UPDATE users SET claim_pos = NULL, claim_note = NULL WHERE id = ?", (user_id,))
        elif action == "role":
            role = body.get("role")
            if role not in ROLES:
                raise BadRequest("role must be member, editor or admin")
            if last_admin and role != "admin":
                raise HttpError(409, "Make someone else an admin first. There must always be at least one admin.")
            self.write("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        elif action == "link":
            pos = body.get("pos")
            if not isinstance(pos, str) or not self.lookup(pos):
                raise BadRequest("pos must be a position number from the vacancy list or an added person")
            if self.one("SELECT id FROM users WHERE pos = ? AND id != ?", (pos, user_id)):
                raise HttpError(409, "That roster entry is already linked to another account")
            self.write("UPDATE users SET pos = ?, claim_pos = NULL, claim_note = NULL WHERE id = ?", (pos, user_id))
        elif action == "unlink":
            self.write("UPDATE users SET pos = NULL WHERE id = ?", (user_id,))
        elif action == "disable":
            if last_admin:
                raise HttpError(409, "You can't disable the only admin.")
            self.write("UPDATE users SET status = 'disabled' WHERE id = ?", (user_id,))
            self.write("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        elif action == "enable":
            self.write("UPDATE users SET status = 'active' WHERE id = ?", (user_id,))
        else:
            raise BadRequest("Unknown action")
        detail = {k: body[k] for k in ("role", "pos") if k in body}
        detail.update({"user": user_id, "email": target["google_email"]})
        self.audit(actor, action, detail)
        return self.me_json(self.one("SELECT * FROM users WHERE id = ?", (user_id,)))

    # ---------- schedule records ----------
    def records(self):
        return {"statuses": self.all('SELECT * FROM statuses ORDER BY start, createdAt'),
                "tourChanges": self.all('SELECT * FROM tour_changes ORDER BY effective, createdAt'),
                "covers": self.all('SELECT * FROM covers ORDER BY start, createdAt'),
                "people": self.all('SELECT * FROM people ORDER BY name')}

    def _position(self, body):
        pos = body.get("pos")
        if pos not in self.positions:
            raise BadRequest("pos must be a position number from the vacancy list")
        return pos, self.positions[pos].get("name") or ""

    def _person_or_position(self, key, field="pos"):
        entry = self.lookup(key) if isinstance(key, str) else None
        if not entry:
            raise BadRequest(f"{field} must be a position number from the vacancy list or an added person")
        return key, entry.get("name") or ""

    def add_status(self, body, who):
        pos, name = self._person_or_position(body.get("pos"))
        code = body.get("code")
        if code not in CODES:
            raise BadRequest("code must be VA, D or S")
        start = valid_date(body.get("start"), "start")
        end = valid_date(body.get("end"), "end", required=False)
        if end and end < start:
            raise BadRequest("end must be on or after start")
        rec = {"id": uuid.uuid4().hex, "pos": pos, "name": name, "code": code, "start": start, "end": end,
               "note": clean_text(body.get("note"), "note"), "createdAt": now(), "createdBy": who}
        self.write('INSERT INTO statuses (id,pos,name,code,start,"end",note,createdAt,createdBy) '
                   'VALUES (:id,:pos,:name,:code,:start,:end,:note,:createdAt,:createdBy)', rec)
        return rec

    def add_tour_change(self, body, who):
        pos, name = self._position(body)
        tour = body.get("tour")
        if not isinstance(tour, int) or isinstance(tour, bool) or not 1 <= tour <= 31:
            raise BadRequest("tour must be a whole number from 1 to 31")
        rec = {"id": uuid.uuid4().hex, "pos": pos, "name": name, "tour": tour,
               "effective": valid_date(body.get("effective"), "effective"),
               "note": clean_text(body.get("note"), "note"), "createdAt": now(), "createdBy": who}
        self.write('INSERT INTO tour_changes (id,pos,name,tour,effective,note,createdAt,createdBy) '
                   'VALUES (:id,:pos,:name,:tour,:effective,:note,:createdAt,:createdBy)', rec)
        return rec

    def add_cover(self, body, who):
        key, cover_name = self._person_or_position(body.get("coverKey"), "coverKey")
        target = body.get("targetPos")
        if target not in self.positions:
            raise BadRequest("targetPos must be a position number from the vacancy list")
        if target == key:
            raise BadRequest("Someone can't cover their own position")
        start = valid_date(body.get("start"), "start")
        end = valid_date(body.get("end"), "end", required=False)
        if end and end < start:
            raise BadRequest("end must be on or after start")
        rec = {"id": uuid.uuid4().hex, "coverKey": key, "coverName": cover_name, "targetPos": target, "start": start,
               "end": end, "note": clean_text(body.get("note"), "note"), "createdAt": now(), "createdBy": who}
        self.write('INSERT INTO covers (id,coverKey,coverName,targetPos,start,"end",note,createdAt,createdBy) '
                   'VALUES (:id,:coverKey,:coverName,:targetPos,:start,:end,:note,:createdAt,:createdBy)', rec)
        return rec

    def end_cover(self, rec_id, body):
        row = self.one("SELECT * FROM covers WHERE id = ?", (rec_id,))
        if not row:
            raise HttpError(404, "No such cover assignment")
        end = valid_date(body.get("end"), "end")
        if end < row["start"]:
            raise BadRequest("end must be on or after the cover's start date")
        self.write('UPDATE covers SET "end" = ? WHERE id = ?', (end, rec_id))
        return self.one("SELECT * FROM covers WHERE id = ?", (rec_id,))

    def add_person(self, body, who):
        name = clean_text(body.get("name"), "name", 80)
        if len(name) < 2:
            raise BadRequest("Enter the person's name (Last,First initial works best, e.g. Lester,D)")
        rank = body.get("rank")
        if rank not in RANKS:
            raise BadRequest("rank must be one of: " + ", ".join(RANKS))
        rec = {"id": uuid.uuid4().hex, "name": name, "rank": rank, "note": clean_text(body.get("note"), "note"),
               "createdAt": now(), "createdBy": who}
        self.write("INSERT INTO people (id,name,rank,note,createdAt,createdBy) VALUES (:id,:name,:rank,:note,:createdAt,:createdBy)", rec)
        return rec

    def delete(self, kind, rec_id):
        table = KINDS[kind]  # fixed allowlist, never user text
        if kind == "people":
            key = PERSON_PREFIX + rec_id
            if self.one("SELECT id FROM users WHERE pos = ? OR claim_pos = ?", (key, key)):
                raise HttpError(409, "This person is linked to a sign-in account. Unlink them on the Admin page first.")
            with self.lock, self.conn:
                self.conn.execute("DELETE FROM covers WHERE coverKey = ?", (key,))
                self.conn.execute("DELETE FROM statuses WHERE pos = ?", (key,))
        return self.write(f"DELETE FROM {table} WHERE id = ?", (rec_id,)) > 0

    # ---------- Google ----------
    def exchange_code(self, code):
        data = urllib.parse.urlencode({
            "code": code, "client_id": self.cfg.client_id, "client_secret": self.cfg.client_secret,
            "redirect_uri": self.cfg.redirect_uri, "grant_type": "authorization_code",
        }).encode()
        req = urllib.request.Request(self.cfg.token_url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                tok = json.load(r)
        except (urllib.error.URLError, ValueError) as e:
            raise BadRequest(f"Could not reach Google to finish sign-in ({e})")
        if "id_token" not in tok:
            raise BadRequest("Google did not return an identity token")
        return decode_jwt_claims(tok["id_token"])

    def check_claims(self, c, nonce):
        if c.get("iss") not in GOOGLE_ISSUERS:
            raise BadRequest("Sign-in token was not issued by Google")
        if c.get("aud") != self.cfg.client_id:
            raise BadRequest("Sign-in token was issued for a different app")
        if not isinstance(c.get("exp"), (int, float)) or c["exp"] < time.time():
            raise BadRequest("Sign-in token has expired")
        if not nonce or c.get("nonce") != nonce:
            raise BadRequest("Sign-in could not be verified (nonce mismatch). Try again.")
        if c.get("email_verified") is not True or not c.get("email") or not c.get("sub"):
            raise BadRequest("Your Google account email is not verified")
        domain = c["email"].rsplit("@", 1)[-1].lower()
        if self.cfg.allowed_domains and domain not in self.cfg.allowed_domains:
            raise HttpError(403, "domain")
        return c


def make_handler(app):
    cfg = app.cfg

    class Handler(SimpleHTTPRequestHandler):
        server_version = "TourSchedule/2.0"

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=ROOT, **kw)

        # ---------- responses ----------
        def send_json(self, status, payload, cookies=()):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            for c in cookies:
                self.send_header("Set-Cookie", c)
            self.end_headers()
            self.wfile.write(body)

        def redirect(self, location, cookies=()):
            self.send_response(302)
            self.send_header("Location", location)
            self.send_header("Cache-Control", "no-store")
            for c in cookies:
                self.send_header("Set-Cookie", c)
            self.end_headers()

        def end_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "same-origin")
            self.send_header("X-Frame-Options", "DENY")
            super().end_headers()

        def cookie(self, name, value, max_age, path="/"):
            parts = [f"{name}={value}", f"Path={path}", f"Max-Age={max_age}", "HttpOnly", "SameSite=Lax"]
            if cfg.secure:
                parts.append("Secure")
            return "; ".join(parts)

        # ---------- request helpers ----------
        def path_only(self):
            return urllib.parse.urlsplit(self.path).path

        def query(self):
            return urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)

        def cookies(self):
            c = SimpleCookie()
            try:
                c.load(self.headers.get("Cookie") or "")
            except Exception:
                return {}
            return {k: m.value for k, m in c.items()}

        def user(self):
            return app.session_user(self.cookies().get(SESSION_COOKIE))

        def body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                raise BadRequest("Request body is missing or too large")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise BadRequest("Request body must be a JSON object")
            return data

        def require(self, level):
            """level: 'signed-in' | 'active' | 'editor' | 'admin'. Raises HttpError when not allowed."""
            u = self.user()
            if not u:
                raise HttpError(401, "Sign in to continue")
            if level == "signed-in":
                return u
            if u["status"] != "active":
                raise HttpError(403, "Your account is waiting for an admin to approve it")
            if level == "editor" and u["role"] not in ("editor", "admin"):
                raise HttpError(403, "Only editors can make this change")
            if level == "admin" and u["role"] != "admin":
                raise HttpError(403, "Only admins can do this")
            return u

        def check_csrf(self):
            if self.headers.get("X-Requested-With") != CSRF_HEADER:
                raise HttpError(403, "Missing request header")
            origin = self.headers.get("Origin")
            if origin and origin != cfg.origin:
                raise HttpError(403, "Request came from another site")

        def run(self, fn):
            try:
                fn()
            except HttpError as e:
                self.send_json(e.status, {"error": str(e)})
            except (BadRequest, json.JSONDecodeError, ValueError) as e:
                self.send_json(400, {"error": str(e)})

        # ---------- GET ----------
        def do_GET(self):
            self.run(self._get)

        def _get(self):
            path = self.path_only()
            if path == "/api/health":
                return self.send_json(200, {"ok": True, "auth": "google", "google": cfg.google_enabled, "devLogin": cfg.dev_login})
            if path == "/api/me":
                u = self.user()
                return self.send_json(200, app.me_json(u) if u else {"signedIn": False, "google": cfg.google_enabled, "devLogin": cfg.dev_login})
            if path == "/api/records":
                self.require("active")
                return self.send_json(200, app.records())
            if path == "/api/contacts":
                return self.send_json(200, app.contacts(self.require("active")))
            if path == "/api/roster-names":
                self.require("signed-in")
                return self.send_json(200, app.roster_names())
            if path == "/api/admin/users":
                self.require("admin")
                return self.send_json(200, app.admin_users())
            if path == "/data/positions.json":
                self.require("active")
                self.path = "/data/positions.json"
                return super().do_GET()
            if path == "/auth/login":
                return self.auth_login()
            if path == "/auth/callback":
                return self.auth_callback()
            if path == "/auth/dev" and cfg.dev_login:
                return self.auth_dev()
            if path not in PUBLIC:  # only the app's own files are served
                raise HttpError(404, "Not found")
            self.path = "/" + PUBLIC[path]
            return super().do_GET()

        def do_HEAD(self):
            self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

        # ---------- auth ----------
        def auth_login(self):
            if not cfg.google_enabled:
                return self.redirect("/?auth_error=not_configured")
            state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
            params = urllib.parse.urlencode({
                "client_id": cfg.client_id, "redirect_uri": cfg.redirect_uri, "response_type": "code",
                "scope": "openid email profile", "state": state, "nonce": nonce, "prompt": "select_account",
            })
            self.redirect(GOOGLE_AUTH_URL + "?" + params, [self.cookie(OAUTH_COOKIE, state + "." + nonce, 600, "/auth")])

        def auth_callback(self):
            q = self.query()
            clear = self.cookie(OAUTH_COOKIE, "", 0, "/auth")
            saved = self.cookies().get(OAUTH_COOKIE, "")
            state, _, nonce = saved.partition(".")
            if "error" in q:
                return self.redirect("/?auth_error=cancelled", [clear])
            if not state or not secrets.compare_digest(q.get("state", [""])[0], state):
                return self.redirect("/?auth_error=state", [clear])
            try:
                claims = app.check_claims(app.exchange_code(q.get("code", [""])[0]), nonce)
            except HttpError:
                return self.redirect("/?auth_error=domain", [clear])
            except BadRequest as e:
                print(f"sign-in failed: {e}", file=sys.stderr)
                return self.redirect("/?auth_error=google", [clear])
            self.finish_sign_in(claims["sub"], claims["email"], claims.get("name") or claims["email"], [clear])

        def auth_dev(self):
            email = (self.query().get("email") or [""])[0].strip().lower()
            if not EMAIL_RE.match(email):
                raise BadRequest("email is required")
            name = (self.query().get("name") or [email.split("@")[0]])[0]
            self.finish_sign_in("dev:" + email, email, name, [])

        def finish_sign_in(self, sub, email, name, cookies):
            user, err = app.sign_in(sub, email, name)
            if err:
                return self.redirect("/?auth_error=" + err, cookies)
            token = app.new_session(user["id"])
            self.redirect("/", list(cookies) + [self.cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400)])

        # ---------- writes ----------
        def do_POST(self):
            self.run(self._post)

        def _post(self):
            self.check_csrf()
            path = self.path_only()
            if path == "/auth/logout":
                app.end_session(self.cookies().get(SESSION_COOKIE))
                return self.send_json(200, {"signedIn": False}, [self.cookie(SESSION_COOKIE, "", 0)])
            if path == "/api/me/claim":
                u = self.require("signed-in")
                if u["status"] != "pending":
                    raise HttpError(409, "Your account is already set up. Ask an admin to change your roster link.")
                app.claim(u, self.body())
                return self.send_json(200, app.me_json(self.user()))
            adders = {"/api/statuses": app.add_status, "/api/tour-changes": app.add_tour_change,
                      "/api/covers": app.add_cover, "/api/people": app.add_person}
            if path in adders:
                u = self.require("editor")
                rec = adders[path](self.body(), u["display_name"] or u["google_email"])
                app.audit(u, "add " + path.rsplit("/", 1)[1], {"id": rec["id"]})
                return self.send_json(201, rec)
            m = re.fullmatch(r"/api/admin/users/([0-9a-f]{32})", path)
            if m:
                u = self.require("admin")
                return self.send_json(200, app.admin_action(u, m.group(1), self.body()))
            raise HttpError(404, "Not found")

        def do_PATCH(self):
            self.run(self._patch)

        def _patch(self):
            self.check_csrf()
            m = re.fullmatch(r"/api/covers/([0-9a-f]{32})", self.path_only())
            if not m:
                raise HttpError(404, "Not found")
            u = self.require("editor")
            rec = app.end_cover(m.group(1), self.body())
            app.audit(u, "end cover", {"id": m.group(1), "end": rec["end"]})
            return self.send_json(200, rec)

        def do_PUT(self):
            self.run(self._put)

        def _put(self):
            self.check_csrf()
            if self.path_only() != "/api/me/contact":
                raise HttpError(404, "Not found")
            u = self.require("active")
            app.save_contact(u, self.body())
            return self.send_json(200, app.me_json(self.user()))

        def do_DELETE(self):
            self.run(self._delete)

        def _delete(self):
            self.check_csrf()
            m = re.fullmatch(r"/api/(statuses|tour-changes|covers|people)/([0-9a-f]{32})", self.path_only())
            if not m:
                raise HttpError(404, "Not found")
            u = self.require("editor")
            if not app.delete(m.group(1), m.group(2)):
                raise HttpError(404, "No such record")
            app.audit(u, "delete " + m.group(1), {"id": m.group(2)})
            return self.send_json(200, {"deleted": m.group(2)})

        def log_message(self, fmt, *args):
            p = self.path_only()
            if p.startswith("/api/") or p.startswith("/auth/"):
                # never log query strings: the OAuth callback carries a one-time code
                sys.stderr.write("%s - [%s] %s %s\n" % (self.address_string(), self.log_date_time_string(), self.command, p))

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to accept connections from other machines")
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "schedule.db"))
    args = ap.parse_args()
    cfg = Config(os.environ, args.host, args.port)
    if not cfg.google_enabled and not cfg.dev_login:
        print("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set: nobody can sign in. See README.md.")
    if cfg.dev_login:
        print("WARNING: DEV_LOGIN=1 lets anyone on this machine sign in as any email. Never use it in production.")
    if not cfg.admin_emails:
        print("ADMIN_EMAILS is not set: nobody will be able to approve accounts.")
    app = App(args.db, cfg)
    srv = ThreadingHTTPServer((args.host, args.port), make_handler(app))
    print(f"Tour Schedule on {cfg.base_url} (listening on {args.host}:{args.port})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
