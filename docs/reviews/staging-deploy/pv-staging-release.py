#!/usr/bin/env python3
"""Reviewable, fail-closed release runner. --check is default; never migrates data.
Supported profile: direct systemd Node 24 + independent SQLite + local nginx TLS.
Do not execute with python -O. No secret values or subprocess stderr are printed.
"""
import argparse
import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import urlsplit

ROOT = Path('/opt/personaverse-test-staging')
OLD_ROOT = Path('/opt/personaverse-test')
USER = 'pvstaging'
SHA = '8d37d06065d6e0c8b05c2ee7bf7eec4fc7ce0844'
PARENT = '0018aceea9c39df71e8e4a4a100478d2a95379f6'
BRANCH = 'prepare/fix-admin-login'
REPO = 'https://github.com/caoborui99-max/personaverse.git'
PATCH_FILES = {'api/index.js', 'js/admin.js', 'server/handler.js',
               'server/security.js', 'server/diagnostics.js',
               'tests/admin-login.test.js', 'tests/browser_smoke.py',
               'docs/admin-login-investigation.md'}
SAFE_ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}


class Stop(Exception):
    pass


def need(ok, reason):
    if not ok:
        raise Stop(reason)


def cmd(args, *, cwd=None, timeout=40, raw=False):
    try:
        p = subprocess.run([str(a) for a in args], cwd=cwd, env=SAFE_ENV,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop('命令不可用或超时：'+Path(args[0]).name+'；未显示敏感参数或输出。') from None
    need(p.returncode == 0, '命令失败：'+Path(args[0]).name+'，退出码'+str(p.returncode)+'；停止，未输出参数值或原始日志。')
    return p.stdout if raw else p.stdout.decode('utf-8').strip()


def as_user(args, *, cwd=ROOT, timeout=40, raw=False, extra=None):
    account = pwd.getpwnam(USER)
    env = {**SAFE_ENV, 'HOME': account.pw_dir, 'GIT_TERMINAL_PROMPT': '0',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           **(extra or {})}
    return cmd(['runuser', '-u', USER, '--', 'env', '-i',
                *[k+'='+v for k, v in env.items()], *args], cwd=cwd,
               timeout=timeout, raw=raw)


def git(*args, **kw):
    return as_user(['git', '-c', 'core.hooksPath=/dev/null', '-C', ROOT, *args], **kw)


def system(unit, *props):
    text = cmd(['systemctl', 'show', unit, '--no-pager',
                *['--property='+p for p in props]])
    return dict(line.split('=', 1) for line in text.splitlines() if '=' in line)


def listener(port, optional=False):
    lines = cmd(['ss', '-H', '-ltnp', f'sport = :{port}']).splitlines()
    if optional and not lines:
        return None
    need(len(lines) == 1, f'{port} 必须只有一个可识别的监听进程。')
    cols = lines[0].split()
    need(len(cols) >= 5 and cols[3] == f'127.0.0.1:{port}',
         f'{port} 不是精确的 127.0.0.1 监听；停止。')
    pids = set(re.findall(r'pid=(\d+)', lines[0]))
    need(len(pids) == 1, f'无法唯一确认 {port} 的PID。')
    return int(pids.pop())


def process(pid):
    proc = Path('/proc')/str(pid)
    env = {}
    for entry in (proc/'environ').read_bytes().split(b'\0'):
        if b'=' in entry:
            key, value = entry.split(b'=', 1)
            env[key.decode()] = value.decode()
    argv = [s.decode() for s in (proc/'cmdline').read_bytes().split(b'\0') if s]
    # starttime is field 22; comm may contain spaces and parentheses.
    start = (proc/'stat').read_text().rsplit(')', 1)[1].split()[19]
    return {'pid': pid, 'cwd': (proc/'cwd').resolve(), 'exe': (proc/'exe').resolve(),
            'env': env, 'argv': argv, 'start': start}


def fingerprint(pid):
    p = process(pid)
    return (p['pid'], p['start'], str(p['cwd']), str(p['exe']))


def digest(path):
    hashed = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024*1024), b''):
            hashed.update(block)
    return hashed.hexdigest()


def protected_file(path):
    path = Path(path)
    need(path.is_absolute() and path.is_file() and not path.is_symlink(),
         '环境/单元文件不是可确认的绝对常规文件。')
    s = path.stat()
    need(s.st_uid in (0, pwd.getpwnam(USER).pw_uid) and not s.st_mode & 0o022,
         '环境/单元文件所有权或写权限不安全。')
    return path


def env_assignments(text):
    result = {}
    for word in shlex.split(text, comments=False, posix=True):
        need('=' in word, '存在无法解析的systemd环境变量格式。')
        key, value = word.split('=', 1)
        need(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key), '环境变量名称格式不支持。')
        result[key] = value
    return result


