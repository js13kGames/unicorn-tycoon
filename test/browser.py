"""Verify both release targets in Chromium and Firefox (requires Playwright).

python3 test/browser.py
Uses an isolated browser context, no Wavedash global, no production writes.
"""
import functools
import http.server
import itertools
import json
from pathlib import Path
import socketserver
import tempfile
import threading
import zipfile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
shots = root / '.js13k-check'
shots.mkdir(exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

with tempfile.TemporaryDirectory() as extracted:
    archive = root / 'js13k-game.zip'
    assert archive.stat().st_size <= 13312
    with zipfile.ZipFile(archive) as z:
        assert z.namelist() == ['index.html']
        assert z.testzip() is None
        assert z.read('index.html') == (root / 'dist/js13k/index.html').read_bytes(), 'Contest page and ZIP differ'
        z.extractall(Path(extracted) / 'js13k')
    upload = root / 'dist/wavedash'
    assert sorted(p.relative_to(upload).as_posix() for p in upload.rglob('*') if p.is_file()) == ['index.html']
    wavedash = (upload / 'index.html').read_bytes()
    assert wavedash == (root / 'src/index.html').read_bytes(), 'Rebuild after editing the source'
    (Path(extracted) / 'wavedash').mkdir()
    (Path(extracted) / 'wavedash/index.html').write_bytes(wavedash)
    with socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=extracted)) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_address[1]}'
        results = []
        with sync_playwright() as p:
            for target, engine in itertools.product(('js13k', 'wavedash'), ('chromium', 'firefox')):
                browser = getattr(p, engine).launch()
                page = browser.new_page(viewport={'width':1200, 'height':680})
                errors, external = [], []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                page.on('request', lambda r: external.append(r.url) if not r.url.startswith(base) else None)
                # Keep rendering genuine; only advance the game's clock faster.
                page.add_init_script('''
                  window.__tick=0;
                  window.requestAnimationFrame=f=>(window.__frame=f,0);
                  window.__run=n=>{while(n--){const f=window.__frame;
                    window.__tick+=1000/30; f(window.__tick);}};
                ''')
                page.goto(base+'/'+target+'/index.html')
                page.evaluate('__run(2)')
                page.locator('#w').click()
                k = 680/620*1.25
                page.mouse.click(600, 340-30+(5.2*16-22)*k)
                page.locator('#b button').filter(has_text='Comfort').click()
                page.locator('#i .C').filter(has_text='Bench').click()
                page.locator('#v').click()
                for _ in range(300):
                    page.evaluate('__run(1)')
                    if 'FIRST SPARK' in page.locator('#ac').inner_text():
                        break
                assert 'FIRST SPARK' in page.locator('#ac').inner_text()
                assert page.evaluate('localStorage.getItem("unicorn-tycoon.achievements.v1")') == '1'
                page.screenshot(path=str(shots/f'{target}-achievement-{engine}.png'))
                page.locator('#o').click()
                for _ in range(100):
                    page.evaluate('__run(60)')
                    if 'Evening of day 1' in page.locator('#z').inner_text():
                        break
                assert 'Evening of day 1' in page.locator('#z').inner_text()
                page.locator('#w').click()
                assert page.locator('#d').inner_text() == 'Day 2/13'
                page.set_viewport_size({'width':390,'height':844})
                # Wait for resize() before manually drawing: resizing a canvas
                # clears it, and this test has disabled the normal frame loop.
                page.wait_for_function('''() => {
                  const c=document.getElementById('c');
                  return c.width===innerWidth*Math.min(devicePixelRatio||1,2)
                    && c.height===innerHeight*Math.min(devicePixelRatio||1,2);
                }''', polling=50)
                page.evaluate('__run(2)')
                colors = page.evaluate('''() => {
                  const c=document.getElementById('c');
                  const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                  const colors=new Set();
                  for(let y=0;y<c.height;y+=20) for(let x=0;x<c.width;x+=20){
                    const i=(y*c.width+x)*4;
                    colors.add(data[i]+','+data[i+1]+','+data[i+2]);
                  }
                  return colors.size;
                }''')
                assert colors > 10, f'{target}/{engine}: mobile canvas is blank ({colors} colors)'
                page.screenshot(path=str(shots/f'{target}-mobile-{engine}.png'))
                assert not errors, errors
                assert not external, external
                results.append({'target':target,'engine':engine,'errors':errors,'external':external,
                                'achievement':'FIRST_SPARK','day':2,'mobile_colors':colors})
                browser.close()
        server.shutdown()
        (shots/'release-browser-results.json').write_text(json.dumps(results, indent=2))
        print(json.dumps(results, indent=2))
