"""Small first-party, cookie-deduplicated visitor counter for OIer Coach."""
import hashlib
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from contextlib import closing
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

COOKIE_NAME = '__Host-oier-visitor'
ORIGIN = os.environ.get('SITE_ORIGIN', 'https://oier.kdtree.xyz')
DATABASE = Path(os.environ.get('VISITS_DB', '/var/lib/oier-coach/visits.sqlite3'))
TIMEZONE = timezone(timedelta(hours=8))


def initialize_database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
            CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, first_seen TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS daily_visitors (day TEXT NOT NULL, visitor_id TEXT NOT NULL, PRIMARY KEY (day, visitor_id));
            CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
            INSERT OR IGNORE INTO counters VALUES ('total', 0);
        ''')


def record_visit(path, visitor_id, day):
    """The cookie ID is hashed before persistence; updates are atomic and idempotent."""
    digest = hashlib.sha256(visitor_id.encode('ascii')).hexdigest()
    with closing(sqlite3.connect(path, timeout=15)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        new_visitor = db.execute('INSERT OR IGNORE INTO visitors VALUES (?, ?)', (digest, day)).rowcount
        new_today = db.execute('INSERT OR IGNORE INTO daily_visitors VALUES (?, ?)', (day, digest)).rowcount
        db.execute("UPDATE counters SET value=value+? WHERE key='total'", (new_visitor,))
        db.execute('INSERT INTO counters VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=value+excluded.value', ('day:'+day, new_today))
        total = db.execute("SELECT value FROM counters WHERE key='total'").fetchone()[0]
        today = db.execute('SELECT value FROM counters WHERE key=?', ('day:'+day,)).fetchone()[0]
        # Keep daily deduplication rows only for the current and preceding day.
        db.execute("DELETE FROM daily_visitors WHERE day < date(?, '-1 day')", (day,))
        started = db.execute('SELECT MIN(first_seen) FROM visitors').fetchone()[0]
        return {'today': today, 'total': total, 'date': day, 'startedAt': started, 'timezone': 'Asia/Shanghai'}


def visitor_cookie(header):
    cookies = SimpleCookie()
    try:
        cookies.load(header or '')
        token = cookies[COOKIE_NAME].value if COOKIE_NAME in cookies else ''
    except CookieError:
        token = ''
    return token if re.fullmatch(r'[a-f0-9]{64}', token) else secrets.token_hex(32)


class VisitHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, status, data, visitor=None):
        body = json.dumps(data, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        if visitor:
            self.send_header('Set-Cookie', f'{COOKIE_NAME}={visitor}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self.send_json(200, {'status': 'ok'})
        else:
            self.send_json(405, {'error': 'method-not-allowed'})

    def do_POST(self):
        if self.path != '/api/visits':
            self.send_json(404, {'error': 'not-found'})
            return
        if self.headers.get('Origin') != ORIGIN:
            self.send_json(403, {'error': 'invalid-origin'})
            return
        if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
            self.send_json(400, {'error': 'unexpected-body'})
            return
        visitor = visitor_cookie(self.headers.get('Cookie'))
        day = datetime.now(TIMEZONE).date().isoformat()
        try:
            result = record_visit(DATABASE, visitor, day)
        except sqlite3.Error:
            self.send_json(503, {'error': 'temporarily-unavailable'})
            return
        self.send_json(200, result, visitor)


if __name__ == '__main__':
    initialize_database(DATABASE)
    server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('VISITS_PORT', '8787'))), VisitHandler)
    server.serve_forever()