def environment_files(meta, running):
    text = meta.get('EnvironmentFiles', '')
    entries = re.findall(r'(/[^\s()]+) \(ignore_errors=no\)', text)
    residue = re.sub(r'/[^\s()]+ \(ignore_errors=no\)', '', text).strip()
    need(entries and not residue, '仅支持明确、必需、无空格的EnvironmentFile路径；其他情况停止。')
    desired = env_assignments(meta.get('Environment', ''))
    files = []
    for name in entries:
        file = protected_file(name)
        mode = file.stat().st_mode
        need(not mode & 0o007, '环境文件允许其他用户读取；停止。')
        if mode & 0o040:
            need(file.stat().st_gid == pwd.getpwnam(USER).pw_gid,
                 '环境文件的读取组不是预发布用户主组。')
        # Restricted subset: literal single-line assignments only. No shell sourcing.
        for line in file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith(('#', ';')):
                continue
            need('\\' not in line and '%' not in line,
                 '环境文件含转义、续行或specifier；无法可靠解析，停止。')
            parsed = env_assignments(line)
            need(len(parsed) == 1, '环境文件不是逐行KEY=value格式。')
            desired.update(parsed)
        files.append(file)
    need(all(running.get(k) == v for k, v in desired.items()),
         '环境文件/systemd配置与当前进程不一致；必须先人工确认，未重载。')
    return files, sorted(desired)


def db_path(p):
    env = p['env']
    need(not env.get('DATABASE_URL') and not env.get('VERCEL'),
         '仅支持独立单机SQLite；检测到外部数据库或Serverless配置。')
    need(env.get('DATABASE_DRIVER', 'sqlite') == 'sqlite', '数据库驱动无法确认。')
    value = env.get('SQLITE_PATH')
    path = Path(value) if value else p['cwd']/'.local/personaverse.sqlite'
    if not path.is_absolute():
        path = p['cwd']/path
    need(path.is_file() and not path.is_symlink(), '数据库不存在或是符号链接。')
    return path.resolve()


def readonly_db(path):
    return sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, timeout=3)


def schema_check(db, target_sql):
    with contextlib.closing(readonly_db(db)) as con:
        need(con.execute('PRAGMA quick_check').fetchall() == [('ok',)], 'SQLite完整性检查失败。')
        rows = dict(con.execute('SELECT id,checksum FROM schema_migrations'))
        need(rows == target_sql, '迁移校验不匹配；本脚本禁止自动迁移。')
        for table in ['sessions', 'login_attempts', 'personas', 'persona_core_links', 'soul_core', 'settings']:
            need(con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone(),
                 '缺少必要数据表；停止，不初始化。')
        need(con.execute("SELECT 1 FROM soul_core WHERE id='shared'").fetchone(), '缺少核心数据。')
        need(con.execute("SELECT 1 FROM settings WHERE key='catalog_seed_v1'").fetchone(), '缺少初始化标记。')
        need(not con.execute('SELECT 1 FROM personas p LEFT JOIN persona_core_links l ON l.persona_id=p.id WHERE l.persona_id IS NULL LIMIT 1').fetchone(), '人格核心关联不完整。')


def nginx_tokens(text):
    # Strict grammar; unsupported nginx syntax fails rather than being guessed.
    lex = shlex.shlex(text, posix=True, punctuation_chars='{};')
    lex.whitespace_split = True
    lex.commenters = '#'
    tokens = []
    for token in lex:
        if re.fullmatch(r'[{};]+', token):
            tokens.extend(token)
        else:
            tokens.append(token)
    return tokens


def nginx_parse(text):
    tokens = iter(nginx_tokens(text))
    def parse(nested=False):
        nodes, words = [], []
        for token in tokens:
            if token == ';':
                need(words, 'Nginx语法无法解析。')
                nodes.append((words, None)); words = []
            elif token == '{':
                need(words, 'Nginx块语法无法解析。')
                nodes.append((words, parse(True))); words = []
            elif token == '}':
                need(nested and not words, 'Nginx块边界无法解析。')
                return nodes
            else:
                words.append(token)
        need(not nested and not words, 'Nginx配置不完整。')
        return nodes
    return parse()


