"""No server access. Fixture repos/databases only. CI must run the kernel boundary tests."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SCRIPT = HERE/'pv-staging-release.py'
spec = importlib.util.spec_from_file_location('release_readonly', SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def manifest(root):
    """Read without updating atime, including directory traversal; no timestamp reset."""
    result = {}
    def walk(path, relative):
        stat = path.lstat()
        fields = {k: getattr(stat, k) for k in ('st_mode', 'st_uid', 'st_gid', 'st_size',
                  'st_nlink', 'st_ino', 'st_dev', 'st_atime_ns', 'st_mtime_ns', 'st_ctime_ns')}
        if path.is_symlink():
            fields['target'] = os.readlink(path)
        elif path.is_dir():
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOATIME)
            try:
                with os.scandir(fd) as entries:
                    names = sorted(entry.name for entry in entries)
            finally:
                os.close(fd)
            for name in names:
                walk(path/name, relative+'/'+name)
        else:
            fd = os.open(path, os.O_RDONLY | os.O_NOATIME | os.O_NOFOLLOW)
            digest = hashlib.sha256()
            with os.fdopen(fd, 'rb') as source:
                for chunk in iter(lambda: source.read(65536), b''):
                    digest.update(chunk)
            fields['sha256'] = digest.hexdigest()
        result[relative] = fields
    walk(root, '.')
    return result


def fixture(base, variant):
    repo, data = base/'repository', base/'database'
    repo.mkdir(); data.mkdir()
    env = {**m.SAFE_ENV, 'HOME': str(base), 'GIT_CONFIG_NOSYSTEM': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null'}
    def git(*args):
        return subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(repo), *args],
                              env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode().strip()
    git('init', '-q')
    (repo/'db/migrations').mkdir(parents=True)
    expected = {}
    for name in m.MIGRATION_IDS:
        sql = ('-- synthetic fixture '+name+'\n').encode()
        (repo/'db/migrations'/name).write_bytes(sql)
        expected[name] = hashlib.sha256(sql+(b'\nlegacy-visibility-v1' if name == '0002_catalog.sql' else b'')).hexdigest()
    (repo/'tracked.txt').write_text('synthetic fixture\n')
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
    head = git('rev-parse', 'HEAD')
    db = data/'snapshot.sqlite'
    with sqlite3.connect(db) as con:
        con.executescript('''CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,checksum TEXT);
          CREATE TABLE sessions(token_hash TEXT); CREATE TABLE login_attempts(key TEXT);
          CREATE TABLE personas(id TEXT); CREATE TABLE persona_core_links(persona_id TEXT);
          CREATE TABLE soul_core(id TEXT); CREATE TABLE settings(key TEXT);
          INSERT INTO soul_core VALUES('shared'); INSERT INTO settings VALUES('catalog_seed_v1');''')
        con.executemany('INSERT INTO schema_migrations VALUES(?,?)', expected.items())
    if variant == 'dirty':
        (repo/'tracked.txt').write_text('changed fixture\n')
    elif variant == 'bad_checksum':
        with sqlite3.connect(db) as con:
            con.execute("UPDATE schema_migrations SET checksum='mismatch'")
    elif variant == 'wal_sidecar':
        (data/'snapshot.sqlite-wal').write_bytes(b'synthetic WAL')
        (data/'snapshot.sqlite-shm').write_bytes(b'synthetic SHM')
    elif variant == 'wal_header':
        raw = bytearray(db.read_bytes()); raw[18:20] = b'\x02\x02'; db.write_bytes(raw)
    elif variant == 'corrupt':
        raw = bytearray(db.read_bytes()); raw[100:200] = b'\xff'*100; db.write_bytes(raw)
    elif variant == 'git_helper':
        git('config', 'core.fsmonitor', 'false')  # explicitly unsupported config, never executed
    # Force old atime to expose accidental reads/relatime changes, not just explicit writes.
    for path in sorted(base.rglob('*'), key=lambda p: len(p.parts), reverse=True)+[base]:
        stat = path.lstat()
        os.utime(path, ns=(0, stat.st_mtime_ns), follow_symlinks=False)
    return repo, db, head


CHILD = r'''
import importlib.util,sys
spec=importlib.util.spec_from_file_location('fixture_release',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# Only the accepted CURRENT baseline is replaced with the synthetic fixture commit.
# The actual deployment target SHA and every other guard remain unchanged.
m.PARENT=sys.argv[4]
sys.argv=['pv-staging-release.py','--check','--repository',sys.argv[2],'--database-snapshot',sys.argv[3]]
sys.exit(m.main())
'''


class PureModeTests(unittest.TestCase):
    def test_target_and_service_boundaries_unchanged(self):
        self.assertEqual(m.SHA, '8d37d06065d6e0c8b05c2ee7bf7eec4fc7ce0844')
        self.assertEqual(str(m.ROOT), '/opt/personaverse-test-staging')
        self.assertEqual(str(m.OLD_ROOT), '/opt/personaverse-test')

    def test_bare_check_stops_without_touching_targets_on_error_exit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo, db, _ = fixture(root, 'normal')
            before = manifest(root)
            result = subprocess.run([sys.executable, '-I', '-B', '-S', str(SCRIPT), '--check',
                                     '--repository', str(repo), '--database-snapshot', str(db)],
                                    env=m.SAFE_ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertEqual(result.returncode, 1)
            self.assertIn(b'STOP:', result.stderr)
            self.assertEqual(before, manifest(root))

    def test_check_does_not_reach_mutating_or_credential_paths(self):
        with patch.object(sys, 'argv', ['script', '--check']), \
             patch.object(m, 'readonly_boundary', side_effect=m.Stop('boundary unavailable')), \
             patch.object(m, 'preflight') as live, patch.object(m.os, 'open') as opened, \
             patch.object(m, 'process') as credentials, patch.object(m, 'cmd') as command, \
             patch.object(m, 'apply') as deploy, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(m.main(), 1)
            for mock in (live, opened, credentials, command, deploy):
                mock.assert_not_called()

    def test_fetch_and_prepare_cannot_hide_behind_check(self):
        for args in (['--check', '--fetch'], ['--check', '--prepare'], ['--fetch'], ['--check', '--apply']):
            with self.subTest(args=args), patch.object(sys, 'argv', ['script', *args]), \
                 patch.object(m, 'preflight') as live, contextlib.redirect_stderr(io.StringIO()), \
                 self.assertRaises(SystemExit) as exit:
                m.main()
            self.assertEqual(exit.exception.code, 2)
            live.assert_not_called()

    def test_git_check_environment_disables_index_helpers_and_lazy_network(self):
        response = subprocess.CompletedProcess([], 0, b'clean\n', b'')
        with patch.object(m.subprocess, 'run', return_value=response) as run:
            m.check_git(Path('/synthetic'), 'status', '--porcelain=v1')
            command = run.call_args.args[0]
            env = run.call_args.kwargs['env']
            self.assertIn('--no-optional-locks', command)
            self.assertIn('core.fsmonitor=false', command)
            self.assertIn('protocol.allow=never', command)
            self.assertEqual(env['GIT_OPTIONAL_LOCKS'], '0')
            self.assertEqual(env['GIT_NO_LAZY_FETCH'], '1')
            self.assertNotIn('SSH_AUTH_SOCK', env)


class KernelBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bwrap = shutil.which('bwrap')
        need_sandbox = os.environ.get('PV_REQUIRE_READONLY_SANDBOX') == '1'
        if bwrap:
            probe = subprocess.run([bwrap, '--ro-bind', '/', '/', '--unshare-net', '--die-with-parent',
                                    '--', '/usr/bin/python3', '-I', '-B', '-S', '-c',
                                    'import importlib.util; s=importlib.util.spec_from_file_location("r",'+repr(str(SCRIPT))+'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.readonly_boundary()'],
                                   env=m.SAFE_ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            available = probe.returncode == 0
        else:
            available = False
        if not available:
            if need_sandbox:
                raise AssertionError('Required kernel read-only/network boundary is unavailable; cannot claim normal check verified')
            raise unittest.SkipTest('Local sandbox denies nested namespace; CI requires this suite, never silently passes it')
        cls.bwrap = bwrap

    def test_normal_and_exception_exits_preserve_full_file_manifest(self):
        for variant in ('normal', 'dirty', 'bad_checksum', 'wal_sidecar', 'wal_header', 'corrupt', 'git_helper'):
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                repo, db, head = fixture(root, variant)
                before = manifest(root)
                result = subprocess.run([self.bwrap, '--ro-bind', '/', '/', '--unshare-net', '--die-with-parent',
                                         '--', '/usr/bin/python3', '-I', '-B', '-S', '-c', CHILD,
                                         str(SCRIPT), str(repo), str(db), head],
                                        env=m.SAFE_ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
                self.assertEqual(before, manifest(root), variant)
                self.assertEqual(result.returncode, 0 if variant == 'normal' else 1,
                                 (variant, result.stdout.decode(), result.stderr.decode()))
                if variant == 'normal':
                    self.assertIn(b'LIVE_DEPLOYMENT_READINESS=UNVERIFIED', result.stdout)
                else:
                    self.assertIn(b'STOP:', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
