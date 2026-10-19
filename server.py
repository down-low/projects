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
          "/store.js": "store.js", "/admin.js": "admin.js", "/dashboard.js": "dashboard.js", "/organization.js": "organization.js", "/trades.js": "trades.js", "/awards.js": "awards.js", "/corrections.js": "corrections.js", "/card.js": "card.js", "/style.css": "style.css"}
CODES = {"VA", "D", "S", "WE"}  # WE = working elsewhere (e.g. an admin assignment)
TRADED = "TR"  # traded off: written only by a set shift trade, never through /api/statuses
STATUS_CODES = CODES | {TRADED}
ROLES = ("member", "editor", "admin")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[0-9+()\-. ]{3,25}(\s*(x|ext\.?)\s*\d{1,6})?$", re.I)
MAX_BODY = 16 * 1024
KINDS = {"statuses": "statuses", "tour-changes": "tour_changes", "covers": "covers", "people": "people"}
RANKS = ("Battalion Chief", "Rescue Captain", "Captain", "Lieutenant", "ISS", "FF/Paramedic", "Firefighter",
         "Pilot", "Marine Engineer")
PERSON_PREFIX = "person:"
COMPANY_RE = re.compile(r"^[A-Z]{1,3}\d{1,2}$")
EMPL_ID_RE = re.compile(r"^[A-Z]{2}\d{4}$")  # SFFD employee ID, e.g. LE1234
MIGRATIONS = [  # columns added after the first release; applied when missing
    ("users", "claim_request", "TEXT"),
    ("people", "company", "TEXT"),
    ("people", "tour", "INTEGER"),
    ("people", "emplId", "TEXT"),
    ("users", "alert_text", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "alert_app", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "alert_email", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "alert_board", "TEXT NOT NULL DEFAULT 'off'"),
    ("covers", "tradeId", "TEXT"),
    ("statuses", "tradeId", "TEXT"),
    ("covers", "kind", "TEXT"),
    ("covers", "move", "INTEGER"),  # a move to a new owned seat (2027 award or assignment, or set on the employee card)
]
CORRECTION_KINDS = {"seat", "status", "cover", "tour", "id", "cell", "other"}
CORRECTION_STATES = {"applied", "dismissed", "open"}  # open: reopened by an admin
COVER_KINDS = {"acting", "cover", "shadow", "extra"}  # empty: worked out from the two ranks
# Shift trades: who can take whose shift. Ranks not listed trade with their own rank only. Mirrors RANK_GROUPS in schedule.js.
RANK_GROUPS = {"Firefighter": "Firefighter", "FF/Paramedic": "FF/Paramedic", "Lieutenant": "Officer", "Captain": "Officer",
               "Battalion Chief": "Battalion Chief"}
