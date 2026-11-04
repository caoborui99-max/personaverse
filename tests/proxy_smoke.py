"""Loopback HTTP simulating Nginx HTTPS headers; no TLS/Nginx/AI calls."""
import os,secrets,socket,subprocess,tempfile,time,json,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parents[1];(root/'.local').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='cn-proxy-',dir=root/'.local') as tmp:
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 env={**os.environ,'PORT':str(port),'NODE_ENV':'production','DATABASE_DRIVER':'sqlite','SQLITE_PATH':str(Path(tmp)/'db.sqlite'),'APP_ORIGIN':'https://test.example','TRUST_PROXY':'loopback','ADMIN_EMAIL':'admin@example.test','ADMIN_PASSWORD':secrets.token_hex(24),'AI_ENABLED':'false'}
 for k in ['AI_API_KEY','DATABASE_URL','VERCEL']:env.pop(k,None)
 with open(Path(tmp)/'server.log','w') as log:
  proc=subprocess.Popen(['node','scripts/start-single-server.js'],cwd=root,env=env,stdout=log,stderr=log)
  def request(path,body=None,headers=None):
   h={'Host':'test.example','X-Forwarded-Proto':'https','Origin':'https://test.example','Content-Type':'application/json',**(headers or {})}
   req=urllib.request.Request(f'http://127.0.0.1:{port}/api/'+path,data=json.dumps(body).encode() if body is not None else None,headers=h)
   try:r=urllib.request.urlopen(req,timeout=5)
   except urllib.error.HTTPError as e:r=e
   return r.status,r.headers,json.loads(r.read())
  try:
   for _ in range(100):
    try:request('session');break
    except Exception:
     if proc.poll() is not None:raise RuntimeError('Server failed; inspect private test log')
     time.sleep(.1)
   status,h,d=request('auth/login',{'email':env['ADMIN_EMAIL'],'password':env['ADMIN_PASSWORD']});assert status==200
   assert 'Secure' in h['Set-Cookie'] and 'HttpOnly' in h['Set-Cookie'];cookie=h['Set-Cookie'].split(';')[0]
   assert request('admin/personas',headers={'Cookie':cookie})[0]==200
   assert request('auth/login',{},headers={'Origin':'https://evil.example'})[0]==403
   assert request('session',headers={'X-Forwarded-Proto':'http'})[0]==400
   assert request('session',headers={'Host':'evil.example'})[0]==400
   assert request('ai/status')[2]['mode']=='demo'
   assert Path(env['SQLITE_PATH']).is_file()
   print('PASS: production SQLite server + loopback HTTPS proxy simulation + Secure login + same-origin/host guards + AI disabled')
  finally:
   proc.terminate()
   try:proc.wait(timeout=5)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