def proxy_check(origin):
    # nginx -T tests on-disk config only. Do not claim it proves the running config.
    master = int(system('nginx.service', 'MainPID').get('MainPID', '0'))
    need(master > 0, '没有可识别的nginx.service主进程。')
    running = process(master)
    startup = ' '.join(running['argv'])
    need(running['exe'] == Path('/usr/sbin/nginx') and startup in (
         'nginx: master process /usr/sbin/nginx',
         'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;'),
         'Nginx使用非标准启动参数，无法证明-T对应实际配置。')
    text = cmd(['/usr/sbin/nginx', '-T'], timeout=30)
    nodes = nginx_parse(text)
    servers = []
    def walk(items):
        for words, children in items:
            if words == ['server'] and children is not None:
                servers.append(children)
            elif children is not None:
                walk(children)
    walk(nodes)
    host = urlsplit(origin).hostname
    matching = [s for s in servers if any(w[0] == 'server_name' and host in w[1:] for w, c in s)]
    matches = [s for s in matching if any(w[0] == 'listen' and '443' in w[1:] and 'ssl' in w[1:] for w, c in s)]
    need(len(matches) == 1, '无法唯一识别该域名的Nginx 443 TLS虚拟主机；隧道/非标准代理需另行审核。')
    server = matches[0]
    allowed = {'listen', 'server_name', 'ssl_certificate', 'ssl_certificate_key',
               'ssl_protocols', 'ssl_ciphers', 'ssl_prefer_server_ciphers',
               'ssl_session_cache', 'ssl_session_timeout', 'server_tokens',
               'client_max_body_size', 'access_log', 'error_log', 'location'}
    need(all(w[0] in allowed for w, c in server), '该虚拟主机有未支持的include/重定向/认证/其他指令；停止。')
    locations = [(w, c) for w, c in server if w[0] == 'location']
    need(len(locations) == 1 and locations[0][0] == ['location', '/'], '存在其他location/API路由，无法证明统一指向9000。')
    loc = locations[0][1]
    need(loc is not None and all(c is None for w, c in loc), '不支持嵌套代理配置。')
    required = [['proxy_pass', 'http://127.0.0.1:9000'],
                ['proxy_set_header', 'Host', '$host'],
                ['proxy_set_header', 'X-Forwarded-Proto', '$scheme']]
    need(all(sum(w == expected for w, c in loc) == 1 for expected in required),
         '代理目标/Host/HTTPS协议头不符合严格预发布配置。')
    loc_allowed = {'proxy_pass', 'proxy_set_header', 'proxy_connect_timeout',
                   'proxy_read_timeout', 'proxy_send_timeout', 'client_max_body_size'}
    need(all(w[0] in loc_allowed for w, c in loc), '代理存在未支持的路由/认证指令。')
    for key in ['Host', 'X-Forwarded-Proto']:
        need(sum(w[:2] == ['proxy_set_header', key] for w, c in loc) == 1, '代理安全头重复。')
    paths = re.findall(r'^# configuration file ([^\n]+):$', text, re.M)
    need(paths, '未识别Nginx配置来源文件。')
    files = [protected_file(p) for p in paths]
    boot = int(re.search(r'^btime (\d+)$', Path('/proc/stat').read_text(), re.M).group(1))
    start = boot + int(running['start'])/os.sysconf('SC_CLK_TCK')
    need(all(f.stat().st_mtime <= start and f.stat().st_ctime <= start for f in files),
         'Nginx配置晚于主进程启动，无法证明磁盘配置等于现网配置；停止，不重载代理。')
    return files, fingerprint(master)


def request(origin, path, *, method='GET', body=None, local=False, cross=False, invalid_cookie=False):
    url = urlsplit(origin)
    args = ['curl', '--silent', '--show-error', '--noproxy', '*',
            '--connect-timeout', '5', '--max-time', '12', '--max-redirs', '0',
            '--request', method, '--header', 'Origin: '+('https://origin-check.invalid' if cross else origin),
            '--header', 'Sec-Fetch-Site: '+('cross-site' if cross else 'same-origin')]
    if invalid_cookie:
        args += ['--header', 'Cookie: pv_session=invalid-format']
    if local:
        args += ['--header', 'Host: '+url.netloc, '--header', 'X-Forwarded-Proto: https']
    if body is not None:
        args += ['--header', 'Content-Type: application/json', '--data-binary', body]
    # No Cookie jar, credentials, -L or -k. JSON/headers are inspected in memory only.
    data = cmd(args+['--dump-header', '-', (f'http://127.0.0.1:9000' if local else origin)+path], raw=True, timeout=15)
    header, separator, payload = data.partition(b'\r\n\r\n')
    need(separator, 'HTTP响应头无法解析。')
    lines = header.decode('iso-8859-1').splitlines()
    status = int(lines[0].split()[1])
    headers = {}
    for line in lines[1:]:
        if ':' in line:
            key, value = line.split(':', 1)
            headers.setdefault(key.lower(), []).append(value.strip())
    return status, headers, payload


