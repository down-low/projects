#!/usr/bin/env python3
"""Tour Schedule server: serves the app and stores tour changes and work statuses in SQLite.

Usage:
    EDIT_TOKENS="chief:long-random-token,clerk:another-token" python3 server.py [--port 8000] [--db data/schedule.db]

Reads are open to anyone who can reach the server. Writes need an editor token
(`Authorization: Bearer <token>`); the name before the colon is recorded as createdBy.
Python standard library only.
"""
import argparse
import datetime as dt
import hmac
import json
import os
import re
import sqlite3
import threading
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/schedule.js": "schedule.js", "/store.js": "store.js",
          "/style.css": "style.css", "/data/positions.json": "data/positions.json"}
CODES = {"VA", "D", "S"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_BODY = 16 * 1024
KINDS = {"statuses": "statuses", "tour-changes": "tour_changes"}

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
"""


class BadRequest(Exception):
    pass


def parse_tokens(raw):
    tokens = {}
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        name, sep, token = part.partition(":")
        if not sep or not token:
            raise SystemExit("EDIT_TOKENS entries must look like name:token")
        tokens[token] = name.strip()
    return tokens


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


def clean_note(value):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise BadRequest("note must be text")
    return value.strip()[:500]


class App:
    def __init__(self, db_path, tokens):
        self.tokens = tokens
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        with open(os.path.join(ROOT, "data", "positions.json")) as f:
            self.positions = {p["pos"]: p for p in json.load(f)}

    def editor(self, header):
        if not header or not header.startswith("Bearer "):
            return None
        given = header[7:].strip()
        for token, name in self.tokens.items():
            if hmac.compare_digest(given, token):
                return name
        return None

    def records(self):
        with self.lock:
            st = [dict(r) for r in self.conn.execute('SELECT * FROM statuses ORDER BY start, createdAt')]
            tc = [dict(r) for r in self.conn.execute('SELECT * FROM tour_changes ORDER BY effective, createdAt')]
        return {"statuses": st, "tourChanges": tc}

    def _position(self, body):
        pos = body.get("pos")
        if pos not in self.positions:
            raise BadRequest("pos must be a position number from the vacancy list")
        return pos, self.positions[pos].get("name") or ""

    def add_status(self, body, who):
        pos, name = self._position(body)
        code = body.get("code")
        if code not in CODES:
            raise BadRequest("code must be VA, D or S")
        start = valid_date(body.get("start"), "start")
        end = valid_date(body.get("end"), "end", required=False)
        if end and end < start:
            raise BadRequest("end must be on or after start")
        rec = {"id": uuid.uuid4().hex, "pos": pos, "name": name, "code": code, "start": start, "end": end,
               "note": clean_note(body.get("note")), "createdAt": now(), "createdBy": who}
        with self.lock, self.conn:
            self.conn.execute('INSERT INTO statuses (id,pos,name,code,start,"end",note,createdAt,createdBy) '
                              'VALUES (:id,:pos,:name,:code,:start,:end,:note,:createdAt,:createdBy)', rec)
        return rec

    def add_tour_change(self, body, who):
        pos, name = self._position(body)
        tour = body.get("tour")
        if not isinstance(tour, int) or isinstance(tour, bool) or not 1 <= tour <= 31:
            raise BadRequest("tour must be a whole number from 1 to 31")
        rec = {"id": uuid.uuid4().hex, "pos": pos, "name": name, "tour": tour,
               "effective": valid_date(body.get("effective"), "effective"),
               "note": clean_note(body.get("note")), "createdAt": now(), "createdBy": who}
        with self.lock, self.conn:
            self.conn.execute('INSERT INTO tour_changes (id,pos,name,tour,effective,note,createdAt,createdBy) '
                              'VALUES (:id,:pos,:name,:tour,:effective,:note,:createdAt,:createdBy)', rec)
        return rec

    def delete(self, kind, rec_id):
        table = KINDS[kind]  # fixed allowlist, never user text
        with self.lock, self.conn:
            cur = self.conn.execute(f"DELETE FROM {table} WHERE id = ?", (rec_id,))
        return cur.rowcount > 0


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def make_handler(app):
    class Handler(SimpleHTTPRequestHandler):
        server_version = "TourSchedule/1.0"

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=ROOT, **kw)

        def send_json(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def path_only(self):
            return self.path.split("?", 1)[0]

        def do_GET(self):
            path = self.path_only()
            if path == "/api/health":
                return self.send_json(200, {"ok": True, "editing": bool(app.tokens)})
            if path == "/api/whoami":
                who = app.editor(self.headers.get("Authorization"))
                return self.send_json(200, {"name": who}) if who else self.send_json(401, {"error": "Token not recognized"})
            if path == "/api/records":
                return self.send_json(200, app.records())
            if path not in STATIC:  # only the app's own files are served
                return self.send_json(404, {"error": "Not found"})
            self.path = "/" + STATIC[path]
            return super().do_GET()

        def do_HEAD(self):
            self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

        def write_guard(self):
            who = app.editor(self.headers.get("Authorization"))
            if not who:
                self.send_json(401, {"error": "Sign in with an editor token to make changes"})
            return who

        def do_POST(self):
            path = self.path_only()
            if path not in ("/api/statuses", "/api/tour-changes"):
                return self.send_json(404, {"error": "Not found"})
            who = self.write_guard()
            if not who:
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                if length <= 0 or length > MAX_BODY:
                    raise BadRequest("Request body is missing or too large")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise BadRequest("Request body must be a JSON object")
                rec = app.add_status(body, who) if path == "/api/statuses" else app.add_tour_change(body, who)
            except (BadRequest, json.JSONDecodeError, ValueError) as e:
                return self.send_json(400, {"error": str(e)})
            return self.send_json(201, rec)

        def do_DELETE(self):
            m = re.fullmatch(r"/api/(statuses|tour-changes)/([0-9a-f]{32})", self.path_only())
            if not m:
                return self.send_json(404, {"error": "Not found"})
            if not self.write_guard():
                return
            if not app.delete(m.group(1), m.group(2)):
                return self.send_json(404, {"error": "No such record"})
            return self.send_json(200, {"deleted": m.group(2)})

        def log_message(self, fmt, *args):
            if self.path_only().startswith("/api/"):
                super().log_message(fmt, *args)

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to accept connections from other machines")
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "schedule.db"))
    args = ap.parse_args()
    tokens = parse_tokens(os.environ.get("EDIT_TOKENS"))
    if not tokens:
        print("EDIT_TOKENS is not set: the schedule is view-only until it is.")
    app = App(args.db, tokens)
    srv = ThreadingHTTPServer((args.host, args.port), make_handler(app))
    print(f"Tour Schedule on http://{args.host}:{args.port}  ({len(tokens)} editor token(s))")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
