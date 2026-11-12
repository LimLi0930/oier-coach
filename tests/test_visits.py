import json
import threading
import urllib.request
import urllib.error
from unittest.mock import patch
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
import visits
from visits import initialize_database, record_visit, visitor_cookie


class VisitorTests(unittest.TestCase):
    def test_unique_daily_and_total_with_persistent_database(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'visits.sqlite3'
            initialize_database(path)
            first = record_visit(path, 'a' * 64, '2026-11-12')
            self.assertEqual((first['today'], first['total']), (1, 1))
            again = record_visit(path, 'a' * 64, '2026-11-12')
            self.assertEqual((again['today'], again['total']), (1, 1))
            second = record_visit(path, 'b' * 64, '2026-11-12')
            self.assertEqual((second['today'], second['total']), (2, 2))
            initialize_database(path)
            tomorrow = record_visit(path, 'a' * 64, '2026-11-13')
            self.assertEqual((tomorrow['today'], tomorrow['total']), (1, 2))
            self.assertEqual(tomorrow['startedAt'], '2026-11-12')

    def test_concurrent_same_cookie_counts_once(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'visits.sqlite3'
            initialize_database(path)
            with ThreadPoolExecutor(max_workers=8) as pool:
                values = list(pool.map(lambda _: record_visit(path, 'a'*64, '2026-11-12'), range(32)))
            self.assertTrue(all((value['today'], value['total']) == (1, 1) for value in values))

    def test_cookie_validation_and_randomness(self):
        token = 'a' * 64
        self.assertEqual(visitor_cookie('__Host-oier-visitor=' + token), token)
        one, two = visitor_cookie(''), visitor_cookie('__Host-oier-visitor=invalid')
        self.assertRegex(one, r'^[a-f0-9]{64}$')
        self.assertNotEqual(one, two)
        self.assertNotEqual(two, 'invalid')

    def test_http_same_origin_cookie_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'visits.sqlite3'
            initialize_database(path)
            with patch.object(visits, 'DATABASE', path):
                server = visits.ThreadingHTTPServer(('127.0.0.1', 0), visits.VisitHandler)
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                url = f'http://127.0.0.1:{server.server_port}/api/visits'
                try:
                    request = urllib.request.Request(url, data=b'', method='POST', headers={'Origin': visits.ORIGIN})
                    with urllib.request.urlopen(request) as response:
                        cookie = response.headers['Set-Cookie']
                        self.assertIn('Secure', cookie)
                        self.assertIn('HttpOnly', cookie)
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
                        self.assertEqual(json.load(response)['total'], 1)
                    request.add_header('Cookie', cookie.split(';')[0])
                    with urllib.request.urlopen(request) as response:
                        self.assertEqual(json.load(response)['total'], 1)
                    invalid = urllib.request.Request(url, data=b'', method='POST', headers={'Origin': 'https://example.com'})
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(invalid)
                    self.assertEqual(error.exception.code, 403)
                    error.exception.close()
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(url)
                    self.assertEqual(error.exception.code, 405)
                    error.exception.close()
                finally:
                    server.shutdown()
                    worker.join()
                    server.server_close()
