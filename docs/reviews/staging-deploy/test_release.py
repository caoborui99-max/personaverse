"""Offline tests: no SSH, sockets, systemctl, curl, git fetch or live database."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('pv-staging-release.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Tests(unittest.TestCase):
    def test_pin_and_patch_scope(self):
        self.assertEqual(m.SHA, '8d37d06065d6e0c8b05c2ee7bf7eec4fc7ce0844')
        self.assertEqual(len(m.PATCH_FILES), 8)
        self.assertFalse(any(p.startswith('db/') for p in m.PATCH_FILES))

    def test_listener_rejects_public_and_ambiguous_sockets(self):
        for text in ['LISTEN 0 511 0.0.0.0:9000 0.0.0.0:* users:(("node",pid=10,fd=1))', '',
                     'LISTEN 0 511 127.0.0.1:9000 0.0.0.0:* users:(("node",pid=10,fd=1),("node",pid=11,fd=2))']:
            with patch.object(m, 'cmd', return_value=text), self.assertRaises(m.Stop):
                m.listener(9000)
        with patch.object(m, 'cmd', return_value='LISTEN 0 511 127.0.0.1:9000 0.0.0.0:* users:(("node",pid=10,fd=1))'):
            self.assertEqual(m.listener(9000), 10)

    def test_systemd_assignments_are_not_shell_evaluated(self):
        self.assertEqual(m.env_assignments('ADMIN_PASSWORD="literal $(nope)" PORT=9000')['ADMIN_PASSWORD'], 'literal $(nope)')
        with self.assertRaises(m.Stop):
            m.env_assignments('export ADMIN_PASSWORD=x')

    def test_nginx_parser_rejects_incomplete_blocks(self):
        tree = m.nginx_parse('http { server { listen 443 ssl; location / { proxy_pass http://127.0.0.1:9000; } } }')
        self.assertEqual(tree[0][0], ['http'])
        with self.assertRaises(m.Stop):
            m.nginx_parse('server { listen 443 ssl;')

    def test_db_symlink_and_external_driver_stop(self):
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp)/'staging.sqlite'
            db.touch()
            p = {'cwd': Path(temp), 'env': {'SQLITE_PATH': str(db)}}
            self.assertEqual(m.db_path(p), db)
            link = Path(temp)/'link'
            link.symlink_to(db)
            p['env']['SQLITE_PATH'] = str(link)
            with self.assertRaises(m.Stop):
                m.db_path(p)
            p['env']['DATABASE_URL'] = 'synthetic-private-dsn'
            with self.assertRaises(m.Stop) as error:
                m.db_path(p)
            self.assertNotIn('synthetic-private-dsn', str(error.exception))

    def test_schema_mismatch_never_migrates(self):
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp)/'staging.sqlite'
            with sqlite3.connect(db) as con:
                con.execute('CREATE TABLE schema_migrations(id TEXT,checksum TEXT)')
                con.execute("INSERT INTO schema_migrations VALUES('old','old')")
            before = db.read_bytes()
            with self.assertRaises(m.Stop):
                m.schema_check(db, {'new': 'new'})
            self.assertEqual(before, db.read_bytes())

    def test_curl_has_no_credentials_redirect_or_tls_bypass(self):
        response = b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}'
        with patch.object(m, 'cmd', return_value=response) as command:
            m.request('https://staging.example.test', '/api/session', local=True)
            args = command.call_args.args[0]
            self.assertNotIn('-k', args)
            self.assertNotIn('-L', args)
            self.assertNotIn('--user', args)
            self.assertIn('Host: staging.example.test', args)
            self.assertIn('X-Forwarded-Proto: https', args)
            self.assertIn('http://127.0.0.1:9000/api/session', args)

    def fixture_response(self, origin, path, **kwargs):
        if path == '/api/session':
            data = {'user': None, 'config': {'databaseReady': True, 'adminConfigured': True, 'chatConfigured': False}}
            return 200, {}, json.dumps(data).encode()
        if path == '/api/admin/personas':
            return 401, {}, b'{"error":{"code":"ADMIN_REQUIRED"}}'
        if path == '/api/auth/login':
            if kwargs.get('cross'):
                return 403, {}, b'{"error":{"code":"ORIGIN_REJECTED"}}'
            self.assertEqual(json.loads(kwargs['body'])['password'], 0)
            return 400, {}, b'{"error":{"code":"INVALID_CREDENTIALS"}}'
        if path == '/api/auth/logout':
            return 200, {'set-cookie': ['pv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure']}, b'{"ok":true}'
        return 200, {}, {'/admin.html': b'js/admin.js', '/js/admin.js': b"expected:'admin'", '/index.html': b'PersonaVerse'}[path]

    def test_auth_probes_never_use_valid_password_or_chat_api(self):
        with patch.object(m, 'request', side_effect=self.fixture_response) as request:
            m.health('https://staging.example.test', full=True)
            self.assertFalse(any('/chat' in c.args[1] for c in request.call_args_list))
            self.assertEqual(sum(c.args[1] == '/api/auth/login' for c in request.call_args_list), 4)

    def test_cloudflare_redirect_or_html_fails_closed(self):
        for response in [(302, {'location': ['https://auth.invalid']}, b''), (403, {}, b'Access denied'), (200, {}, b'<html>Login</html>')]:
            with patch.object(m, 'request', return_value=response), self.assertRaises((m.Stop, ValueError)):
                m.health('https://staging.example.test')

    def test_missing_secure_cookie_fails(self):
        def response(origin, path, **kwargs):
            status, headers, body = self.fixture_response(origin, path, **kwargs)
            if path == '/api/auth/logout':
                headers = {'set-cookie': ['pv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0']}
            return status, headers, body
        with patch.object(m, 'request', side_effect=response), self.assertRaises(m.Stop):
            m.health('https://staging.example.test', full=True)

    def test_config_change_blocks_stop(self):
        p = {'oldpid': 1, 'oldfp': ('original',), 'pins': {'synthetic': 'old'}}
        with patch.object(m, 'listener', return_value=1), patch.object(m, 'fingerprint', return_value=('original',)), patch.object(m, 'digest', return_value='new'), self.assertRaises(m.Stop):
            m.unchanged(p)

    def test_rollback_starts_old_code_without_restoring_db(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)/'repo'; root.mkdir()
            db = root/'test.sqlite'
            with sqlite3.connect(db) as con:
                con.execute('CREATE TABLE preserved(value TEXT)')
                con.execute("INSERT INTO preserved VALUES ('keep-me')")
            before = db.read_bytes()
            backups = Path(temp)/'backup'
            backups.mkdir(mode=0o700)
            calls, checkouts = [], []
            def command(args, **kwargs):
                calls.append([str(a) for a in args])
                if args[0] == 'du':
                    return '4096 repo'
                if args[0] == 'tar' and '-cpf' in args:
                    Path(args[args.index('-cpf')+1]).write_bytes(b'synthetic-archive')
                return ''
            def git(*args, **kwargs):
                if args[0] == 'checkout':
                    checkouts.append(args)
                if args[:2] == ('rev-parse', 'HEAD'):
                    return m.SHA
                if args[0] == 'rev-parse':
                    return m.PARENT
                return ''
            plan = {'unit': 'only-staging.service', 'current': m.PARENT, 'branch': 'prepare/base',
                    'db': db, 'pins': {}, 'expected': {}, 'origin': 'https://staging.example.test',
                    'oldpid': 1, 'oldfp': ('old',)}
            with patch.object(m, 'ROOT', root), patch.object(m, 'backup_directory', return_value=backups), \
                 patch.object(m, 'offline_tests'), patch.object(m, 'unchanged'), \
                 patch.object(m, 'other_db_users'), patch.object(m, 'schema_check'), \
                 patch.object(m, 'cmd', side_effect=command), patch.object(m, 'git', side_effect=git), \
                 patch.object(m, 'listener', return_value=None), \
                 patch.object(m, 'system', return_value={'MainPID': '0'}), \
                 patch.object(m, 'wait_health', side_effect=[m.Stop('synthetic postcheck failure'), None]) as health, \
                 contextlib.redirect_stdout(io.StringIO()), self.assertRaises(m.Stop):
                m.apply(plan)
            self.assertIn(('checkout', '--force', '--detach', m.PARENT), checkouts)
            self.assertIn(['systemctl', 'start', 'only-staging.service'], calls)
            self.assertTrue(all('8000' not in ' '.join(c) for c in calls))
            self.assertEqual(before, db.read_bytes())
            self.assertEqual([c.kwargs['full'] for c in health.call_args_list], [True, False])


if __name__ == '__main__':
    unittest.main(verbosity=2)
