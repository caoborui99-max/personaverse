"""Static-only browser acceptance: python3 tests/preview_browser.py (Playwright + Chromium)."""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
passed = 0
def check(condition, label):
    global passed
    assert condition, label
    passed += 1
    print('PASS', label)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        context = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True, reduced_motion='reduce')
        page = context.new_page()
        errors, forbidden = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: forbidden.append(r.url) if r.resource_type in ('fetch','xhr','websocket') or not r.url.startswith('http://127.0.0.1:') else None)
        base = f'http://127.0.0.1:{server.server_port}'
        for output in ('preview-dist', 'docs/preview'):
            url = base+'/'+output+'/'
            page.goto(url)
            page.wait_for_selector('#results .persona-card')
            check(page.locator('#results .persona-card').count()==12, output+' 12 personas')
            name=page.locator('#results h3').first.inner_text()
            page.locator('#search').fill(name)
            page.wait_for_timeout(300)
            check(page.locator('#results .persona-card').count()==1, output+' search')
            page.locator('#reset-search').click()
            page.locator('.category-chip').nth(1).click()
            check(0<page.locator('#results .persona-card').count()<12, output+' category')
            page.locator('#reset-search').click()
            page.locator('#sort').select_option('name')
            check(page.locator('#results .persona-card').count()==12, output+' sorting')
            context.clear_cookies()
            page.evaluate('localStorage.clear()')
            page.reload()
            page.locator('#results [data-save]').first.click()
            page.goto(url+'index.html?view=favorites')
            page.reload()
            check(page.locator('#results .persona-card').count()==1, output+' persistent favorites')
            page.locator('#results .card-main').click()
            check(page.locator('#prompt-text').input_value()!='', output+' detail prompt')
            page.locator('.detail-title a').click()
            check('非真实 AI' in page.locator('.demo-note').inner_text(), output+' clear demo notice')
            page.locator('#message').fill('<img src=x onerror=alert(1)>')
            page.locator('#composer button').first.click()
            check(page.locator('.bubble.user').count()==1 and page.locator('.bubble img').count()==0, output+' safe user input')
            check('预设脚本（非 AI）' in page.locator('#messages').inner_text(), output+' preset reply')
            page.reload()
            check(page.locator('.bubble.user').count()==0, output+' no chat persistence')
            for width in (320,375,390,430,768,1440):
                page.set_viewport_size({'width':width,'height':844})
                for path in ('index.html','persona.html?id=moonlight','chat.html?id=moonlight'):
                    page.goto(url+path)
                    check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{output} width {width} {path}')
            page.goto(url+'chat.html?id=missing')
            check(page.locator('#composer button').first.is_disabled(), output+' invalid persona')
        check(not errors, 'no browser JS errors: '+str(errors))
        check(not forbidden, 'no API/external requests: '+str(forbidden))
        browser.close()
finally:
    server.shutdown()
print(f'{passed} passed, 0 failed. Chromium mobile emulation; physical iPhone Safari NOT tested.')