def health(origin, full=False):
    # Both actual HTTPS and the local adapter must work. No bypass of Access/redirects.
    for local in (True, False):
        status, headers, body = request(origin, '/api/session', local=local)
        need(status == 200, '会话健康检查不是200；认证跳转/403也会停止。')
        data = json.loads(body)
        need(data.get('user') is None and data.get('config', {}).get('databaseReady') is True
             and data['config'].get('adminConfigured') is True
             and data['config'].get('chatConfigured') is False, '会话/数据库/管理员/AI关闭状态不符合要求。')
        if not full:
            continue
        status, _, body = request(origin, '/api/session', local=local, invalid_cookie=True)
        need(status == 200 and json.loads(body).get('user') is None, '非法会话Cookie未被拒绝。')
        status, _, body = request(origin, '/api/admin/personas', local=local)
        need(status == 401 and json.loads(body).get('error', {}).get('code') == 'ADMIN_REQUIRED', '未登录管理API未被正确保护。')
        # Invalid shape returns BEFORE rate-counter/session INSERT. Never use wrong real passwords.
        status, _, body = request(origin, '/api/auth/login', method='POST',
                                  body='{"email":"shape-check@example.invalid","password":0}', local=local)
        need(status == 400 and json.loads(body).get('error', {}).get('code') == 'INVALID_CREDENTIALS', '登录接口/来源验证未通过。')
        status, _, body = request(origin, '/api/auth/login', method='POST',
                                  body='{}', local=local, cross=True)
        need(status == 403 and json.loads(body).get('error', {}).get('code') == 'ORIGIN_REJECTED', '跨站请求保护未生效。')
        status, headers, body = request(origin, '/api/auth/logout', method='POST', body='{}', local=local)
        need(status == 200 and json.loads(body).get('ok') is True, '无凭据退出接口失败。')
        cookies = headers.get('set-cookie', [])
        need(any(c.startswith('pv_session=;') and all(v.lower() in c.lower() for v in
                 ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0', 'Secure']) for c in cookies), '安全Cookie清除属性不正确。')
        for path, marker in [('/admin.html', b'js/admin.js'), ('/js/admin.js', b"expected:'admin'"), ('/index.html', b'PersonaVerse')]:
            status, _, body = request(origin, path, local=local)
            need(status == 200 and marker in body, '页面或修复脚本未实际提供，可能存在旧缓存/错误代理目标。')


def other_db_users(db, allowed_pid):
    targets = {str(db), str(db)+'-wal', str(db)+'-shm'}
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit() or int(proc.name) == allowed_pid:
            continue
        try:
            for fd in (proc/'fd').iterdir():
                try:
                    target = os.readlink(fd)
                except FileNotFoundError:
                    continue
                need(target not in targets, '预发布数据库还被其他进程打开；停止，无法证明隔离。')
        except (FileNotFoundError, ProcessLookupError):
            pass


def process_has_db(pid, db):
    wanted = (db.stat().st_dev, db.stat().st_ino)
    for fd in Path('/proc', str(pid), 'fd').iterdir():
        try:
            stat = fd.stat()
            if (stat.st_dev, stat.st_ino) == wanted:
                return True
        except FileNotFoundError:
            continue
    return False


def preflight(fetch=False):
    need(os.geteuid() == 0, '需要sudo/root读取进程和systemd元数据；没有执行任何部署。')
    need(ROOT.resolve() == ROOT and OLD_ROOT.resolve() == OLD_ROOT and (ROOT/'.git').is_dir()
         and not (ROOT/'.git').is_symlink(),
         '代码目录为符号链接、Git worktree或不存在；需要专用方案。')
    need(not any(p.is_symlink() for p in (ROOT/'.git').rglob('*')), 'Git元数据含符号链接，无法证明与旧服务隔离。')
    for file in (ROOT/'.git/HEAD', ROOT/'.git/config', ROOT/'.git/index'):
        need(file.is_file() and file.stat().st_nlink == 1, 'Git关键元数据缺失或存在硬链接共享。')
    account = pwd.getpwnam(USER)
    staging, oldpid = listener(9000), listener(8000)
    p, prod = process(staging), process(oldpid)
    need(p['cwd'] == ROOT and prod['cwd'] == OLD_ROOT, '监听进程的实际目录与已确认路径不一致。')
    need(Path('/proc', str(staging)).stat().st_uid == account.pw_uid, '9000进程用户不是pvstaging。')
    groups = re.findall(r'/([^/\n]+\.service)(?:/|$)', Path('/proc', str(staging), 'cgroup').read_text(), re.M)
    need(len(set(groups)) == 1, '无法唯一识别预发布systemd服务。')
    unit = groups[0]
    prodgroups = re.findall(r'/([^/\n]+\.service)(?:/|$)', Path('/proc', str(oldpid), 'cgroup').read_text(), re.M)
    need(unit not in prodgroups, '8000和9000处于同一个服务控制组，停止9000可能影响8000。')
    props = ['Id', 'MainPID', 'User', 'WorkingDirectory', 'ExecStart', 'ExecStartPre', 'ExecCondition',
             'ExecStartPost', 'ExecStop', 'ExecStopPost', 'Environment', 'EnvironmentFiles',
             'PassEnvironment', 'UnsetEnvironment', 'PAMName', 'RootDirectory', 'RootImage',
             'BindPaths', 'BindReadOnlyPaths', 'DynamicUser', 'FragmentPath', 'DropInPaths',
             'NeedDaemonReload', 'ActiveState', 'TriggeredBy', 'PartOf', 'BindsTo', 'BoundBy',
             'RequiredBy', 'PropagatesStopTo', 'ConsistsOf', 'Conflicts', 'OnFailure', 'OnSuccess',
             'FailureAction', 'SuccessAction', 'JobTimeoutAction', 'StartLimitAction']
    meta = system(unit, *props)
    need(meta.get('MainPID') == str(staging) and meta.get('User') == USER
         and meta.get('WorkingDirectory') == str(ROOT) and meta.get('ActiveState') == 'active'
         and meta.get('NeedDaemonReload') == 'no', 'systemd主进程/用户/目录/加载状态不符。')
    for key in ['ExecStartPre', 'ExecCondition', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'PassEnvironment',
                'UnsetEnvironment', 'PAMName', 'RootDirectory', 'RootImage', 'BindPaths',
                'BindReadOnlyPaths', 'TriggeredBy', 'PartOf', 'BindsTo', 'BoundBy', 'RequiredBy',
                'PropagatesStopTo', 'ConsistsOf', 'OnFailure', 'OnSuccess']:
        need(not meta.get(key), '存在不支持的systemd生命周期钩子、触发器或环境/挂载覆盖：'+key)
    need(set(meta.get('Conflicts', '').split()).issubset({'shutdown.target'}), '启动预发布可能停止其他单元；停止。')
    need(all(meta.get(k, 'none') == 'none' for k in
             ('FailureAction', 'SuccessAction', 'JobTimeoutAction', 'StartLimitAction')),
         'systemd配置了额外失败/成功动作；停止。')
    need(meta.get('DynamicUser') == 'no', '不支持DynamicUser。')
    argv = p['argv']
    need(len(argv) == 2 and Path(argv[0]).name == 'node'
         and argv[1] in ('scripts/dev-server.js', 'scripts/start-single-server.js',
                         str(ROOT/'scripts/dev-server.js'), str(ROOT/'scripts/start-single-server.js')),
         '不是直接Node启动；npm/PM2、额外参数或.env加载需另行审核。')
    executable = re.findall(r'path=([^ ;]+)', meta.get('ExecStart', ''))
    arguments = re.findall(r'argv\[\]=(.*?) ; ignore_errors=', meta.get('ExecStart', ''))
    need(len(executable) == len(arguments) == 1, 'ExecStart格式或命令数量无法确认。')
    startargs = shlex.split(arguments[0])
    direct = len(startargs) == 2 and Path(executable[0]).resolve() == p['exe'] and startargs[1] == argv[1]
    via_env = len(startargs) == 3 and executable[0] == '/usr/bin/env' and startargs[1:] == ['node', argv[1]]
    need(direct or via_env, 'ExecStart不是已支持的直接Node或env node命令。')
    need(re.fullmatch(r'v24\.\d+\.\d+', cmd([p['exe'], '--version'])), '要求Node.js 24。')
    env = p['env']
    need(not any(env.get(k) for k in ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH']), '存在额外代码加载环境；停止。')
    need(env.get('PORT') == '9000' and env.get('AI_ENABLED') == 'false', '要求PORT=9000且AI_ENABLED显式为false；脚本不会改配置。')
    need(env.get('ADMIN_EMAIL') and len(env.get('ADMIN_PASSWORD', '')) >= 12, '管理员配置缺失或不合格；不会初始化或重置。')
    origin = env.get('APP_ORIGIN', '')
    url = urlsplit(origin)
    need(url.scheme == 'https' and url.hostname and url.port in (None, 443)
         and not url.username and not url.password and url.path in ('', '/')
         and not url.query and not url.fragment and env.get('TRUST_PROXY') == 'loopback',
         'APP_ORIGIN必须为HTTPS纯来源且TRUST_PROXY=loopback。')
    origin = origin.rstrip('/')
    envfiles, names = environment_files(meta, env)
    project_keys = {k for k in env if re.match(r'^(AI_|ADMIN_|DATABASE_|SQLITE_)', k)
                    or k in ('PORT', 'APP_ORIGIN', 'TRUST_PROXY', 'NODE_ENV', 'VERCEL')}
    need(project_keys.issubset(names), '进程存在未能追溯到systemd/EnvironmentFile的项目配置。')
    db, proddb = db_path(p), db_path(prod)
    need(not os.path.samefile(db, proddb), '8000与9000共享数据库路径或inode；禁止部署。')
    need(not db.is_relative_to(OLD_ROOT), '预发布数据库位于旧服务目录，隔离边界不清；停止。')
    need(process_has_db(staging, db) and process_has_db(oldpid, proddb),
         '环境推导的数据库与进程实际打开文件不符；可能有.env或其他覆盖，停止。')
    need(db.stat().st_nlink == 1 and db.stat().st_uid == account.pw_uid
         and db.stat().st_mode & 0o777 == 0o600, '预发布数据库所有权、链接数或权限不合格。')
    need(env.get('SQLITE_PATH') and Path(env['SQLITE_PATH']).is_absolute(), '预发布必须显式配置绝对SQLITE_PATH。')
    as_user(['test', '-w', db]); as_user(['test', '-w', db.parent])
    other_db_users(db, staging)
    need(git('rev-parse', '--show-toplevel') == str(ROOT), 'Git根目录不符。')
    current = git('rev-parse', 'HEAD')
    branch = git('branch', '--show-current')
    dirty = git('status', '--porcelain=v1', '--untracked-files=all')
    print('Git branch:', branch or '(detached)', 'commit:', current, 'dirty:', bool(dirty), flush=True)
    need(not dirty, '存在未提交或未跟踪改动；停止，不stash、不reset。')
    need(git('remote', 'get-url', 'origin') in (REPO, REPO[:-4]), 'origin不是指定无凭据HTTPS仓库。')
    config = git('config', '--local', '--list')
    need(not re.search(r'^(filter\.|core\.(worktree|fsmonitor|sshcommand)|remote\.origin\.(uploadpack|proxy))', config, re.M | re.I), 'Git本地存在不支持的执行/代理/工作区配置。')
    need(not (ROOT/'.gitattributes').exists(), '需要先审核Git过滤器属性。')
    if fetch:
        git('fetch', '--no-tags', 'origin', 'refs/heads/'+BRANCH, timeout=90)
        need(git('rev-parse', 'FETCH_HEAD') == SHA, '远端分支已移动；本次脚本固定提交，停止。')
    try:
        target = git('rev-parse', SHA+'^{commit}')
    except Stop:
        raise Stop('本地无法读取指定提交；如仅缺Git对象，审查后用--fetch --check准备，不要修改代码。') from None
    need(target == SHA, 'Git对象不是指定提交。')
    need(git('rev-parse', SHA+'^') == PARENT, '目标提交父级与审核基线不一致。')
    need(current in (PARENT, SHA), '当前提交不是已审核直接基线；可能涉及其他代码或迁移，禁止整分支替换。')
    changed = set(git('diff', '--name-only', PARENT, SHA).splitlines())
    need(changed == PATCH_FILES, '目标提交变更范围与已审核的8文件补丁不符。')
    for name in PATCH_FILES:
        file = ROOT/name
        if file.exists():
            need(file.is_file() and not file.is_symlink() and file.stat().st_nlink == 1,
                 '补丁目标文件存在链接共享或类型不符；停止。')
    for directory in {ROOT, ROOT/'.git', *[(ROOT/p).parent for p in PATCH_FILES]}:
        as_user(['test', '-w', directory])
    need(not git('ls-files', '--', str(db.relative_to(ROOT)) if db.is_relative_to(ROOT) else '__no_db__'), '数据库被Git跟踪；禁止部署。')
    for secret in envfiles:
        if secret.is_relative_to(ROOT):
            need(not git('ls-files', '--', str(secret.relative_to(ROOT))), '环境文件被Git跟踪；停止。')
    tracked = git('ls-tree', '-r', '--name-only', SHA).splitlines()
    ignored = git('ls-files', '--others', '--ignored', '--exclude-standard').splitlines()
    need(not any(a == b or a.startswith(b+'/') or b.startswith(a+'/') for a in ignored for b in tracked), '目标文件会覆盖现有ignored数据；停止。')
    expected = {}
    ids = ['0001.sql', '0002_catalog.sql', '0003_ai_test.sql', '0004_soul_core.sql', '0005_chat_cost_guard.sql']
    for name in ids:
        raw = git('show', SHA+':db/migrations/'+name, raw=True)
        if name == '0002_catalog.sql':
            raw += b'\nlegacy-visibility-v1'
        expected[name] = hashlib.sha256(raw).hexdigest()
    schema_check(db, expected)
    nginxfiles, proxyfp = proxy_check(origin)
    health(origin)
    files = set(envfiles + nginxfiles + [protected_file(meta['FragmentPath'])]
                + [protected_file(f) for f in shlex.split(meta.get('DropInPaths', ''))])
    pins = {str(f): digest(f) for f in files}
    print('Service:', unit, 'user:', USER, 'startup:', Path(argv[1]).name, flush=True)
    print('Environment names only:', ', '.join(names), flush=True)
    print('Independent SQLite:', db, 'HTTPS origin:', origin, flush=True)
    return {'unit': unit, 'pid': staging, 'oldpid': oldpid, 'oldfp': fingerprint(oldpid),
            'current': current, 'branch': branch, 'db': db, 'proddb': proddb,
            'origin': origin, 'pins': pins, 'expected': expected, 'exe': p['exe'], 'proxyfp': proxyfp}


def offline_tests(plan):
    with tempfile.TemporaryDirectory(prefix='pv-release-verify-', dir='/var/tmp') as temp:
        root = Path(temp)
        account = pwd.getpwnam(USER)
        os.chown(root, account.pw_uid, account.pw_gid)
        data = git('archive', '--format=tar', SHA, raw=True)
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for member in archive.getmembers():
                path = Path(member.name)
                need(not path.is_absolute() and '..' not in path.parts and (member.isfile() or member.isdir()), '提交归档存在不支持的路径或链接。')
                archive.extract(member, root)
                os.chown(root/path, account.pw_uid, account.pw_gid)
        # No live .env, administrator credentials, API keys or network credentials.
        as_user([plan['exe'], '--import', './tests/no-network.mjs', '--test',
                 *sorted(str(p.relative_to(root)) for p in (root/'tests').glob('*.test.js'))],
                cwd=root, timeout=120, extra={'AI_ENABLED': 'false'})
    print('PASS pinned commit offline tests (temporary database only).', flush=True)


def unchanged(plan):
    need(listener(8000) == plan['oldpid'] and fingerprint(plan['oldpid']) == plan['oldfp'], '8000进程发生变化；停止。')
    need(all(digest(p) == h for p, h in plan['pins'].items()), '环境/单元/Nginx配置在检查后发生变化；停止。')
    need(fingerprint(plan['proxyfp'][0]) == plan['proxyfp'], 'Nginx进程发生变化；停止。')
    need(git('rev-parse', 'HEAD') == plan['current'] and not git('status', '--porcelain=v1', '--untracked-files=all'), '代码在检查后变化；停止。')


def wait_health(plan, full):
    last = None
    for _ in range(8):
        try:
            need(system(plan['unit'], 'ActiveState')['ActiveState'] == 'active', '服务尚未active。')
            pid = listener(9000)
            need(process(pid)['cwd'] == ROOT, '恢复进程目录不符。')
            health(plan['origin'], full=full)
            return
        except (Stop, ValueError, OSError) as error:
            last = error
            time.sleep(2)
    raise Stop('服务启动/HTTPS/认证健康检查失败。') from last


def backup_directory():
    backup_root = Path('/var/backups/personaverse-staging')
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(not backup_root.is_symlink() and backup_root.stat().st_uid == 0
         and backup_root.stat().st_mode & 0o077 == 0, '备份根目录必须由root独占。')
    return backup_root


def apply(plan):
    offline_tests(plan)
    unchanged(plan)
    backup_root = backup_directory()
    # Full tree estimate includes ignored files and .git, without following symlinks.
    size = int(cmd(['du', '-sb', ROOT]).split()[0])
    wal = Path(str(plan['db'])+'-wal')
    dbsize = plan['db'].stat().st_size + (wal.stat().st_size if wal.exists() else 0)
    need(shutil.disk_usage(backup_root).free > size*2+dbsize*2+256*1024*1024, '完整备份可用空间不足。')
    backup = Path(tempfile.mkdtemp(prefix=time.strftime('%Y%m%dT%H%M%SZ-', time.gmtime()), dir=backup_root))
    os.chmod(backup, 0o700)
    for index, path in enumerate(sorted(plan['pins'])):
        shutil.copyfile(path, backup/('config-'+str(index)))
    metadata = {k: str(v) for k, v in plan.items() if k in ('unit', 'current', 'branch', 'db', 'origin')}
    metadata.update(target=SHA, config_paths={str(i): p for i, p in enumerate(sorted(plan['pins']))})
    (backup/'manifest.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    stopped = False
    changed = False
    try:
        # Flag before stop: even a timeout or interrupt must attempt recovery.
        stopped = True
        cmd(['systemctl', 'stop', plan['unit']], timeout=60)
        need(listener(9000, optional=True) is None, '9000仍有监听者；停止发布并恢复旧服务。')
        need(system(plan['unit'], 'MainPID').get('MainPID') == '0', '服务主进程尚未退出。')
        unchanged(plan)
        other_db_users(plan['db'], -1)
        cmd(['tar', '--acls', '--xattrs', '--numeric-owner', '-cpf', backup/'code-and-local-data.tar',
             '-C', ROOT, '.'], timeout=300)
        cmd(['tar', '-tf', backup/'code-and-local-data.tar'], timeout=60)
        cmd(['tar', '--compare', '--file', backup/'code-and-local-data.tar', '-C', ROOT], timeout=300)
        with contextlib.closing(readonly_db(plan['db'])) as source:
            with contextlib.closing(sqlite3.connect(backup/'staging.sqlite')) as dest:
                source.backup(dest)
                need(dest.execute('PRAGMA quick_check').fetchall() == [('ok',)], '备份数据库校验失败。')
        schema_check(backup/'staging.sqlite', plan['expected'])
        checksums = {p.name: digest(p) for p in backup.iterdir() if p.is_file()}
        (backup/'sha256.json').write_text(json.dumps(checksums, indent=2))
        for p in backup.iterdir():
            os.chmod(p, 0o600)
        print('PASS verified backup:', backup, flush=True)
        changed = True
        git('checkout', '--detach', '--no-overwrite-ignore', SHA)
        need(git('rev-parse', 'HEAD') == SHA and not git('status', '--porcelain=v1', '--untracked-files=all'), '指定提交检出或清洁状态验证失败。')
        need(all(digest(p) == h for p, h in plan['pins'].items()), '配置发生变化；回滚。')
        cmd(['systemctl', 'start', plan['unit']], timeout=60)
        wait_health(plan, full=True)
        need(listener(8000) == plan['oldpid'] and fingerprint(plan['oldpid']) == plan['oldfp'], '8000状态变化；停止并回滚预发布。')
        schema_check(plan['db'], plan['expected'])
        print('SUCCESS: 9000 pinned to '+SHA+'; 8000 unchanged. No migration/AI call.', flush=True)
        print('真实管理员登录仍需本人在Safari手动验证；自动测试未使用真实密码。', flush=True)
    except BaseException:
        if stopped:
            print('RELEASE FAILED: attempting code-only rollback; never restoring/deleting live database.', flush=True)
            try:
                cmd(['systemctl', 'stop', plan['unit']], timeout=60)
                need(listener(9000, optional=True) is None, '回滚前9000未释放。')
                if changed:
                    # Original tree was clean and fully backed up. Never git clean.
                    git('checkout', '--force', '--detach', plan['current'])
                    if plan['branch']:
                        if git('rev-parse', 'refs/heads/'+plan['branch']) == plan['current']:
                            git('checkout', plan['branch'])
                        else:
                            print('WARNING: original branch moved externally; restoring old SHA detached.', flush=True)
                cmd(['systemctl', 'start', plan['unit']], timeout=60)
                wait_health(plan, full=False)
                need(git('rev-parse', 'HEAD') == plan['current'], '回滚提交不符。')
                print('ROLLBACK VERIFIED: old commit and session health restored. Backup: '+str(backup), flush=True)
            except BaseException:
                # No automatic restore of database/config or blind restart loop.
                print('CRITICAL: automatic rollback could not be verified. Preserve backup: '+str(backup)+
                      '; inspect only staging unit '+plan['unit']+'. Do not touch 8000.', flush=True)
        raise


def interrupted(signum, frame):
    raise Stop('收到中断信号；若已停止服务，将尝试回滚。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--check', action='store_true', help='default: read-only preflight; no fetch/restart/checkout')
    modes.add_argument('--apply', action='store_true', help='explicitly authorize backup, stop, pinned checkout, start and rollback')
    parser.add_argument('--fetch', action='store_true', help='allow fetching only the named branch; writes Git objects/FETCH_HEAD, not code')
    args = parser.parse_args()
    os.umask(0o077)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, interrupted)
    lock = None
    try:
        if args.apply:
            need(os.geteuid() == 0, '需要sudo/root。')
            fd = os.open('/run/lock/personaverse-staging-release.lock',
                         os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            lock = os.fdopen(fd, 'a')
            stat = os.fstat(fd)
            need(stat.st_uid == 0 and stat.st_nlink == 1 and stat.st_mode & 0o777 == 0o600,
                 '部署锁文件不安全；停止。')
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        plan = preflight(fetch=args.fetch)
        print('PASS all preflight checks.', flush=True)
        if args.apply:
            need(plan['current'] != SHA, '指定提交已部署；不重复重启。')
            apply(plan)
        else:
            print('CHECK ONLY: no service restart, checkout, config change or database migration.', flush=True)
    except BaseException as error:
        # Never interpolate unexpected exceptions, argv, env or captured process output.
        print('STOP: '+(str(error) if isinstance(error, Stop) else '未预期错误；停止，未输出敏感上下文。'), file=sys.stderr, flush=True)
        return 1
    finally:
        if lock:
            lock.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