# The 31-day watch cycle, as in schedule.js: 2026-01-01 is watch 16; tour k works watch w when (w - k) mod 31 is one of these.
TOUR_OFFSETS = {0, 3, 6, 10, 13, 16, 20, 23, 26}
# Trade alerts for board posts: none (people browse the board), a daily summary, or each new post.
BOARD_ALERTS = ("off", "daily", "each")
WATCH_BASE = dt.date(2026, 1, 1)
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
CREATE TABLE IF NOT EXISTS staffing (
  company TEXT PRIMARY KEY, required INTEGER NOT NULL, updatedAt TEXT, updatedBy TEXT
);
CREATE TABLE IF NOT EXISTS profiles (
  key TEXT PRIMARY KEY, birthDate TEXT, hireDate TEXT, updatedAt TEXT, updatedBy TEXT
);
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY, posterKey TEXT NOT NULL, posterName TEXT, seatPos TEXT NOT NULL, date TEXT NOT NULL,
  paybackDate TEXT, note TEXT, audience TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  replyId TEXT, takerKey TEXT, proposal TEXT, setAt TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trade_replies (
  id TEXT PRIMARY KEY, tradeId TEXT NOT NULL, takerKey TEXT NOT NULL, takerName TEXT, proposal TEXT NOT NULL,
  swapSeatPos TEXT, note TEXT, createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trade_replies_trade ON trade_replies(tradeId);
CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY, aboutKey TEXT NOT NULL, kind TEXT NOT NULL, details TEXT, note TEXT,
  byId TEXT, byName TEXT, byKey TEXT, state TEXT NOT NULL DEFAULT 'open', reason TEXT,
  handledBy TEXT, handledAt TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roster_overrides (
  pos TEXT PRIMARY KEY, emplId TEXT, name TEXT, rank TEXT, forName TEXT, updatedAt TEXT, updatedBy TEXT
);
CREATE TABLE IF NOT EXISTS staff_cells (
  key TEXT PRIMARY KEY, cell TEXT NOT NULL, updatedAt TEXT, updatedBy TEXT
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
        for table, col, typ in MIGRATIONS:
            cols = {r[1] for r in self.conn.execute(f"PRAGMA table_info({table})")}
            if col not in cols:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
        self.conn.commit()
        with open(os.path.join(ROOT, "data", "positions.json")) as f:
            self.positions = {p["pos"]: p for p in json.load(f)}
        # Roster companies plus the balance report's codes for rescue captains (RC1-RC4).
        self.companies = {p["company"] for p in self.positions.values() if p.get("company")} | {"RC1", "RC2", "RC3", "RC4"}
        with open(os.path.join(ROOT, "data", "required-staffing.json")) as f:  # every apparatus in the Balance report
            self.companies |= set(json.load(f)["apparatus"])
        with open(os.path.join(ROOT, "data", "employee-ids.json")) as f:  # roster position -> employee ID
            for pos, e in json.load(f)["ids"].items():
                if pos in self.positions:
                    self.positions[pos]["emplId"] = e["id"]
        with open(os.path.join(ROOT, "docs", "index.json")) as f:
            self.docs = {d["file"] for d in json.load(f)}
        # The files' name, rank and ID per seat, before employee-card overrides (roster_overrides) are applied.
        self.orig = {pos: {k: p.get(k) for k in ("name", "rank", "emplId")} for pos, p in self.positions.items()}
        self.apply_overrides()

    def apply_overrides(self):
        """Put roster overrides over the files. An override made for one holder (forName) stops applying once a new
        vacancy list puts someone else in the seat, as app.js applyOverrides."""
        rows = {r["pos"]: r for r in self.all("SELECT * FROM roster_overrides")}
        for pos, o0 in self.orig.items():
            p, o = self.positions[pos], rows.get(pos)
            if o and o["forName"] and o["forName"] != o0["name"]:
                o = None
            for k in ("name", "rank", "emplId"):
                p[k] = (o and o[k]) or o0[k]

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
            return row and {"pos": key, "name": row["name"], "title": row["rank"] + (" " + row["company"] if row["company"] else "") + " (added)",
                            "company": row["company"], "tour": row["tour"]}
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
            "claimRequest": json.loads(u["claim_request"]) if u.get("claim_request") else None,
            "profile": self.profile(u["pos"]) if u["pos"] else None,
            "alerts": {"text": bool(u.get("alert_text")), "app": bool(u.get("alert_app")), "email": bool(u.get("alert_email")),
                       "board": u.get("alert_board") or "off"},
        }

    def clean_person_fields(self, body, exclude=None):
        name = clean_text(body.get("name"), "name", 80)
        if len(name) < 2:
            raise BadRequest("Enter the person's name (Last,First initial works best, e.g. Ashgrove,A)")
        rank = body.get("rank")
        if rank not in RANKS:
            raise BadRequest("rank must be one of: " + ", ".join(RANKS))
        company = clean_text(body.get("company"), "company", 6).upper() or None
        if company and (not COMPANY_RE.match(company) or company not in self.companies):
            raise BadRequest("Apparatus must be a company on the roster, like E10 or T01")
        tour = body.get("tour")
        if tour in (None, ""):
            tour = None
        elif not isinstance(tour, int) or isinstance(tour, bool) or not 1 <= tour <= 31:
            raise BadRequest("tour must be a whole number from 1 to 31")
        empl = clean_text(body.get("emplId"), "emplId", 20).upper() or None
        if empl and not EMPL_ID_RE.match(empl):
            raise BadRequest("Employee ID is two letters and four digits, e.g. LE1234")
        if empl and self.empl_id_owner(empl, exclude):
            raise BadRequest("Employee ID " + empl + " is already on " + self.empl_id_owner(empl, exclude))
        return {"name": name, "rank": rank, "company": company, "tour": tour, "emplId": empl,
                "note": clean_text(body.get("note"), "note")}

    def empl_id_owner(self, empl, exclude=None):
        """Name of the roster position or added person that already has this employee ID, or None.
        exclude: a position number or person:<id> to leave out (the one being edited)."""
        for p in self.positions.values():
            if p.get("emplId") == empl and p["pos"] != exclude:
                return p.get("name") or p["pos"]
        row = self.one("SELECT id, name FROM people WHERE emplId = ?", (empl,))
        return row and PERSON_PREFIX + row["id"] != exclude and row["name"] or None

    def claim(self, u, body):
        if isinstance(body.get("request"), dict):
            req = self.clean_person_fields(body["request"])
            if not req["company"] or not req["tour"]:
                raise BadRequest("Pick your apparatus and tour")
            self.write("UPDATE users SET claim_request = ?, claim_pos = NULL, claim_note = NULL WHERE id = ?", (json.dumps(req), u["id"]))
            self.audit(u, "request", req)
            return
        pos = body.get("pos")
        entry = self.lookup(pos) if isinstance(pos, str) else None
        if not entry or not entry.get("name"):
            raise BadRequest("Pick your name from the roster")
        if self.one("SELECT id FROM users WHERE pos = ? AND id != ?", (pos, u["id"])):
            raise HttpError(409, "That roster entry is already linked to another account. Ask an admin for help.")
        note = clean_text(body.get("note"), "Note", 300)
        self.write("UPDATE users SET claim_pos = ?, claim_note = ?, claim_request = NULL WHERE id = ?", (pos, note, u["id"]))
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
        out = {}
        if viewer["role"] == "admin":  # cell numbers from the staff list: admins only, never members
            out = {r["key"]: {"phoneMobile": r["cell"], "shared": False, "staffList": True} for r in self.all("SELECT key, cell FROM staff_cells")}
        out.update({r["pos"]: {"email": r["contact_email"], "phoneMobile": r["phone_mobile"], "phoneOther": r["phone_other"],
                               "shared": bool(r["share_contact"])} for r in rows})
        return out

    def roster_names(self):
        taken = {r["pos"] for r in self.all("SELECT pos FROM users WHERE pos IS NOT NULL")}
        out = [{"pos": p["pos"], "name": p["name"], "title": p["title"]}
               for p in self.positions.values() if p.get("name") and p["pos"] not in taken]
        out += [{"pos": PERSON_PREFIX + r["id"], "name": r["name"], "title": r["rank"] + " (added)"}
                for r in self.all("SELECT * FROM people") if PERSON_PREFIX + r["id"] not in taken]
        return out

    # ---------- admin ----------
    # ---------- corrections (members suggest, admins apply or dismiss) ----------
    def add_correction(self, u, body):
        about = body.get("aboutKey")
        if not isinstance(about, str) or not (about in self.positions or about.startswith(PERSON_PREFIX)):
            raise BadRequest("aboutKey must be a position number or person:<id>")
        kind = body.get("kind")
        if kind not in CORRECTION_KINDS:
            raise BadRequest("kind must be one of " + ", ".join(sorted(CORRECTION_KINDS)))
        details = body.get("details") or {}
        if not isinstance(details, dict) or len(json.dumps(details)) > 2000:
            raise BadRequest("details must be a small object")
        rec = {"id": uuid.uuid4().hex, "aboutKey": about, "kind": kind, "details": json.dumps(details),
               "note": clean_text(body.get("note"), "note"), "byId": u["id"], "byName": u["display_name"] or u["google_email"],
               "byKey": u["pos"], "createdAt": now()}
        self.write("INSERT INTO corrections (id,aboutKey,kind,details,note,byId,byName,byKey,createdAt) "
                   "VALUES (:id,:aboutKey,:kind,:details,:note,:byId,:byName,:byKey,:createdAt)", rec)
        return {"id": rec["id"], "state": "open"}

    def corrections(self):
        out = []
        for r in self.all("SELECT * FROM corrections ORDER BY createdAt DESC"):
            r = dict(r)
            r["details"] = json.loads(r["details"] or "{}")
            out.append(r)
        return out

    def handle_correction(self, u, rec_id, body):
        if not self.one("SELECT id FROM corrections WHERE id = ?", (rec_id,)):
            raise HttpError(404, "No such correction")
        state = body.get("state")
        if state not in CORRECTION_STATES:
            raise BadRequest("state must be applied or dismissed")
        self.write("UPDATE corrections SET state = ?, reason = ?, handledBy = ?, handledAt = ? WHERE id = ?",
                   (state, clean_text(body.get("reason"), "reason"), u["display_name"] or u["google_email"], now(), rec_id))
        r = dict(self.one("SELECT * FROM corrections WHERE id = ?", (rec_id,)))
        r["details"] = json.loads(r["details"] or "{}")
        return r

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
        if action == "approve" and target.get("claim_request") and not target["claim_pos"]:
            req = json.loads(target["claim_request"])
            person = self.add_person(req, actor["display_name"] or actor["google_email"])
            key = PERSON_PREFIX + person["id"]
            self.write("UPDATE users SET pos = ?, claim_request = NULL, status = 'active' WHERE id = ?", (key, user_id))
        elif action == "approve":
            pos = target["claim_pos"]
            if pos and self.one("SELECT id FROM users WHERE pos = ? AND id != ?", (pos, user_id)):
                raise HttpError(409, "That roster entry is already linked to another account")
            if pos:
                self.write("UPDATE users SET pos = ?, claim_pos = NULL, claim_note = NULL, status = 'active' WHERE id = ?", (pos, user_id))
            else:
                self.write("UPDATE users SET status = 'active' WHERE id = ?", (user_id,))
        elif action == "reject":
            self.write("UPDATE users SET claim_pos = NULL, claim_note = NULL, claim_request = NULL WHERE id = ?", (user_id,))
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
                "people": self.all('SELECT * FROM people ORDER BY name'),
                "staffing": self.all('SELECT company, required FROM staffing'),
                "rosterOverrides": [dict(r, id=r["pos"]) for r in self.all("SELECT pos, emplId, name, rank, forName, updatedAt FROM roster_overrides")]}

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

    @staticmethod
    def clean_range(body):
        start = valid_date(body.get("start"), "start")
        end = valid_date(body.get("end"), "end", required=False)
        if end and end < start:
            raise BadRequest("end must be on or after start")
        return start, end

    def clean_status(self, body):
        code = body.get("code")
        if code not in CODES:  # TR comes only from a set trade
            raise BadRequest("code must be VA, D, S or WE")
        start, end = self.clean_range(body)
        return {"code": code, "start": start, "end": end, "note": clean_text(body.get("note"), "note")}

    def clean_tour_change(self, body):
        tour = body.get("tour")
        if not isinstance(tour, int) or isinstance(tour, bool) or not 1 <= tour <= 31:
            raise BadRequest("tour must be a whole number from 1 to 31")
        return {"tour": tour, "effective": valid_date(body.get("effective"), "effective"), "note": clean_text(body.get("note"), "note")}

    def clean_cover(self, body, key):
        target = body.get("targetPos")
        if target not in self.positions:
            raise BadRequest("targetPos must be a position number from the vacancy list")
        if target == key:
            raise BadRequest("Someone can't cover their own position")
        start, end = self.clean_range(body)
        kind = body.get("kind") or None
        if kind is not None and kind not in COVER_KINDS:
            raise BadRequest("kind must be acting, cover, shadow or extra")
        move = body.get("move") or None
        if move is not None and not isinstance(move, (bool, int)):
            raise BadRequest("move must be true or false")
        return {"targetPos": target, "start": start, "end": end, "kind": kind, "move": 1 if move else None,
                "note": clean_text(body.get("note"), "note")}

    def add_status(self, body, who):
        pos, name = self._person_or_position(body.get("pos"))
        rec = dict(self.clean_status(body), id=uuid.uuid4().hex, pos=pos, name=name, createdAt=now(), createdBy=who)
        self.write('INSERT INTO statuses (id,pos,name,code,start,"end",note,createdAt,createdBy) '
                   'VALUES (:id,:pos,:name,:code,:start,:end,:note,:createdAt,:createdBy)', rec)
        return rec

    def add_tour_change(self, body, who):
        pos, name = self._position(body)
        rec = dict(self.clean_tour_change(body), id=uuid.uuid4().hex, pos=pos, name=name, createdAt=now(), createdBy=who)
        self.write('INSERT INTO tour_changes (id,pos,name,tour,effective,note,createdAt,createdBy) '
                   'VALUES (:id,:pos,:name,:tour,:effective,:note,:createdAt,:createdBy)', rec)
        return rec

    def add_cover(self, body, who):
        key, cover_name = self._person_or_position(body.get("coverKey"), "coverKey")
        rec = dict(self.clean_cover(body, key), id=uuid.uuid4().hex, coverKey=key, coverName=cover_name, createdAt=now(), createdBy=who)
        self.write('INSERT INTO covers (id,coverKey,coverName,targetPos,start,"end",kind,move,note,createdAt,createdBy) '
                   'VALUES (:id,:coverKey,:coverName,:targetPos,:start,:end,:kind,:move,:note,:createdAt,:createdBy)', rec)
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
        rec = self.clean_person_fields(body)
        rec.update({"id": uuid.uuid4().hex, "createdAt": now(), "createdBy": who})
        self.write("INSERT INTO people (id,name,rank,company,tour,emplId,note,createdAt,createdBy) "
                   "VALUES (:id,:name,:rank,:company,:tour,:emplId,:note,:createdAt,:createdBy)", rec)
        return rec

    # ---------- employee card (admins) ----------
    def update_record(self, kind, rec_id, body, who):
        """Edit one schedule record in place; the same checks as adding it. Trade records change only through the trade."""
        table = KINDS[kind]  # fixed allowlist, never user text
        row = self.one(f"SELECT * FROM {table} WHERE id = ?", (rec_id,))
        if not row:
            raise HttpError(404, "No such record")
        if row.get("tradeId"):
            raise HttpError(409, "This record comes from a shift trade. Cancel or change the trade instead.")
        merged = dict(row)
        merged.update({k: v for k, v in body.items() if k not in ("id", "createdAt", "createdBy", "tradeId", "pos", "coverKey")})
        if kind == "statuses":
            rec = self.clean_status(merged)
        elif kind == "tour-changes":
            rec = self.clean_tour_change(merged)
        elif kind == "covers":
            rec = self.clean_cover(merged, row["coverKey"])
        else:
            rec = self.clean_person_fields(merged, exclude=PERSON_PREFIX + rec_id)
        cols = ", ".join(f'"{k}" = :{k}' for k in rec)  # keys come from the cleaners, never from the request
        self.write(f"UPDATE {table} SET {cols} WHERE id = :id", dict(rec, id=rec_id))
        return self.one(f"SELECT * FROM {table} WHERE id = ?", (rec_id,))

    def set_override(self, pos, body, who):
        if pos not in self.orig:
            raise BadRequest("Overrides are for positions on the vacancy list; edit an added person's record instead")
        o0 = self.orig[pos]
        name = clean_text(body.get("name"), "name", 80) or None
        if name and len(name) < 2:
            raise BadRequest("Enter the person's name (Last,First initial works best, e.g. Ashgrove,A)")
        rank = body.get("rank") or None
        if rank is not None and rank not in RANKS:
            raise BadRequest("rank must be one of: " + ", ".join(RANKS))
        empl = clean_text(body.get("emplId"), "emplId", 20).upper() or None
        if empl and not EMPL_ID_RE.match(empl):
            raise BadRequest("Employee ID is two letters and four digits, e.g. LE1234")
        if empl and self.empl_id_owner(empl, pos):
            raise BadRequest("Employee ID " + empl + " is already on " + self.empl_id_owner(empl, pos))
        # Keep only what differs from the files.
        name, rank = (name if name != o0["name"] else None), (rank if rank != o0["rank"] else None)
        empl = empl if empl != o0["emplId"] else None
        if not (name or rank or empl):
            self.write("DELETE FROM roster_overrides WHERE pos = ?", (pos,))
            rec = None
        else:
            rec = {"pos": pos, "emplId": empl, "name": name, "rank": rank, "forName": o0["name"], "updatedAt": now(), "updatedBy": who}
            self.write("INSERT INTO roster_overrides (pos, emplId, name, rank, forName, updatedAt, updatedBy) "
                       "VALUES (:pos,:emplId,:name,:rank,:forName,:updatedAt,:updatedBy) ON CONFLICT(pos) DO UPDATE SET "
                       "emplId = excluded.emplId, name = excluded.name, rank = excluded.rank, forName = excluded.forName, "
                       "updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy", rec)
        with self.lock:
            self.apply_overrides()
        return {"pos": pos, "override": rec}

    def set_cell(self, key, body, who):
        if not self.lookup(key):
            raise BadRequest("key must be a position number or person:<id>")
        cell = clean_phone(body.get("cell"), "Cell")
        if not cell:
            self.write("DELETE FROM staff_cells WHERE key = ?", (key,))
        else:
            self.write("INSERT INTO staff_cells (key, cell, updatedAt, updatedBy) VALUES (?,?,?,?) "
                       "ON CONFLICT(key) DO UPDATE SET cell = excluded.cell, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy",
                       (key, cell, now(), who))
        return {"key": key, "set": bool(cell)}

    # ---------- staffing, profiles, stats ----------
    def set_staffing(self, company, body, who):
        if company not in self.companies:
            raise BadRequest("Unknown apparatus")
        req = body.get("required")
        if req is None:
            self.write("DELETE FROM staffing WHERE company = ?", (company,))
            return {"company": company, "required": None}
        if not isinstance(req, int) or isinstance(req, bool) or not 0 <= req <= 30:
            raise BadRequest("required must be a whole number from 0 to 30")
        self.write("INSERT INTO staffing (company, required, updatedAt, updatedBy) VALUES (?,?,?,?) "
                   "ON CONFLICT(company) DO UPDATE SET required = excluded.required, updatedAt = excluded.updatedAt, "
                   "updatedBy = excluded.updatedBy", (company, req, now(), who))
        return {"company": company, "required": req}

    def profile(self, key):
        row = self.one("SELECT birthDate, hireDate FROM profiles WHERE key = ?", (key,))
        return row or {"birthDate": None, "hireDate": None}

    def set_profile(self, key, body, who):
        if not self.lookup(key):
            raise BadRequest("Unknown person")
        birth = valid_date(body.get("birthDate"), "birthDate", required=False)
        hire = valid_date(body.get("hireDate"), "hireDate", required=False)
        today = dt.date.today()
        if birth:
            age = (today - dt.date.fromisoformat(birth)).days / 365.25
            if not 18 <= age <= 80:
                raise BadRequest("Birth date must make the person between 18 and 80 years old")
        if hire and dt.date.fromisoformat(hire) > today:
            raise BadRequest("Hire date can't be in the future")
        if birth and hire and hire <= birth:
            raise BadRequest("Hire date must be after the birth date")
        self.write("INSERT INTO profiles (key, birthDate, hireDate, updatedAt, updatedBy) VALUES (?,?,?,?,?) "
                   "ON CONFLICT(key) DO UPDATE SET birthDate = excluded.birthDate, hireDate = excluded.hireDate, "
                   "updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy", (key, birth, hire, now(), who))
        return {"key": key, "birthDate": birth, "hireDate": hire}

    def stats(self, on):
        """Averages only: individual dates never leave the server except to admins and their owner."""
        on = dt.date.fromisoformat(on) if on else dt.date.today()
        ages, yos = [], []
        for r in self.all("SELECT key, birthDate, hireDate FROM profiles"):
            if not self.lookup(r["key"]):
                continue
            if r["birthDate"]:
                ages.append((on - dt.date.fromisoformat(r["birthDate"])).days / 365.25)
            if r["hireDate"] and dt.date.fromisoformat(r["hireDate"]) <= on:
                yos.append((on - dt.date.fromisoformat(r["hireDate"])).days / 365.25)
        avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
        return {"avgAge": avg(ages), "nAge": len(ages), "avgYos": avg(yos), "nYos": len(yos)}

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

    # ---------- shift trades ----------
    # The schedule math needed to check a trade: a slice of schedule.js (watch, tour, status, covers).
    @staticmethod
    def tour_works(tour, day):
        watch = ((dt.date.fromisoformat(day) - WATCH_BASE).days + 15) % 31 + 1
        return tour is not None and (watch - tour) % 31 in TOUR_OFFSETS

    def effective_tour(self, key, entry, day):
        if key.startswith(PERSON_PREFIX):
            return entry.get("tour")
        row = self.one("SELECT tour FROM tour_changes WHERE pos = ? AND effective <= ? ORDER BY effective DESC, createdAt DESC LIMIT 1",
                       (key, day))
        return row["tour"] if row else entry.get("tour")

    def status_on(self, key, day):
        row = self.one('SELECT code FROM statuses WHERE pos = ? AND start <= ? AND ("end" IS NULL OR "end" >= ?) '
                       "ORDER BY createdAt DESC LIMIT 1", (key, day, day))
        return row and row["code"]

    def seat_on(self, key, day):
        """The seat person `key` works on `day` (their own, or the one they cover), or None when they are off."""
        # A cover (assignment) wins over a move to a new owned seat (2027 award or assignment), as TourMath.coveringOn.
        cover = self.one('SELECT targetPos FROM covers WHERE coverKey = ? AND start <= ? AND ("end" IS NULL OR "end" >= ?) '
                         "ORDER BY (COALESCE(move, 0) = 1 OR note LIKE '2027 award%' OR note LIKE '2027 assignment%') ASC, createdAt DESC LIMIT 1", (key, day, day))
        if cover:
            target = self.lookup(cover["targetPos"])
            ok = target and self.tour_works(self.effective_tour(cover["targetPos"], target, day), day)
            return cover["targetPos"] if ok else None
        entry = self.lookup(key)
        if not entry or not entry.get("tour"):
            return None
        return key if self.tour_works(self.effective_tour(key, entry, day), day) else None

    def rank_of(self, key):
        if key.startswith(PERSON_PREFIX):
            row = self.one("SELECT rank FROM people WHERE id = ?", (key[len(PERSON_PREFIX):],))
            return row and row["rank"]
        return (self.positions.get(key) or {}).get("rank")

    def rank_group(self, key):
        rank = self.rank_of(key)
        return rank and RANK_GROUPS.get(rank, rank)

    def can_take(self, taker, poster, day):
        """Why `taker` can't take `poster`'s shift on `day`, or None when they can."""
        if taker == poster:
            return "You can't take your own shift"
        if self.rank_group(taker) != self.rank_group(poster):
            return "Trades are only between the same rank group (Firefighter, FF/Paramedic, Lieutenant/Captain, Battalion Chief)"
        if self.seat_on(taker, day):
            return "The taker works that day"
        if self.status_on(taker, day):
            return "The taker is on leave or marked off that day"
        return None

    def trade_json(self, row):
        t = dict(row)
        t["audience"] = json.loads(t["audience"])
        t["proposal"] = json.loads(t["proposal"]) if t["proposal"] else None
        return t

    def get_trade(self, trade_id):
        row = self.one("SELECT * FROM trades WHERE id = ?", (trade_id,))
        if not row:
            raise HttpError(404, "No such trade")
        return self.trade_json(row)

    def trade_visible(self, t, me):
        if t["posterKey"] == me or t["takerKey"] == me or me in t["audience"]["to"]:
            return True
        return t["status"] == "open" and t["audience"]["board"] and not self.can_take(me, t["posterKey"], t["date"])

    def trades(self, u):
        """Trades the viewer may see: their own, ones sent to them, board posts they could take (admins see all)."""
        today = dt.date.today().isoformat()
        self.write("UPDATE trades SET status = 'expired' WHERE status = 'open' AND date < ?", (today,))
        me, admin = u["pos"], u["role"] == "admin"
        trades = [t for t in map(self.trade_json, self.all("SELECT * FROM trades ORDER BY date, createdAt"))
                  if admin or me and self.trade_visible(t, me)]
        mine = {t["id"] for t in trades if admin or t["posterKey"] == me}
        replies = []
        for r in self.all("SELECT * FROM trade_replies ORDER BY createdAt"):
            if r["tradeId"] in mine or r["takerKey"] == me:
                r["proposal"] = json.loads(r["proposal"])
                replies.append(r)
        return {"trades": trades, "replies": replies}

    def clean_audience(self, body, poster):
        aud = body.get("audience")
        if not isinstance(aud, dict):
            raise BadRequest("audience is required: {board: true|false, to: [keys]}")
        to = aud.get("to") or []
        if not isinstance(to, list) or len(to) > 2000 or not all(isinstance(k, str) and self.lookup(k) for k in to):
            raise BadRequest("audience.to must list roster positions or added people")
        to = sorted(set(to) - {poster})
        if not aud.get("board") and not to:
            raise BadRequest("Pick at least one person or post it to the board")
        return {"board": bool(aud.get("board")), "to": to}

    def post_trade(self, u, body):
        me = u["pos"]
        day = valid_date(body.get("date"), "date")
        if day < dt.date.today().isoformat():
            raise BadRequest("That day has passed")
        seat = self.seat_on(me, day)
        if not seat or self.status_on(me, day):
            raise BadRequest("You don't work that day")
        if self.one("SELECT id FROM trades WHERE posterKey = ? AND date = ? AND status IN ('open', 'set')", (me, day)):
            raise HttpError(409, "You already have a trade for that day")
        rec = {"id": uuid.uuid4().hex, "posterKey": me, "posterName": (self.lookup(me) or {}).get("name"), "seatPos": seat,
               "date": day, "paybackDate": None, "note": clean_text(body.get("note"), "note"),
               "audience": json.dumps(self.clean_audience(body, me)), "status": "open", "createdAt": now()}
        self.write("INSERT INTO trades (id,posterKey,posterName,seatPos,date,paybackDate,note,audience,status,createdAt) "
                   "VALUES (:id,:posterKey,:posterName,:seatPos,:date,:paybackDate,:note,:audience,:status,:createdAt)", rec)
        return self.get_trade(rec["id"])

    def widen_trade(self, u, trade_id, body):
        t = self.get_trade(trade_id)
        if t["posterKey"] != u["pos"]:
            raise HttpError(403, "Only the person who posted the trade can change it")
        if t["status"] != "open":
            raise HttpError(409, "This trade is no longer open")
        new = self.clean_audience(body, t["posterKey"])
        aud = {"board": t["audience"]["board"] or new["board"], "to": sorted(set(t["audience"]["to"]) | set(new["to"]))}
        self.write("UPDATE trades SET audience = ? WHERE id = ?", (json.dumps(aud), trade_id))
        return self.get_trade(trade_id)

    def clean_proposal(self, t, taker, body):
        prop = body.get("proposal")
        if isinstance(prop, dict) and prop.get("later") is True:
            return {"later": True}, None
        swap = valid_date(prop.get("swapDate") if isinstance(prop, dict) else None, "proposal.swapDate")
        if swap == t["date"] or swap < dt.date.today().isoformat():
            raise BadRequest("The swap day must be after today and not the traded day")
        seat = self.seat_on(taker, swap)
        if not seat or self.status_on(taker, swap):
            raise BadRequest("The swap day must be a day the taker works")
        if self.seat_on(t["posterKey"], swap) or self.status_on(t["posterKey"], swap):
            raise BadRequest("The poster isn't free on the swap day")
        return {"swapDate": swap}, seat

    def reply_trade(self, u, trade_id, body):
        me, t = u["pos"], self.get_trade(trade_id)
        if t["status"] != "open" or t["date"] < dt.date.today().isoformat():
            raise HttpError(409, "This trade is no longer open")
        if not self.trade_visible(t, me):
            raise HttpError(404, "No such trade")
        why = self.can_take(me, t["posterKey"], t["date"])
        if why:
            raise BadRequest(why)
        proposal, swap_seat = self.clean_proposal(t, me, body)
        rec = {"id": uuid.uuid4().hex, "tradeId": trade_id, "takerKey": me, "takerName": (self.lookup(me) or {}).get("name"),
               "proposal": json.dumps(proposal), "swapSeatPos": swap_seat, "note": clean_text(body.get("note"), "note"), "createdAt": now()}
        with self.lock, self.conn:  # one response per person; a new one replaces the old
            self.conn.execute("DELETE FROM trade_replies WHERE tradeId = ? AND takerKey = ?", (trade_id, me))
            self.conn.execute("INSERT INTO trade_replies (id,tradeId,takerKey,takerName,proposal,swapSeatPos,note,createdAt) "
                              "VALUES (:id,:tradeId,:takerKey,:takerName,:proposal,:swapSeatPos,:note,:createdAt)", rec)
        rec["proposal"] = proposal
        return rec

    def pick_reply(self, u, trade_id, body):
        t = self.get_trade(trade_id)
        if t["posterKey"] != u["pos"]:
            raise HttpError(403, "Only the person who posted the trade can pick a response")
        if t["status"] != "open" or t["date"] < dt.date.today().isoformat():
            raise HttpError(409, "This trade is no longer open")
        r = self.one("SELECT * FROM trade_replies WHERE id = ? AND tradeId = ?", (body.get("replyId"), trade_id))
        if not r:
            raise BadRequest("replyId must be a response to this trade")
        poster, taker, by = t["posterKey"], r["takerKey"], u["display_name"] or u["google_email"]
        if self.seat_on(poster, t["date"]) != t["seatPos"] or self.status_on(poster, t["date"]):
            raise HttpError(409, "Your schedule for that day has changed. Cancel this trade and post it again.")
        why = self.can_take(taker, poster, t["date"])
        if why:
            raise HttpError(409, why)
        proposal = json.loads(r["proposal"])
        legs = [(taker, poster, t["seatPos"], t["date"])]  # (who covers, who is traded off, seat, day)
        if proposal.get("swapDate"):
            self.clean_proposal(t, taker, {"proposal": proposal})  # still valid on both sides
            legs.append((poster, taker, self.seat_on(taker, proposal["swapDate"]), proposal["swapDate"]))
        name = lambda k: (self.lookup(k) or {}).get("name") or ""
        stamp = now()
        with self.lock, self.conn:
            for coverer, off, seat, day in legs:
                self.conn.execute('INSERT INTO covers (id,coverKey,coverName,targetPos,start,"end",note,createdAt,createdBy,tradeId) '
                                  "VALUES (?,?,?,?,?,?,?,?,?,?)",
                                  (uuid.uuid4().hex, coverer, name(coverer), seat, day, day, "Shift trade", stamp, by, trade_id))
                self.conn.execute('INSERT INTO statuses (id,pos,name,code,start,"end",note,createdAt,createdBy,tradeId) '
                                  "VALUES (?,?,?,?,?,?,?,?,?,?)",
                                  (uuid.uuid4().hex, off, name(off), TRADED, day, day, "Shift trade", stamp, by, trade_id))
            self.conn.execute("UPDATE trades SET status = 'set', replyId = ?, takerKey = ?, proposal = ?, setAt = ? WHERE id = ?",
                              (r["id"], taker, r["proposal"], stamp, trade_id))
        return self.get_trade(trade_id)

    def cancel_trade(self, u, trade_id):
        t = self.get_trade(trade_id)
        if t["posterKey"] != u["pos"] and u["role"] != "admin":
            raise HttpError(403, "Only the person who posted the trade can cancel it")
        if t["status"] not in ("open", "set"):
            raise HttpError(409, "This trade is already " + t["status"])
        with self.lock, self.conn:  # a set trade's cover and TR records go with it
            self.conn.execute("DELETE FROM covers WHERE tradeId = ?", (trade_id,))
            self.conn.execute("DELETE FROM statuses WHERE tradeId = ?", (trade_id,))
            self.conn.execute("UPDATE trades SET status = 'cancelled' WHERE id = ?", (trade_id,))
        return self.get_trade(trade_id)

    def save_alerts(self, u, body):
        board = body.get("board", "off")
        if board not in BOARD_ALERTS:
            raise BadRequest("board must be off, daily or each")
        self.write("UPDATE users SET alert_text = ?, alert_app = ?, alert_email = ?, alert_board = ? WHERE id = ?",
                   tuple(1 if body.get(k) else 0 for k in ("text", "app", "email")) + (board, u["id"]))

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
            return urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)

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
            if path == "/api/trades":
                return self.send_json(200, app.trades(self.require("active")))
            if path == "/api/stats":
                self.require("active")
                on = (self.query().get("date") or [None])[0]
                return self.send_json(200, app.stats(valid_date(on, "date", required=False)))
            if path == "/api/admin/profiles":
                self.require("admin")
                return self.send_json(200, app.all("SELECT key, birthDate, hireDate FROM profiles"))
            m = re.fullmatch(r"/docs/([A-Za-z0-9-]+\.pdf)", path)
            if m:
                self.require("active")
                if m.group(1) not in app.docs:
                    raise HttpError(404, "Not found")
                self.path = "/docs/" + m.group(1)
                return super().do_GET()
            if path == "/docs/index.json":
                self.require("active")
                self.path = "/docs/index.json"
                return super().do_GET()
            if path == "/api/roster-names":
                self.require("signed-in")
                return self.send_json(200, app.roster_names())
            if path == "/api/admin/users":
                self.require("admin")
                return self.send_json(200, app.admin_users())
            if path == "/api/admin/corrections":
                self.require("editor")
                return self.send_json(200, app.corrections())
            if path in ("/data/positions.json", "/data/required-staffing.json", "/data/employee-ids.json", "/data/vacancy-awards-2027.json"):
                self.require("active")
                self.path = path
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
            if path == "/api/corrections":
                u = self.require("active")
                return self.send_json(201, app.add_correction(u, self.body()))
            if path == "/api/trades":
                u = self.trader()
                rec = app.post_trade(u, self.body())
                app.audit(u, "post trade", {"id": rec["id"], "date": rec["date"]})
                return self.send_json(201, rec)
            m = re.fullmatch(r"/api/trades/([0-9a-f]{32})/(replies|pick|cancel)", path)
            if m:
                u = self.trader() if m.group(2) != "cancel" else self.require("active")
                if m.group(2) == "replies":
                    return self.send_json(201, app.reply_trade(u, m.group(1), self.body()))
                rec = app.pick_reply(u, m.group(1), self.body()) if m.group(2) == "pick" else app.cancel_trade(u, m.group(1))
                app.audit(u, m.group(2) + " trade", {"id": rec["id"], "status": rec["status"]})
                return self.send_json(200, rec)
            raise HttpError(404, "Not found")

        def trader(self):
            """Trades need an approved account linked to a roster position or added person."""
            u = self.require("active")
            if not u["pos"]:
                raise HttpError(403, "Your account isn't linked to a roster position. Ask an admin to link it.")
            return u

        def do_PATCH(self):
            self.run(self._patch)

        def _patch(self):
            self.check_csrf()
            m = re.fullmatch(r"/api/trades/([0-9a-f]{32})", self.path_only())
            if m:
                return self.send_json(200, app.widen_trade(self.trader(), m.group(1), self.body()))
            m = re.fullmatch(r"/api/admin/records/(statuses|tour-changes|covers|people)/([0-9a-f]{32})", self.path_only())
            if m:
                u = self.require("admin")
                rec = app.update_record(m.group(1), m.group(2), self.body(), u["display_name"] or u["google_email"])
                app.audit(u, "edit " + m.group(1), {"id": m.group(2)})
                return self.send_json(200, rec)
            m = re.fullmatch(r"/api/admin/corrections/([0-9a-f]{32})", self.path_only())
            if m:
                u = self.require("editor")
                rec = app.handle_correction(u, m.group(1), self.body())
                app.audit(u, "correction " + rec["state"], {"id": rec["id"]})
                return self.send_json(200, rec)
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
            path = self.path_only()
            if path == "/api/me/contact":
                u = self.require("active")
                app.save_contact(u, self.body())
                return self.send_json(200, app.me_json(self.user()))
            if path == "/api/me/alerts":
                u = self.require("active")
                app.save_alerts(u, self.body())
                return self.send_json(200, app.me_json(self.user()))
            m = re.fullmatch(r"/api/staffing/([A-Z]{1,3}\d{1,2})", path)
            if m:
                u = self.require("admin")
                rec = app.set_staffing(m.group(1), self.body(), u["display_name"] or u["google_email"])
                app.audit(u, "staffing", rec)
                return self.send_json(200, rec)
            m = re.fullmatch(r"/api/admin/overrides/([0-9]{1,2}[A-Z]{2,4}[0-9]{2,3}M)", path)
            if m:
                u = self.require("admin")
                rec = app.set_override(m.group(1), self.body(), u["display_name"] or u["google_email"])
                app.audit(u, "roster override", rec)
                return self.send_json(200, rec)
            m = re.fullmatch(r"/api/admin/cells/([A-Za-z0-9:]{3,64})", path)
            if m:
                u = self.require("admin")
                rec = app.set_cell(m.group(1), self.body(), u["display_name"] or u["google_email"])
                app.audit(u, "staff cell", rec)  # the number itself stays out of the audit log
                return self.send_json(200, rec)
            m = re.fullmatch(r"/api/profiles/([A-Za-z0-9:]{3,64})", path)
            if m:
                u = self.require("active")
                key = m.group(1)
                if u["role"] != "admin" and key != u["pos"]:
                    raise HttpError(403, "You can only change your own dates")
                rec = app.set_profile(key, self.body(), u["display_name"] or u["google_email"])
                app.audit(u, "profile", {"key": key})
                return self.send_json(200, rec)
            raise HttpError(404, "Not found")

        def do_DELETE(self):
            self.run(self._delete)

        def _delete(self):
            self.check_csrf()
            m = re.fullmatch(r"/api/admin/corrections/([0-9a-f]{32})", self.path_only())
            if m:
                u = self.require("admin")
                if not app.write("DELETE FROM corrections WHERE id = ?", (m.group(1),)):
                    raise HttpError(404, "No such correction")
                app.audit(u, "delete correction", {"id": m.group(1)})
                return self.send_json(200, {"deleted": m.group(1)})
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
