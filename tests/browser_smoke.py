"""Chromium mobile-viewport smoke test. Not a physical iPhone Safari test.
Run: python3 tests/browser_smoke.py (Python Playwright and Chromium required).
Uses only temporary database/random credentials; stops its own server on exit.
"""
import os, secrets, shutil, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='pv-browser-') as tmp:
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 base=f'http://127.0.0.1:{port}';password=secrets.token_hex(24)
 env={**os.environ,'PORT':str(port),'SQLITE_PATH':str(Path(tmp)/'test.sqlite'),'ADMIN_EMAIL':'admin@example.test','ADMIN_PASSWORD':password,'NODE_ENV':'test'}
 env.pop('DATABASE_URL',None);env.pop('VERCEL',None)
 with open(Path(tmp)/'server.log','w') as log:
  server=subprocess.Popen(['node','scripts/dev-server.js'],cwd=root,env=env,stdout=log,stderr=log)
  try:
   for _ in range(100):
    try:urllib.request.urlopen(base+'/api/session',timeout=1).close();break
    except Exception:
     if server.poll() is not None:raise RuntimeError('Test server failed')
     time.sleep(.1)
   with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/');expect(page.locator('#results .persona-card')).to_have_count(12)
    page.locator('#search').fill('Moonlight');expect(page.locator('#results .persona-card')).to_have_count(1)
    page.locator('#reset-search').click();page.locator('.category-chip[data-category="效率工具"]').click();expect(page.locator('#results .persona-card')).to_have_count(3)
    print('PASS 1: mobile list/search/category',flush=True)
    page.goto(base+'/admin.html');page.locator('[name=email]').fill('admin@example.test');page.locator('[name=password]').fill(password);page.locator('#login button').click();expect(page.locator('#panel')).to_be_visible()
    page.locator('#new').click()
    for field,value in {'name':'手机验收角色','description':'原创测试角色','background':'原创背景','personality':'耐心','languageStyle':'中文','systemPrompt':'原创提示词'}.items():page.locator('#form [name='+field+']').fill(value)
    page.locator('#form [name=status]').select_option('published');page.locator('#form button').first.click();expect(page.locator('#editor')).not_to_be_visible()
    page.reload();expect(page.locator('#panel')).to_be_visible();page.locator('#admin-search').fill('手机验收角色');expect(page.locator('#list article')).to_have_count(1)
    page.locator('#list article button').first.click();expect(page.locator('[name=background]')).to_have_value('原创背景');page.locator('#form [name=name]').fill('手机编辑成功');page.locator('#form button').first.click();expect(page.locator('#editor')).not_to_be_visible()
    page.locator('#admin-search').fill('手机编辑成功');expect(page.locator('#list article')).to_have_count(1)
    page.locator('#list article').get_by_role('button',name='下架',exact=True).click();expect(page.locator('#list article')).to_contain_text('archived')
    page.locator('#list article').get_by_role('button',name='上架',exact=True).click();expect(page.locator('#list article')).to_contain_text('published')
    page.once('dialog',lambda d:d.accept());page.locator('#list article').get_by_role('button',name='删除',exact=True).click();expect(page.locator('#list article')).to_have_count(0)
    print('PASS 2: admin create/edit/publish/unpublish/delete and reload',flush=True)
    target=page.evaluate('''async()=>{const d=await fetch('/api/admin/personas').then(r=>r.json());let last;for(let i=0;i<13;i++){const r=await fetch('/api/admin/personas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'分页角色'+i,description:'测试',categoryId:d.categories[0].id,systemPrompt:'原创',status:'published',sortOrder:100+i})});if(!r.ok)throw Error(await r.text());last=(await r.json()).persona.id;}return last;}''')
    page.goto(base+'/');expect(page.locator('#results .persona-card')).to_have_count(12);page.get_by_role('button',name='下一页',exact=True).click();expect(page.locator('#catalog-pagination span')).to_have_text('第 2 / 3 页')
    page.goto(base+'/persona.html?id='+target);expect(page.locator('.detail-title h1')).to_contain_text('分页角色12');page.locator('.detail-save').click();page.goto(base+'/index.html?view=favorites');expect(page.locator('#results .persona-card')).to_have_count(1)
    print('PASS 3: pagination/direct detail/cross-page favorites',flush=True)
    page.goto(base+'/chat.html?id='+target);expect(page.locator('.demo-note')).to_contain_text('非真实 AI');page.locator('#message').fill('<img src=x onerror=alert(1)>');page.get_by_role('button',name='发送演示消息').click();expect(page.locator('.bubble')).to_have_count(3);expect(page.locator('.bubble.user p')).to_have_text('<img src=x onerror=alert(1)>');expect(page.locator('.bubble img')).to_have_count(0);page.get_by_role('button',name='清空',exact=True).click();expect(page.locator('.bubble')).to_have_count(0)
    print('PASS 4: explicit demo label/literal input/clear',flush=True)
    for width in [320,390,768,1440]:
     page.set_viewport_size({'width':width,'height':844})
     for route in ['index.html','admin.html','persona.html?id='+target,'chat.html?id='+target]:
      page.goto(base+'/'+route);page.wait_for_timeout(150);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,route)
    assert not errors,errors
    page.goto(base+'/admin.html');expect(page.locator('#panel')).to_be_visible();page.locator('#logout').click();expect(page.locator('#login')).to_be_visible();assert page.evaluate("fetch('/api/admin/personas').then(r=>r.status)")==401
    print('PASS 5: four viewports/no script errors/logout authorization',flush=True);b.close()
  finally:
   server.terminate()
   try:server.wait(timeout=5)
   except subprocess.TimeoutExpired:server.kill();server.wait()
